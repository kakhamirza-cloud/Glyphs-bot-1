"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPanel = buildPanel;
exports.buildChoiceMenu = buildChoiceMenu;
const discord_js_1 = require("discord.js");
const game_1 = require("./game");
function buildPanel(runtime) {
    const state = runtime.state.data;
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0x6C63FF)
        .setTitle(`Block ${state.currentBlock}`)
        .addFields({ name: 'Base Reward', value: `1,000 GLYPHS per block`, inline: false }, { name: 'Next Block In', value: (0, game_1.formatDuration)((0, game_1.timeLeftMs)(runtime)), inline: false }, { name: 'Miners', value: `${Object.keys(runtime.currentChoices).length}`, inline: false }, { name: 'Last Bot Choice', value: state.lastBotChoice ? `Bot picked: ${state.lastBotChoice}` : 'No previous choice', inline: false })
        .setFooter({ text: new Date(state.nextBlockAt).toLocaleString() });
    const mineBtn = new discord_js_1.ButtonBuilder().setCustomId('mine').setLabel('Mine').setStyle(discord_js_1.ButtonStyle.Primary);
    const balanceBtn = new discord_js_1.ButtonBuilder().setCustomId('balance').setLabel('Balance').setStyle(discord_js_1.ButtonStyle.Secondary);
    const lastRewardBtn = new discord_js_1.ButtonBuilder().setCustomId('lastreward').setLabel('Last Block Reward').setStyle(discord_js_1.ButtonStyle.Secondary);
    const rewardRecordsBtn = new discord_js_1.ButtonBuilder().setCustomId('rewardrecords').setLabel('Reward Records').setStyle(discord_js_1.ButtonStyle.Secondary);
    const rows = [new discord_js_1.ActionRowBuilder().addComponents(mineBtn, balanceBtn, lastRewardBtn, rewardRecordsBtn)];
    return { embed, rows };
}
function buildChoiceMenu(selected) {
    // Create buttons for each rune in a grid layout
    const buttons = game_1.SYMBOLS.map((s, index) => {
        const button = new discord_js_1.ButtonBuilder()
            .setCustomId(`rune_${s}`)
            .setLabel(s)
            .setStyle(selected === s ? discord_js_1.ButtonStyle.Success : discord_js_1.ButtonStyle.Secondary);
        return button;
    });
    console.log(`Creating grid with ${buttons.length} rune buttons`);
    // Split buttons into rows of 5 (like the image shows 5 columns)
    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) {
        const rowButtons = buttons.slice(i, i + 5);
        rows.push(new discord_js_1.ActionRowBuilder().addComponents(...rowButtons));
    }
    return rows;
}
//# sourceMappingURL=ui.js.map