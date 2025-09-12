import dayjs from 'dayjs';
import { Low } from 'lowdb';
import { openBalances, openState, BalanceMap, PersistedState, MemberResult, BlockHistory } from './storage';
import { User, Interaction } from 'discord.js';

// Ensure no duplicate runes - this will throw an error if duplicates are found
const RAW_SYMBOLS = [
    'ᚹ','ᚾ','ᚦ','ᚠ','ᚱ','ᚲ','ᛉ','ᛈ','ᚺ','ᛏ','ᛁ','ᛋ','ᛇ','ᚨ','ᛃ','ᛟ','ᛞ','ᛒ','ᛗ','ᛚ','ᛜ','ᛝ'
];

// Validate no duplicates
const uniqueSymbols = [...new Set(RAW_SYMBOLS)];
if (uniqueSymbols.length !== RAW_SYMBOLS.length) {
    console.error('ERROR: Duplicate runes found in SYMBOLS array!');
    console.error('Original count:', RAW_SYMBOLS.length);
    console.error('Unique count:', uniqueSymbols.length);
    process.exit(1);
}

export const SYMBOLS = uniqueSymbols as readonly string[];
export type SymbolRune = typeof SYMBOLS[number];

export interface PlayerChoiceMap { [userId: string]: SymbolRune; }

export interface GameRuntime {
    state: Low<PersistedState>;
    balances: Low<BalanceMap>;
    currentChoices: PlayerChoiceMap;
    isActive: boolean; // Soft stop/start flag
    onBlockAdvance?: (newBlock: number, botChoice: SymbolRune) => void;
}

export async function initGame(): Promise<GameRuntime> {
    const state = await openState();
    const balances = await openBalances();
    const runtime: GameRuntime = {
        state,
        balances,
        currentChoices: state.data.currentChoices || {},
        isActive: true, // Bot starts as active
    };
    return runtime;
}

export function timeLeftMs(runtime: GameRuntime): number {
    return Math.max(0, (runtime.state.data.nextBlockAt ?? Date.now()) - Date.now());
}

export function formatDuration(ms: number): string {
    const sec = Math.ceil(ms / 1000);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const parts = [] as string[];
    if (h) parts.push(`${h}h`);
    if (m || h) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
}

export function pickRandomSymbol(): SymbolRune {
    const index = Math.floor(Math.random() * SYMBOLS.length);
    return SYMBOLS[index] as SymbolRune;
}

export function symbolDistance(a: SymbolRune, b: SymbolRune): number {
    const ai = SYMBOLS.indexOf(a);
    const bi = SYMBOLS.indexOf(b);
    const direct = Math.abs(ai - bi);
    const wrap = SYMBOLS.length - direct;
    return Math.min(direct, wrap);
}

export function computeReward(baseReward: number, player: SymbolRune, bot: SymbolRune): number {
    const dist = symbolDistance(player, bot);
    // Randomized reward ranges per tier (scaled by baseReward/1000)
    let min = 0, max = 0;
    if (dist === 0) {
        min = 950; max = 1000; // Exact match
    } else if (dist > 7) {
        min = 150; max = 300; // Distance 8+
    } else if (dist > 3) {
        min = 400; max = 600; // Distance 4-7
    } else {
        min = 700; max = 900; // Distance 1-3
    }
    const reward = Math.floor(baseReward * (randomInt(min, max) / 1000));
    return reward;
}

