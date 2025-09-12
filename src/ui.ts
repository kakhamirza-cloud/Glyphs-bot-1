import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { GameRuntime, SYMBOLS, SymbolRune, formatDuration, timeLeftMs } from './game';

export function buildPanel(runtime: GameRuntime) {
    const state = runtime.state.data;
    const embed = new EmbedBuilder()
        .setColor(0x6C63FF)
        .setTitle(`Block ${state.currentBlock}`)
        .addFields(
            // Show only the total reward, not the base reward per block
            { name: 'Total Reward', value: `1,000,000 GLYPHS`, inline: false },
            { name: 'Next Block In', value: formatDuration(timeLeftMs(runtime)), inline: false },
            { name: 'Miners', value: `${Object.keys(runtime.currentChoices).length}`, inline: false },
            { name: 'Last Bot Choice', value: state.lastBotChoice ? `Bot picked: ${state.lastBotChoice}` : 'No previous choice', inline: false },
        )
        .setFooter({ text: new Date(state.nextBlockAt).toLocaleString() });

    const mineBtn = new ButtonBuilder().setCustomId('mine').setLabel('Mine').setStyle(ButtonStyle.Primary);
    const balanceBtn = new ButtonBuilder().setCustomId('balance').setLabel('Balance').setStyle(ButtonStyle.Secondary);
    const lastRewardBtn = new ButtonBuilder().setCustomId('lastreward').setLabel('Last Block Reward').setStyle(ButtonStyle.Secondary);
    const rewardRecordsBtn = new ButtonBuilder().setCustomId('rewardrecords').setLabel('Reward Records').setStyle(ButtonStyle.Secondary);
    const leaderboardBtn = new ButtonBuilder().setCustomId('leaderboard').setLabel('Leaderboard').setStyle(ButtonStyle.Secondary);
    const rows = [new ActionRowBuilder<ButtonBuilder>().addComponents(mineBtn, balanceBtn, lastRewardBtn, rewardRecordsBtn, leaderboardBtn)];
    return { embed, rows };
}

export function buildChoiceMenu(selected?: SymbolRune) {
    // Create buttons for each rune in a grid layout
    const buttons = SYMBOLS.map((s, index) => {
        const button = new ButtonBuilder()
            .setCustomId(`rune_${s}`)
            .setLabel(s)
            .setStyle(selected === s ? ButtonStyle.Success : ButtonStyle.Secondary);
        return button;
    });
    
    console.log(`Creating grid with ${buttons.length} rune buttons`);
    
    // Split buttons into rows of 5 (like the image shows 5 columns)
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    for (let i = 0; i < buttons.length; i += 5) {
        const rowButtons = buttons.slice(i, i + 5);
        rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...rowButtons));
    }
    
    return rows;
}


