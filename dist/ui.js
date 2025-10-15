"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPanel = buildPanel;
exports.buildChoiceMenu = buildChoiceMenu;
exports.buildGrumblePanel = buildGrumblePanel;
exports.buildGrumbleRuneSelection = buildGrumbleRuneSelection;
exports.buildGrumbleAmountInput = buildGrumbleAmountInput;
const discord_js_1 = require("discord.js");
const game_1 = require("./game");
function buildPanel(runtime) {
    const state = runtime.state.data;
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0x6C63FF)
        .setTitle(`Block ${state.currentBlock}`)
        .addFields(
    // Show only the total reward, not the base reward per block
    { name: 'Total Reward', value: `${(state.totalRewardsPerBlock ?? 1000000).toLocaleString()} GLYPHS`, inline: false }, { name: 'Next Block In', value: (0, game_1.formatDuration)((0, game_1.timeLeftMs)(runtime)), inline: false }, { name: 'Miners', value: `${Object.keys(runtime.currentChoices).length}`, inline: false }, { name: 'Last Bot Choice', value: state.lastBotChoice ? `Bot picked: ${state.lastBotChoice}` : 'No previous choice', inline: false })
        .setFooter({ text: new Date(state.nextBlockAt).toLocaleString() });
    const mineBtn = new discord_js_1.ButtonBuilder().setCustomId('mine').setLabel('Mine').setStyle(discord_js_1.ButtonStyle.Primary);
    const balanceBtn = new discord_js_1.ButtonBuilder().setCustomId('balance').setLabel('Balance').setStyle(discord_js_1.ButtonStyle.Secondary);
    const lastRewardBtn = new discord_js_1.ButtonBuilder().setCustomId('lastreward').setLabel('Last Block Reward').setStyle(discord_js_1.ButtonStyle.Secondary);
    const rewardRecordsBtn = new discord_js_1.ButtonBuilder().setCustomId('rewardrecords').setLabel('Reward Records').setStyle(discord_js_1.ButtonStyle.Secondary);
    const leaderboardBtn = new discord_js_1.ButtonBuilder().setCustomId('leaderboard').setLabel('Leaderboard').setStyle(discord_js_1.ButtonStyle.Secondary);
    // All buttons fit in one row now (5 buttons max)
    const rows = [new discord_js_1.ActionRowBuilder().addComponents(mineBtn, balanceBtn, lastRewardBtn, rewardRecordsBtn, leaderboardBtn)];
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
function buildGrumblePanel(prizePool, joined, runtime) {
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0xFF5733)
        .setTitle('Grumble: Win all or Lose all!')
        .addFields({ name: 'Prize Pool', value: `${prizePool.toLocaleString()} GLYPHS`, inline: false }, { name: 'How to Play', value: 'Click Join to enter the grumble and bet your glyphs! Closest guess to the bot wins the pool after the next block.' });
    // Add timing information if runtime is provided
    if (runtime) {
        const isCustomTimer = (0, game_1.isGrumbleUsingCustomTimer)(runtime);
        const timeLeft = (0, game_1.getGrumbleTimeLeft)(runtime);
        const timeLeftFormatted = (0, game_1.formatDuration)(timeLeft);
        if (isCustomTimer) {
            embed.addFields({ name: 'Grumble Timer', value: timeLeftFormatted, inline: false });
        }
        else {
            embed.addFields({ name: 'Next Block In', value: timeLeftFormatted, inline: false });
        }
    }
    const joinBtn = new discord_js_1.ButtonBuilder()
        .setCustomId('grumble_join')
        .setLabel(joined ? 'View My Bets' : 'View My Bets')
        .setStyle(joined ? discord_js_1.ButtonStyle.Success : discord_js_1.ButtonStyle.Primary);
    const checkBetBtn = new discord_js_1.ButtonBuilder()
        .setCustomId('checkbet')
        .setLabel('Check My Bet')
        .setStyle(discord_js_1.ButtonStyle.Secondary);
    const row = new discord_js_1.ActionRowBuilder().addComponents(joinBtn, checkBetBtn);
    return { embed, rows: [row] };
}
function buildGrumbleRuneSelection() {
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0xFF5733)
        .setTitle('Choose Your Rune')
        .setDescription('Select the rune you want to bet on for the grumble:');
    // Create buttons for all 22 runes in a grid layout (5 columns)
    const buttons = game_1.SYMBOLS.map((rune) => {
        return new discord_js_1.ButtonBuilder()
            .setCustomId(`grumble_rune_${rune}`)
            .setLabel(rune)
            .setStyle(discord_js_1.ButtonStyle.Secondary);
    });
    // Split buttons into rows of 5
    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) {
        const rowButtons = buttons.slice(i, i + 5);
        rows.push(new discord_js_1.ActionRowBuilder().addComponents(...rowButtons));
    }
    return { embed, rows };
}
function buildGrumbleAmountInput(selectedRune, userBalance) {
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0xFF5733)
        .setTitle('Choose Your Bet Amount')
        .setDescription(`You selected: **${selectedRune}**\nYour balance: **${userBalance.toLocaleString()} GLYPHS**\n\nChoose how much you want to bet:`);
    // Create amount buttons with common amounts
    const amounts = [
        Math.floor(userBalance * 0.1), // 10%
        Math.floor(userBalance * 0.25), // 25%
        Math.floor(userBalance * 0.5), // 50%
        Math.floor(userBalance * 0.75), // 75%
        userBalance // 100%
    ].filter(amount => amount > 0).slice(0, 5); // Remove duplicates and limit to 5
    // Add some fixed amounts if user has enough
    const fixedAmounts = [1000, 5000, 10000, 25000, 50000];
    for (const amount of fixedAmounts) {
        if (amount <= userBalance && !amounts.includes(amount)) {
            amounts.push(amount);
        }
    }
    // Sort and limit to 5 buttons
    amounts.sort((a, b) => a - b);
    const finalAmounts = amounts.slice(0, 5);
    const buttons = finalAmounts.map((amount) => {
        return new discord_js_1.ButtonBuilder()
            .setCustomId(`grumble_amount_${amount}`)
            .setLabel(`${amount.toLocaleString()} GLYPHS`)
            .setStyle(discord_js_1.ButtonStyle.Primary);
    });
    const row = new discord_js_1.ActionRowBuilder().addComponents(...buttons);
    return { embed, rows: [row] };
}
//# sourceMappingURL=ui.js.map