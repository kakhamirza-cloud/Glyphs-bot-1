import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { GameRuntime, SYMBOLS, SymbolRune, formatDuration, timeLeftMs, getGrumbleTimeLeft, isGrumbleUsingCustomTimer, PACK_COST } from './game';

export function buildPanel(runtime: GameRuntime) {
    const state = runtime.state.data;
    const embed = new EmbedBuilder()
        .setColor(0x6C63FF)
        .setTitle(`Block ${state.currentBlock}`)
        .addFields(
            // Show only the total reward, not the base reward per block
            { name: 'Total Reward', value: `${(state.totalRewardsPerBlock ?? 1000000).toLocaleString()} GLYPHS`, inline: false },
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
    const marketBtn = new ButtonBuilder().setCustomId('market').setLabel('Market').setStyle(ButtonStyle.Success);
    
    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(mineBtn, balanceBtn, lastRewardBtn, rewardRecordsBtn);
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(leaderboardBtn, marketBtn);
    const rows = [row1, row2];
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

export function buildGrumblePanel(prizePool: number, joined: boolean, runtime?: GameRuntime) {
    const embed = new EmbedBuilder()
        .setColor(0xFF5733)
        .setTitle('Grumble: Win all or Lose all!')
        .addFields(
            { name: 'Prize Pool', value: `${prizePool.toLocaleString()} GLYPHS`, inline: false },
            { name: 'How to Play', value: 'Click Join to enter the grumble and bet your glyphs! Closest guess to the bot wins the pool after the next block.' }
        );
    
    // Add timing information if runtime is provided
    if (runtime) {
        const isCustomTimer = isGrumbleUsingCustomTimer(runtime);
        const timeLeft = getGrumbleTimeLeft(runtime);
        const timeLeftFormatted = formatDuration(timeLeft);
        
        if (isCustomTimer) {
            embed.addFields({ name: 'Grumble Timer', value: timeLeftFormatted, inline: false });
        } else {
            embed.addFields({ name: 'Next Block In', value: timeLeftFormatted, inline: false });
        }
    }
    
    const joinBtn = new ButtonBuilder()
        .setCustomId('grumble_join')
        .setLabel(joined ? 'View My Bets' : 'View My Bets')
        .setStyle(joined ? ButtonStyle.Success : ButtonStyle.Primary);
    
    const checkBetBtn = new ButtonBuilder()
        .setCustomId('checkbet')
        .setLabel('Check My Bet')
        .setStyle(ButtonStyle.Secondary);
    
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(joinBtn, checkBetBtn);
    return { embed, rows: [row] };
}

export function buildGrumbleRuneSelection() {
    const embed = new EmbedBuilder()
        .setColor(0xFF5733)
        .setTitle('Choose Your Rune')
        .setDescription('Select the rune you want to bet on for the grumble:');
    
    // Create buttons for all 22 runes in a grid layout (5 columns)
    const buttons = SYMBOLS.map((rune) => {
        return new ButtonBuilder()
            .setCustomId(`grumble_rune_${rune}`)
            .setLabel(rune)
            .setStyle(ButtonStyle.Secondary);
    });
    
    // Split buttons into rows of 5
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    for (let i = 0; i < buttons.length; i += 5) {
        const rowButtons = buttons.slice(i, i + 5);
        rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...rowButtons));
    }
    
    return { embed, rows };
}

export function buildGrumbleAmountInput(selectedRune: string, userBalance: number) {
    const embed = new EmbedBuilder()
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
        return new ButtonBuilder()
            .setCustomId(`grumble_amount_${amount}`)
            .setLabel(`${amount.toLocaleString()} GLYPHS`)
            .setStyle(ButtonStyle.Primary);
    });
    
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
    return { embed, rows: [row] };
}

export interface MarketViewOptions {
    packs: number;
    dollars: number;
    glyphBalance: number;
    canBuy: boolean;
    canClaim: boolean;
    dollarCap: number;
    minClaim: number;
}

export function buildMarketView(options: MarketViewOptions) {
    const { packs, dollars, glyphBalance, canBuy, canClaim, dollarCap, minClaim } = options;
    const embed = new EmbedBuilder()
        .setColor(0x3AA76D)
        .setTitle('Glyphs Market')
        .setDescription(
            [
                'Purchase packs with GLYPHS and collect dollar rewards.',
                `• Each pack costs **${PACK_COST.toLocaleString()} GLYPHS**.`,
                `• Dollar balance caps at **${dollarCap}$**.`,
                `• Claim becomes available between **${minClaim}$** and **${dollarCap}$**.`,
            ].join('\n')
        )
        .addFields(
            { name: 'Packs Owned', value: packs.toString(), inline: true },
            { name: 'Dollar Balance', value: `${dollars}$`, inline: true },
            { name: 'GLYPHS Balance', value: glyphBalance.toLocaleString(), inline: true },
        );

    if (!canBuy) {
        embed.addFields({ name: 'Buy Status', value: 'Not enough GLYPHS to buy a pack.', inline: false });
    }

    if (!canClaim) {
        if (dollars >= dollarCap) {
            embed.addFields({ name: 'Claim Status', value: `Dollar balance is capped. Spend or claim once you meet the minimum.`, inline: false });
        } else {
            embed.addFields({ name: 'Claim Status', value: `Collect at least ${minClaim}$ to unlock the claim button.`, inline: false });
        }
    }

    const buyBtn = new ButtonBuilder()
        .setCustomId('market_buy')
        .setLabel(`Buy Pack (${PACK_COST.toLocaleString()} GLYPHS)`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!canBuy);

    const claimBtn = new ButtonBuilder()
        .setCustomId('market_claim')
        .setLabel('Claim Dollars')
        .setStyle(ButtonStyle.Success)
        .setDisabled(!canClaim);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(buyBtn, claimBtn);
    return { embed, rows: [row] };
}


