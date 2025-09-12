import { SlashCommandBuilder, ChatInputCommandInteraction, REST, Routes } from 'discord.js';
import { GameRuntime, setBlockDuration, setCurrentBlock, setTotalRewards } from './game';

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
    new SlashCommandBuilder().setName('stop').setDescription('Stop the bot (admin only)'),
    new SlashCommandBuilder().setName('shutdown').setDescription('Fully shut down the bot process (admin only)'),
    new SlashCommandBuilder().setName('setbasereward').setDescription('Set base reward per block (admin only)').addIntegerOption(o=>o.setName('amount').setDescription('Base reward').setRequired(true)),
].map(c=>c.toJSON());

export async function handleSlash(interaction: ChatInputCommandInteraction, runtime: GameRuntime) {
    // Soft stop: Only allow /start if inactive
    if (!runtime.isActive && interaction.commandName !== 'start' && interaction.commandName !== 'shutdown') {
        return interaction.reply({ content: 'Bot is currently stopped. Use /start to enable it again.', flags: 64 });
    }
    if (interaction.commandName === 'shutdown') {
        await interaction.reply({ content: 'Bot is shutting down. Bye!', flags: 64 });
        process.exit(0);
    }
    if (interaction.commandName === 'start') {
        if (runtime.isActive) {
            return interaction.reply({ content: 'Bot is already running.', flags: 64 });
        }
        runtime.isActive = true;
        return interaction.reply({ content: 'Bot has been started and is now active.', flags: 64 });
    }
    if (interaction.commandName === 'post') {
        if (!interaction.channel || !interaction.channel.isTextBased()) return;
        // postPanel is called in index.ts, so just reply here
        return interaction.reply({ content: 'Panel posted.', flags: 64 });
    }
    if (interaction.commandName === 'stop') {
        if (!runtime.isActive) {
            return interaction.reply({ content: 'Bot is already stopped.', flags: 64 });
        }
        runtime.isActive = false;
        return interaction.reply({ content: 'Bot has been stopped. Use /start to enable it again.', flags: 64 });
    }
    if (interaction.commandName === 'setblock') {
        const n = interaction.options.getInteger('number', true);
        await setCurrentBlock(runtime, n);
        return interaction.reply({ content: `Block set to ${n}.`, flags: 64 });
    }
    if (interaction.commandName === 'setrewards') {
        const amt = interaction.options.getInteger('amount', true);
        await setTotalRewards(runtime, amt);
        return interaction.reply({ content: `Total rewards per block set to ${amt}.`, flags: 64 });
    }
    if (interaction.commandName === 'setduration') {
        const sec = interaction.options.getInteger('seconds', true);
        await setBlockDuration(runtime, sec);
        return interaction.reply({ content: `Block duration set to ${sec}s.`, flags: 64 });
    }
    if (interaction.commandName === 'resetbalances') {
        runtime.balances.data = {};
        await runtime.balances.write();
        return interaction.reply({ content: 'All balances reset.', flags: 64 });
    }
    if (interaction.commandName === 'resetrecords') {
        runtime.state.data.blockHistory = [];
        await runtime.state.write();
        return interaction.reply({ content: 'All reward records reset.', flags: 64 });
    }
    if (interaction.commandName === 'resetall') {
        runtime.balances.data = {};
        runtime.state.data.blockHistory = [];
        runtime.state.data.currentBlock = 1;
        runtime.state.data.nextBlockAt = Date.now() + runtime.state.data.blockDurationSec * 1000;
        runtime.state.data.lastBotChoice = undefined;
        await runtime.balances.write();
        await runtime.state.write();
        return interaction.reply({ content: 'Everything reset: blocks, balances, and records.', flags: 64 });
    }
    if (interaction.commandName === 'restart') {
        runtime.isActive = false;
        runtime.isActive = true;
        return interaction.reply({ content: 'Bot has been restarted (soft stop/start).', flags: 64 });
    }
    if (interaction.commandName === 'stop') {
        await interaction.reply({ content: 'Stopping bot...', flags: 64 });
        console.log('Bot stop requested by admin');
        process.exit(1); // Exit with error code to prevent nodemon restart
        return;
    }
    if (interaction.commandName === 'setbasereward') {
        // Only allow admins
        if (!interaction.memberPermissions || !interaction.memberPermissions.has('Administrator')) {
            return interaction.reply({ content: 'You do not have permission to use this command.', flags: 64 });
        }
        const amt = interaction.options.getInteger('amount', true);
        await setTotalRewards(runtime, amt);
        return interaction.reply({ content: `Base reward per block set to ${amt}.`, flags: 64 });
    }
}

export async function registerCommands(token: string, clientId: string, guildId?: string) {
    const rest = new REST({ version: '10' }).setToken(token);
    if (guildId) {
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    } else {
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
    }
}


