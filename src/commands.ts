import { SlashCommandBuilder, ChatInputCommandInteraction, REST, Routes, PermissionFlagsBits, MessageFlags, DiscordAPIError, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import * as fs from 'fs';
import * as path from 'path';
import { GameRuntime, setBlockDuration, setCurrentBlock, setTotalRewards, setBaseReward, getLeaderboard, exportMiningData, getUserPackCount, openPackForUser, MARKET_MIN_CLAIM_DOLLARS, MARKET_MAX_DOLLAR_BALANCE } from './game';

export const commands = [
    new SlashCommandBuilder().setName('start').setDescription('Re-enable the bot after a soft stop (admin only)'),
    new SlashCommandBuilder().setName('post').setDescription('Post the Glyphs game panel in this channel'),
    new SlashCommandBuilder().setName('setblock').setDescription('Set current block number').addIntegerOption(o=>o.setName('number').setDescription('Block number').setRequired(true)),
    new SlashCommandBuilder().setName('setrewards').setDescription('Set total rewards per block').addIntegerOption(o=>o.setName('amount').setDescription('Amount of glyphs').setRequired(true)),
    new SlashCommandBuilder().setName('setduration').setDescription('Set seconds per block').addIntegerOption(o=>o.setName('seconds').setDescription('Seconds').setRequired(true)),
    new SlashCommandBuilder().setName('resetbalances').setDescription('Reset all balances to zero'),
    new SlashCommandBuilder().setName('resetrecords').setDescription('Reset all reward records (admin only)'),
    new SlashCommandBuilder().setName('resetall').setDescription('Reset everything: blocks, balances, records (admin only)'),
    new SlashCommandBuilder().setName('restart').setDescription('Restart the bot (admin only)'),
    new SlashCommandBuilder().setName('refresh').setDescription('Refresh the mining bot UI panel'),
    new SlashCommandBuilder().setName('stop').setDescription('Stop the bot (admin only)'),
    new SlashCommandBuilder().setName('shutdown').setDescription('Fully shut down the bot process (admin only)'),
    new SlashCommandBuilder().setName('setbasereward').setDescription('Set base reward per block (admin only)').addIntegerOption(o=>o.setName('amount').setDescription('Base reward').setRequired(true)),
    new SlashCommandBuilder().setName('runblocks').setDescription('Run for N blocks, notify role each block, then shutdown')
        .addIntegerOption(o=>o.setName('blocks').setDescription('Number of blocks to run').setRequired(true))
        .addStringOption(o=>o.setName('role').setDescription('Role ID to mention (optional)'))
        .addStringOption(o=>o.setName('channel').setDescription('Channel ID for notifications (optional)'),
    ),
    new SlashCommandBuilder().setName('finalleaderboard').setDescription('Show the final leaderboard (top 10 by exact matches)'),
    new SlashCommandBuilder().setName('openpack').setDescription('Open one of your market packs'),
    new SlashCommandBuilder().setName('grumble').setDescription('Start a rumble gambling game (admin only)'),
    new SlashCommandBuilder().setName('grumble_restart').setDescription('Restart the current grumble game (admin only)'),
    new SlashCommandBuilder().setName('grumblepanel').setDescription('Repost the grumble panel in this channel (admin only)'),
    new SlashCommandBuilder().setName('grumbletimer').setDescription('Set custom timer for grumble (admin only)').addIntegerOption(o=>o.setName('seconds').setDescription('Timer in seconds (0 to disable custom timer)').setRequired(true)),
    new SlashCommandBuilder().setName('setglyphs').setDescription('Set a user\'s glyph balance (admin only)')
        .addUserOption(o=>o.setName('user').setDescription('User to set glyphs for').setRequired(true))
        .addIntegerOption(o=>o.setName('amount').setDescription('Amount of glyphs to set').setRequired(true)),
    new SlashCommandBuilder().setName('exportdata').setDescription('Export mining data snapshot to JSON (admin only)'),
].map(c=>c.toJSON());

export async function handleSlash(interaction: ChatInputCommandInteraction, runtime: GameRuntime) {
    // Helper function to safely reply to interactions with error handling
    const safeReply = async (content: string, options?: any) => {
        try {
            if (interaction.replied || interaction.deferred) {
                console.warn('Attempted to reply to already handled interaction:', interaction.id);
                return;
            }
            return await interaction.reply({ content, ...options });
        } catch (error) {
            if (error instanceof DiscordAPIError) {
                // Handle specific Discord API errors
                if (error.code === 50013) { // Missing Permissions
                    console.error('Bot missing permissions for command reply:', error.message);
                } else if (error.code === 50001) { // Missing Access
                    console.error('Bot missing access for command reply:', error.message);
                } else if (error.code === 10062) { // Unknown Interaction
                    console.error('Unknown interaction (likely expired) for command:', error.message);
                } else {
                    console.error('Discord API error in command reply:', error.code, error.message);
                }
            } else {
                console.error('Failed to reply to interaction:', error);
            }
        }
    };

    // Soft stop: Only allow /start if inactive
    // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
    if (!runtime.isActive && interaction.commandName !== 'start' && interaction.commandName !== 'shutdown') {
        return safeReply('Bot is currently stopped. Use /start to enable it again.', { flags: MessageFlags.Ephemeral });
    }
    if (interaction.commandName === 'exportdata') {
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return safeReply('You do not have permission to use this command.', { flags: MessageFlags.Ephemeral });
        }
        try {
            await interaction.deferReply({ ephemeral: true });
            const result = await exportMiningData(runtime);
            const totalGlyphs = result.payload.summary.totalGlyphs.toLocaleString();
            const totalAccounts = result.payload.summary.totalAccounts.toLocaleString();
            const fileBuffer = fs.readFileSync(result.filePath);
            const attachment = new AttachmentBuilder(fileBuffer, { name: path.basename(result.filePath) });
            await interaction.editReply({
                content: `Export complete. Saved to ${result.relativePath}\nAccounts: ${totalAccounts} | Total Glyphs: ${totalGlyphs}`,
                files: [attachment],
            });
        } catch (error) {
            console.error('Error exporting mining data:', error);
            if (interaction.deferred) {
                await interaction.editReply('Failed to export mining data. Check logs for details.');
            } else {
                await safeReply('Failed to export mining data. Check logs for details.', { flags: MessageFlags.Ephemeral });
            }
        }
        return;
    }
    if (interaction.commandName === 'openpack') {
        const packs = getUserPackCount(runtime, interaction.user.id);
        if (packs <= 0) {
            return safeReply('You have no packs to open. Buy one from the market first.', { flags: MessageFlags.Ephemeral });
        }
        await interaction.deferReply(); // public reply so everyone can see results
        try {
            let roleIds: string[] = [];
            if (interaction.guild) {
                try {
                    const member = await interaction.guild.members.fetch(interaction.user.id);
                    roleIds = Array.from(member.roles.cache.keys());
                } catch (error) {
                    console.warn('Failed to fetch member roles for openpack:', error);
                }
            }
            const result = await openPackForUser(runtime, interaction.user.id, roleIds);
            const color = result.prize.type === 'glyphs' ? 0x6C63FF : 0xFFD166;
            const embed = new EmbedBuilder()
                .setColor(color)
                .setTitle('Pack Opened!')
                .setDescription(`You pulled **${result.prize.label}** from the market pack.`)
                .addFields({ name: 'Packs Remaining', value: result.packsRemaining.toString(), inline: true })
                .setImage(result.prize.imageUrl);

            if (result.prize.type === 'glyphs') {
                const earned = result.prize.amount.toLocaleString();
                const newBalance = (result.glyphBalance ?? 0).toLocaleString();
                embed.addFields(
                    { name: 'Glyphs Earned', value: `${earned} GLYPHS`, inline: true },
                    { name: 'New Balance', value: `${newBalance} GLYPHS`, inline: true },
                );
            } else {
                const added = result.dollarsAdded ?? 0;
                const addedDisplay = `${added}$${added < result.prize.amount ? ' (capped)' : ''}`;
                const newBalance = result.dollarBalance ?? 0;
                embed.addFields(
                    { name: 'Dollars Added', value: addedDisplay, inline: true },
                    { name: 'Current Dollar Balance', value: `${newBalance}$`, inline: true },
                    { name: 'Claim Reminder', value: `Claim between ${MARKET_MIN_CLAIM_DOLLARS}$ and ${MARKET_MAX_DOLLAR_BALANCE}$.`, inline: false }
                );
                if (result.dollarsCapped) {
                    embed.addFields({ name: 'Note', value: 'Dollar balance capped at 20$. Claim soon to keep earning!', inline: false });
                }
            }

            await interaction.editReply({ embeds: [embed], content: `${interaction.user} opened a market pack!` });
        } catch (error) {
            console.error('Error opening pack:', error);
            await interaction.editReply('Failed to open pack. Please try again shortly.');
        }
        return;
    }
    // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
    if (interaction.commandName === 'shutdown') {
        await safeReply('Bot is shutting down. Bye!', { flags: MessageFlags.Ephemeral });
        process.exit(0);
    }
    // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
    if (interaction.commandName === 'post') {
        if (!interaction.channel || !interaction.channel.isTextBased()) return;
        // postPanel is called in index.ts, so just reply here
        return safeReply('Panel posted.', { flags: MessageFlags.Ephemeral });
    }
    // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
    if (interaction.commandName === 'restart') {
        runtime.isActive = false;
        runtime.isActive = true;
        return safeReply('Bot has been restarted (soft stop/start).', { flags: MessageFlags.Ephemeral });
    }
    // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
    if (interaction.commandName === 'start') {
        if (runtime.isActive) {
            return safeReply('Bot is already running.', { flags: MessageFlags.Ephemeral });
        }
        runtime.isActive = true;
        return safeReply('Bot has been started and is now active.', { flags: MessageFlags.Ephemeral });
    }
    // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
    if (interaction.commandName === 'stop') {
        if (!runtime.isActive) {
            return safeReply('Bot is already stopped.', { flags: MessageFlags.Ephemeral });
        }
        runtime.isActive = false;
        return safeReply('Bot has been stopped. Use /start to enable it again.', { flags: MessageFlags.Ephemeral });
    }
    // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
    if (interaction.commandName === 'setblock') {
        const n = interaction.options.getInteger('number', true);
        await setCurrentBlock(runtime, n);
        return safeReply(`Block set to ${n}.`, { flags: MessageFlags.Ephemeral });
    }
    // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
    if (interaction.commandName === 'setrewards') {
        const amt = interaction.options.getInteger('amount', true);
        await setTotalRewards(runtime, amt);
        return safeReply(`Total rewards per block set to ${amt}.`, { flags: MessageFlags.Ephemeral });
    }
    // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
    if (interaction.commandName === 'setduration') {
        const sec = interaction.options.getInteger('seconds', true);
        await setBlockDuration(runtime, sec);
        return safeReply(`Block duration set to ${sec}s.`, { flags: MessageFlags.Ephemeral });
    }
    // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
    if (interaction.commandName === 'resetbalances') {
        runtime.balances.data = {};
        await runtime.balances.write();
        return safeReply('All balances reset.', { flags: MessageFlags.Ephemeral });
    }
    // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
    if (interaction.commandName === 'resetrecords') {
        runtime.state.data.blockHistory = [];
        await runtime.state.write();
        return safeReply('All reward records reset.', { flags: MessageFlags.Ephemeral });
    }
    // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
    if (interaction.commandName === 'resetall') {
        runtime.balances.data = {};
        runtime.state.data.blockHistory = [];
        runtime.state.data.currentBlock = 1;
        runtime.state.data.nextBlockAt = Date.now() + runtime.state.data.blockDurationSec * 1000;
        runtime.state.data.lastBotChoice = undefined;
        await runtime.balances.write();
        await runtime.state.write();
        return safeReply('Everything reset: blocks, balances, and records.', { flags: MessageFlags.Ephemeral });
    }
    // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
    if (interaction.commandName === 'setbasereward') {
        // Only allow admins
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return safeReply('You do not have permission to use this command.', { flags: MessageFlags.Ephemeral });
        }
        const amt = interaction.options.getInteger('amount', true);
        await setBaseReward(runtime, amt);
        return safeReply(`Base reward for calculations set to ${amt}.`, { flags: MessageFlags.Ephemeral });
    }
    // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
    if (interaction.commandName === 'runblocks') {
        // Only allow admins
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return safeReply('You do not have permission to use this command.', { flags: MessageFlags.Ephemeral });
        }
        const blocks = interaction.options.getInteger('blocks', true);
        const roleId = interaction.options.getString('role') ?? undefined;
        const channelId = interaction.options.getString('channel') ?? undefined;
        if (blocks <= 0) {
            return safeReply('Blocks must be greater than 0.', { flags: MessageFlags.Ephemeral });
        }
        runtime.autorunRemainingBlocks = blocks;
        if (roleId) runtime.notifyRoleId = roleId;
        if (channelId) runtime.notifyChannelId = channelId;
        return safeReply(`Autorun started for ${blocks} block(s). Notifications: ${roleId ? `<@&${roleId}>` : 'current setting'} in ${channelId ? `<#${channelId}>` : 'current setting or unset'}.`, { flags: MessageFlags.Ephemeral });
    }
    if (interaction.commandName === 'finalleaderboard') {
        // Short-lived cache to protect against rapid repeated calls in busy channels
        (global as any).__slashLbCache ??= { content: '', expiresAt: 0 } as { content: string; expiresAt: number };
        const cache = (global as any).__slashLbCache as { content: string; expiresAt: number };
        const now = Date.now();
        if (cache.content && cache.expiresAt > now) {
            return safeReply(cache.content);
        }
        const leaderboard = await getLeaderboard(runtime, interaction);
        (global as any).__slashLbCache = { content: leaderboard, expiresAt: now + 5000 }; // 5s cache
        return safeReply(leaderboard);
    }
    // Note: grumble command is handled in index.ts to avoid duplicate handling
}

export async function registerCommands(token: string, clientId: string, guildId?: string) {
    const rest = new REST({ version: '10' }).setToken(token);
    if (guildId) {
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    } else {
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
    }
}


