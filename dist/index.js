"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const discord_js_1 = require("discord.js");
const ui_1 = require("./ui");
const game_1 = require("./game");
const commands_1 = require("./commands");
let runtime;
let ticker;
let panelMessageId;
let panelChannelId;
async function ensureTicker(client) {
    if (!ticker) {
        ticker = (0, game_1.startTicker)(runtime);
        runtime.onBlockAdvance = async () => {
            await refreshPanel(client);
        };
    }
}
async function refreshPanel(client) {
    if (!panelChannelId || !panelMessageId)
        return;
    const channel = await client.channels.fetch(panelChannelId);
    if (!channel || !channel.isTextBased())
        return;
    const { embed, rows } = (0, ui_1.buildPanel)(runtime);
    try {
        const msg = await channel.messages.fetch(panelMessageId);
        await msg.edit({ embeds: [embed], components: rows });
    }
    catch {
        // swallow if message no longer accessible
    }
}
async function postPanel(channel) {
    const { embed, rows } = (0, ui_1.buildPanel)(runtime);
    const message = await channel.send({ embeds: [embed], components: rows });
    panelMessageId = message.id;
    panelChannelId = channel.id;
}
async function main() {
    runtime = await (0, game_1.initGame)();
    const client = new discord_js_1.Client({ intents: [discord_js_1.GatewayIntentBits.Guilds] });
    client.once(discord_js_1.Events.ClientReady, async () => {
        await ensureTicker(client);
        console.log('Glyphs bot ready');
    });
    client.on(discord_js_1.Events.InteractionCreate, async (interaction) => {
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'start') {
                if (!interaction.channel || !interaction.channel.isTextBased())
                    return;
                await postPanel(interaction.channel);
                return interaction.reply({ content: 'Panel posted.', flags: 64 });
            }
            await (0, commands_1.handleSlash)(interaction, runtime);
            await refreshPanel(client);
            return;
        }
        if (interaction.isButton()) {
            if (interaction.customId === 'mine') {
                const selected = runtime.currentChoices[interaction.user.id];
                const buttonRows = (0, ui_1.buildChoiceMenu)(selected);
                return interaction.reply({ content: 'Pick your rune:', components: buttonRows, flags: 64 });
            }
            if (interaction.customId === 'balance') {
                const bal = (0, game_1.getBalance)(runtime, interaction.user.id);
                return interaction.reply({ content: `Your balance: ${bal.toLocaleString()} GLYPHS`, flags: 64 });
            }
            if (interaction.customId === 'lastreward') {
                const lastBlockInfo = (0, game_1.getLastBlockRewardInfo)(runtime);
                return interaction.reply({ content: lastBlockInfo, flags: 64 });
            }
            if (interaction.customId === 'rewardrecords') {
                const userRecords = (0, game_1.getUserRewardRecords)(runtime, interaction.user.id);
                return interaction.reply({ content: userRecords, flags: 64 });
            }
        }
        if (interaction.isButton() && interaction.customId.startsWith('rune_')) {
            const choice = interaction.customId.replace('rune_', '');
            if (!game_1.SYMBOLS.includes(choice))
                return interaction.reply({ content: 'Invalid choice.', flags: 64 });
            await (0, game_1.recordChoice)(runtime, interaction.user.id, choice);
            const buttonRows = (0, ui_1.buildChoiceMenu)(choice);
            await interaction.update({ content: `You chose ${choice}. You can change it until the block ends.`, components: buttonRows });
            await refreshPanel(client);
            return;
        }
    });
    await client.login(process.env.DISCORD_TOKEN);
}
main().catch(err => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map