import 'dotenv/config';
import { Client, GatewayIntentBits, Interaction, MessageComponentInteraction, StringSelectMenuInteraction, Events, TextChannel } from 'discord.js';
import { buildChoiceMenu, buildPanel } from './ui';
import { GameRuntime, initGame, recordChoice, SYMBOLS, SymbolRune, startTicker, getBalance, getLastBlockRewardInfo, getUserRewardRecords, getLeaderboard } from './game';
import { handleSlash } from './commands';

let runtime: GameRuntime;
let ticker: NodeJS.Timeout | undefined;
let panelMessageId: string | undefined;
let panelChannelId: string | undefined;

async function ensureTicker(client: Client) {
    if (!ticker) {
        ticker = startTicker(runtime);
        runtime.onBlockAdvance = async () => {
            await refreshPanel(client);
        };
    }
}

async function refreshPanel(client: Client) {
    if (!panelChannelId || !panelMessageId) return;
    const channel = await client.channels.fetch(panelChannelId);
    if (!channel || !channel.isTextBased()) return;
    const { embed, rows } = buildPanel(runtime);
    try {
        const msg = await (channel as TextChannel).messages.fetch(panelMessageId);
        await msg.edit({ embeds: [embed], components: rows });
    } catch {
        // swallow if message no longer accessible
    }
}

async function postPanel(channel: TextChannel) {
    const { embed, rows } = buildPanel(runtime);
    // Send the panel message and store its ID for future updates
    const message = await channel.send({ embeds: [embed], components: rows });
    panelMessageId = message.id;
    panelChannelId = channel.id;
}

async function main() {
    runtime = await initGame();

    const client = new Client({ intents: [GatewayIntentBits.Guilds] });

    client.once(Events.ClientReady, async () => {
        await ensureTicker(client);
        console.log('Glyphs bot ready');
    });

    client.on(Events.InteractionCreate, async (interaction: Interaction) => {
        if (interaction.isChatInputCommand()) {
            // Always allow /start and /stop
            if (interaction.commandName === 'start' || interaction.commandName === 'stop') {
                await handleSlash(interaction, runtime);
                await refreshPanel(client);
                return;
            }
            // Only allow other commands if active
            if (!runtime.isActive) {
                return interaction.reply({ content: 'Bot is currently stopped. Use /start to enable it again.', flags: 64 });
            }
            if (interaction.commandName === 'post') {
                if (!interaction.channel || !interaction.channel.isTextBased()) return;
                await postPanel(interaction.channel as TextChannel);
                await handleSlash(interaction, runtime); // reply handled in commands.ts
                await refreshPanel(client);
                return;
            }
            if (interaction.commandName === 'start') {
                if (!interaction.channel || !interaction.channel.isTextBased()) return;
                await postPanel(interaction.channel as TextChannel);
                return interaction.reply({ content: 'Panel posted.', flags: 64 });
            }
            await handleSlash(interaction, runtime);
            await refreshPanel(client);
            return;
        }

        if (interaction.isButton()) {
            // Handle the 'mine' button
            if (interaction.customId === 'mine') {
                const selected = runtime.currentChoices[interaction.user.id] as SymbolRune | undefined;
                const buttonRows = buildChoiceMenu(selected);
                return interaction.reply({ content: 'Pick your rune:', components: buttonRows, flags: 64 });
            }
            // Handle the 'balance' button
            if (interaction.customId === 'balance') {
                const bal = getBalance(runtime, interaction.user.id);
                return interaction.reply({ content: `Your balance: ${bal.toLocaleString()} GLYPHS`, flags: 64 });
            }
            // Handle the 'lastreward' button
            if (interaction.customId === 'lastreward') {
                const lastBlockInfo = getLastBlockRewardInfo(runtime);
                return interaction.reply({ content: lastBlockInfo, flags: 64 });
            }
            // Handle the 'rewardrecords' button
            if (interaction.customId === 'rewardrecords') {
                const userRecords = getUserRewardRecords(runtime, interaction.user.id);
                return interaction.reply({ content: userRecords, flags: 64 });
            }
            // Handle the 'leaderboard' button
            if (interaction.customId === 'leaderboard') {
                const leaderboard = await getLeaderboard(runtime, interaction);
                return interaction.reply({ content: leaderboard, flags: 64 });
            }
            // Handle rune selection buttons
            if (interaction.customId.startsWith('rune_')) {
                const choice = interaction.customId.replace('rune_', '') as SymbolRune;
                if (!SYMBOLS.includes(choice)) return interaction.reply({ content: 'Invalid choice.', flags: 64 });
                await recordChoice(runtime, interaction.user.id, choice);
                const buttonRows = buildChoiceMenu(choice);
                await interaction.update({ content: `You chose ${choice}. You can change it until the block ends.`, components: buttonRows });
                await refreshPanel(client);
                return;
            }
        }
    });

    await client.login(process.env.DISCORD_TOKEN!);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});