function randomInt(min: number, max: number): number {
    // Inclusive min and max
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function setTotalRewards(runtime: GameRuntime, amount: number) {
    runtime.state.data.totalRewardsPerBlock = amount;
    await runtime.state.write();
}

export async function setBlockDuration(runtime: GameRuntime, seconds: number) {
    runtime.state.data.blockDurationSec = seconds;
    const now = Date.now();
    runtime.state.data.nextBlockAt = now + seconds * 1000;
    await runtime.state.write();
}

export async function setCurrentBlock(runtime: GameRuntime, block: number) {
    runtime.state.data.currentBlock = block;
    await runtime.state.write();
}

export function startTicker(runtime: GameRuntime): NodeJS.Timeout {
    const tick = async () => {
        if (Date.now() < (runtime.state.data.nextBlockAt ?? 0)) return;
        // Advance block
        const botChoice = pickRandomSymbol();
        await resolveBlock(runtime, botChoice);
        runtime.state.data.lastBotChoice = botChoice;
        runtime.state.data.currentBlock += 1;
        runtime.state.data.nextBlockAt = Date.now() + runtime.state.data.blockDurationSec * 1000;
        await runtime.state.write();
        runtime.currentChoices = {};
        runtime.state.data.currentChoices = {};
        await runtime.state.write();
        runtime.onBlockAdvance?.(runtime.state.data.currentBlock, botChoice);
    };
    return setInterval(tick, 1000);
}

export async function recordChoice(runtime: GameRuntime, userId: string, choice: SymbolRune) {
    runtime.currentChoices[userId] = choice;
    runtime.state.data.currentChoices = { ...runtime.currentChoices };
    await runtime.state.write();
}

export async function resolveBlock(runtime: GameRuntime, botChoice: SymbolRune) {
    const winners = Object.entries(runtime.currentChoices);
    if (winners.length === 0) return;
    
    // Base reward is 1000 GLYPHS per block
    const baseReward = 1000000;
    const currentBlock = runtime.state.data.currentBlock;
    
    // Store historical data for this block
    const memberResults: MemberResult[] = [];
    
    for (const [userId, playerChoice] of winners) {
        const distance = symbolDistance(playerChoice, botChoice);
        const reward = computeReward(baseReward, playerChoice, botChoice);
        const prev = runtime.balances.data[userId] ?? 0;
        runtime.balances.data[userId] = prev + reward;
        
        // Store member result for history
        memberResults.push({
            userId,
            choice: playerChoice,
            reward,
            distance
        });
    }
    
    // Add to block history
    const blockHistory: BlockHistory = {
        blockNumber: currentBlock,
        botChoice,
        memberResults,
        timestamp: Date.now()
    };
    
    runtime.state.data.blockHistory.push(blockHistory);
    
    // Keep only last 10 blocks of history to prevent data bloat
    if (runtime.state.data.blockHistory.length > 10) {
        runtime.state.data.blockHistory = runtime.state.data.blockHistory.slice(-10);
    }
    
    await runtime.balances.write();
}

export function getBalance(runtime: GameRuntime, userId: string): number {
    return runtime.balances.data[userId] ?? 0;
}

export function resetBalances(runtime: GameRuntime) {
    runtime.balances.data = {};
    return runtime.balances.write();
}

export function getLastBlockRewardInfo(runtime: GameRuntime): string {
    const currentBlock = runtime.state.data.currentBlock;
    const lastBlock = currentBlock - 1;
    
    if (lastBlock < 1) {
        return "No previous block data available yet.";
    }
    
    // Find the last block's history
    const lastBlockHistory = runtime.state.data.blockHistory.find(h => h.blockNumber === lastBlock);
    
    if (!lastBlockHistory || lastBlockHistory.memberResults.length === 0) {
        return "No member data available for the last block.";
    }
    
    let info = `**Block ${lastBlock} Member Results:**\n\n`;
    
    // Sort members by reward (highest first)
    const sortedResults = lastBlockHistory.memberResults.sort((a, b) => b.reward - a.reward);
    
    for (const result of sortedResults) {
        info += `• **<@${result.userId}>** chose ${result.choice} → ${result.reward.toLocaleString()} GLYPHS\n`;
    }
    
    return info;
}

export function getUserRewardRecords(runtime: GameRuntime, userId: string): string {
    const userHistory = runtime.state.data.blockHistory
        .filter(block => block.memberResults.some(result => result.userId === userId))
        .sort((a, b) => b.blockNumber - a.blockNumber); // Most recent first
    
    if (userHistory.length === 0) {
        return "You haven't participated in any blocks yet.";
    }
    
    let info = `**Your Reward Records:**\n\n`;
    let totalEarned = 0;
    
    for (const block of userHistory) {
        const userResult = block.memberResults.find(result => result.userId === userId);
        if (userResult) {
            info += `**Block ${block.blockNumber}:**\n`;
            info += `• Bot chose: ${block.botChoice}\n`;
            info += `• You chose: ${userResult.choice}\n`;
            info += `• Reward: ${userResult.reward.toLocaleString()} GLYPHS\n\n`;
            totalEarned += userResult.reward;
        }
    }
    
    info += `**Total Earned:** ${totalEarned.toLocaleString()} GLYPHS`;
    
    return info;
}

export async function getLeaderboard(runtime: GameRuntime, interaction: Interaction): Promise<string> {
    // Gather stats for all users who have ever participated
    const userStats: Record<string, {
        balance: number,
        picks: Record<string, number>,
        exactMatches: number
    }> = {};
    // Go through all block history
    for (const block of runtime.state.data.blockHistory) {
        for (const result of block.memberResults) {
            if (!userStats[result.userId]) {
                userStats[result.userId] = { balance: 0, picks: {}, exactMatches: 0 };
            }
            const stats = userStats[result.userId];
            if (stats) {
                stats.balance = runtime.balances.data[result.userId] ?? 0;
                stats.picks[result.choice] = (stats.picks[result.choice] || 0) + 1;
                if (result.distance === 0) stats.exactMatches++;
            }
        }
    }
    // If no data
    if (Object.keys(userStats).length === 0) return 'No leaderboard data yet.';
    // Sort by exact matches, then balance
    const sorted = Object.entries(userStats).sort((a, b) => {
        if (b[1].exactMatches !== a[1].exactMatches) return b[1].exactMatches - a[1].exactMatches;
        return b[1].balance - a[1].balance;
    });
    // Prepare leaderboard lines
    let lines = '**Leaderboard (Top 10 by Exact Matches):**\n\n';
    let rank = 1;
    let userIdToUsername: Record<string, string> = {};
    // Fetch usernames for top 10 and the requesting user
    const topUserIds = sorted.slice(0, 10).map(([uid]) => uid);
    if (!topUserIds.includes(interaction.user.id)) topUserIds.push(interaction.user.id);
    for (const uid of topUserIds) {
        try {
            const user = await interaction.client.users.fetch(uid);
            userIdToUsername[uid] = user.username;
        } catch {
            userIdToUsername[uid] = uid;
        }
    }
    for (let i = 0; i < Math.min(10, sorted.length); i++) {
        const entry = sorted[i];
        if (!entry) continue;
        const [uid, stats] = entry;
        if (!stats) continue;
        const picksEntries = Object.entries(stats.picks);
        let mostPicked = '-';
        if (picksEntries.length > 0) {
            const sortedPick = picksEntries.sort((a, b) => b[1] - a[1])[0];
            if (sortedPick && sortedPick[0]) mostPicked = sortedPick[0];
        }
        lines += `${rank}. **${userIdToUsername[uid]}** | Balance: ${stats.balance.toLocaleString()} | Most Picked: ${mostPicked} | Exact Matches: ${stats.exactMatches}\n`;
        rank++;
    }
    // If requesting user not in top 10, show their stats
    if (!topUserIds.slice(0, 10).includes(interaction.user.id) && userStats[interaction.user.id]) {
        const stats = userStats[interaction.user.id];
        if (stats) {
            const picksEntries = Object.entries(stats.picks);
            let mostPicked = '-';
            if (picksEntries.length > 0) {
                const sortedPick = picksEntries.sort((a, b) => b[1] - a[1])[0];
                if (sortedPick && sortedPick[0]) mostPicked = sortedPick[0];
            }
            lines += `\nYour Rank: ${sorted.findIndex(([uid]) => uid === interaction.user.id) + 1}. **${userIdToUsername[interaction.user.id]}** | Balance: ${stats.balance.toLocaleString()} | Most Picked: ${mostPicked} | Exact Matches: ${stats.exactMatches}\n`;
        }
    }
    return lines;
}


