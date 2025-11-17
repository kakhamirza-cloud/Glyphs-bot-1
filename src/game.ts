import dayjs from 'dayjs';
import * as fs from 'fs';
import * as path from 'path';
import { openBalances, openState, BalanceMap, PersistedState, MemberResult, BlockHistory, GrumbleState, AuctionState } from './storage';

export type { AuctionState };
import { Interaction, DiscordAPIError } from 'discord.js';

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
    state: { data: PersistedState; write(): Promise<void> };
    balances: { data: BalanceMap; write(): Promise<void> };
    currentChoices: PlayerChoiceMap;
    isActive: boolean; // Soft stop/start flag
    onBlockAdvance?: (newBlock: number, botChoice: SymbolRune) => void;
    // Auto-run configuration
    autorunRemainingBlocks?: number | undefined;
    notifyRoleId?: string | undefined;
    notifyChannelId?: string | undefined;
}

export async function initGame(): Promise<GameRuntime> {
    const state = await openState();
    const balances = await openBalances();
    const runtime: GameRuntime = {
        state,
        balances,
        currentChoices: state.data.currentChoices || {},
        isActive: true, // Bot starts as active
        autorunRemainingBlocks: undefined,
        notifyRoleId: process.env.DISCORD_NOTIFY_ROLE_ID,
        notifyChannelId: process.env.DISCORD_NOTIFY_CHANNEL_ID,
    };
    runtime.state.data.marketPacks ??= {};
    runtime.state.data.marketDollars ??= {};
    runtime.state.data.totalClaimedDollars ??= 0;
    runtime.state.data.claimLimit ??= 80;
    runtime.state.data.claimButtonDisabled ??= false;
    runtime.state.data.auctions ??= {};
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

export const PACK_COST = 500;
export const MARKET_MIN_CLAIM_DOLLARS = 10;
export const MARKET_MAX_DOLLAR_BALANCE = 20;
export const MARKET_PURCHASE_IMAGE_URL = 'https://i.imgur.com/avZ3tRj.jpeg';
export const ROLE_MARKET_ALL_PRIZES = '1224077301092843620';
export const ROLE_MARKET_LIMITED_DOLLARS = '1207680848862777417';

export interface PackPrizeDefinition {
    id: string;
    label: string;
    type: 'glyphs' | 'dollar';
    amount: number;
    weight: number;
    imageUrl: string;
}

const PACK_PRIZE_DEFINITIONS: PackPrizeDefinition[] = [
    { id: 'glyphs_250', label: '250 GLYPHS', type: 'glyphs', amount: 250, weight: 750, imageUrl: 'https://i.imgur.com/SwuzzoO.png' },
    { id: 'glyphs_500', label: '500 GLYPHS', type: 'glyphs', amount: 500, weight: 150, imageUrl: 'https://i.imgur.com/WK6QAsK.png' },
    { id: 'glyphs_750', label: '750 GLYPHS', type: 'glyphs', amount: 750, weight: 60, imageUrl: 'https://i.imgur.com/1oBOxsi.png' },
    { id: 'dollar_1', label: '$1', type: 'dollar', amount: 1, weight: 25, imageUrl: 'https://i.imgur.com/oyPLjoG.png' },
    { id: 'dollar_2', label: '$2', type: 'dollar', amount: 2, weight: 10, imageUrl: 'https://i.imgur.com/UHvsr15.png' },
    { id: 'dollar_3', label: '$3', type: 'dollar', amount: 3, weight: 4, imageUrl: 'https://i.imgur.com/Tgrt4ow.png' },
    { id: 'dollar_4', label: '$4', type: 'dollar', amount: 4, weight: 1, imageUrl: 'https://i.imgur.com/UOl6uz0.png' },
];

export function getUserPackCount(runtime: GameRuntime, userId: string): number {
    runtime.state.data.marketPacks ??= {};
    return runtime.state.data.marketPacks[userId] ?? 0;
}

export async function addPackToUser(runtime: GameRuntime, userId: string, count: number = 1): Promise<number> {
    runtime.state.data.marketPacks ??= {};
    const current = runtime.state.data.marketPacks[userId] ?? 0;
    const updated = Math.max(0, current + count);
    if (updated === 0) {
        delete runtime.state.data.marketPacks[userId];
    } else {
        runtime.state.data.marketPacks[userId] = updated;
    }
    await runtime.state.write();
    return runtime.state.data.marketPacks[userId] ?? 0;
}

export async function consumePackFromUser(runtime: GameRuntime, userId: string): Promise<number> {
    const current = getUserPackCount(runtime, userId);
    if (current <= 0) {
        throw new Error('NO_PACKS_AVAILABLE');
    }
    return addPackToUser(runtime, userId, -1);
}

export function getUserDollarBalance(runtime: GameRuntime, userId: string): number {
    runtime.state.data.marketDollars ??= {};
    return runtime.state.data.marketDollars[userId] ?? 0;
}

export interface DollarBalanceUpdate {
    added: number;
    newBalance: number;
    capped: boolean;
}

export async function addDollarsToUser(runtime: GameRuntime, userId: string, amount: number): Promise<DollarBalanceUpdate> {
    runtime.state.data.marketDollars ??= {};
    const current = runtime.state.data.marketDollars[userId] ?? 0;
    const room = Math.max(0, MARKET_MAX_DOLLAR_BALANCE - current);
    const added = Math.max(0, Math.min(room, amount));
    const newBalance = current + added;
    if (newBalance <= 0) {
        delete runtime.state.data.marketDollars[userId];
    } else {
        runtime.state.data.marketDollars[userId] = newBalance;
    }
    await runtime.state.write();
    return {
        added,
        newBalance,
        capped: added < amount || newBalance >= MARKET_MAX_DOLLAR_BALANCE,
    };
}

export async function resetUserDollars(runtime: GameRuntime, userId: string): Promise<number> {
    runtime.state.data.marketDollars ??= {};
    const current = runtime.state.data.marketDollars[userId] ?? 0;
    if (current > 0) {
        delete runtime.state.data.marketDollars[userId];
        // Increment total claimed dollars
        runtime.state.data.totalClaimedDollars ??= 0;
        runtime.state.data.totalClaimedDollars += current;
        await runtime.state.write();
    }
    return current;
}

export function canClaimDollars(balance: number): boolean {
    return balance >= MARKET_MIN_CLAIM_DOLLARS;
}

export function getEligiblePackPrizes(roleIds: Iterable<string>): PackPrizeDefinition[] {
    const roleSet = new Set(roleIds);
    const allowAllDollars = roleSet.has(ROLE_MARKET_ALL_PRIZES) || !roleSet.has(ROLE_MARKET_LIMITED_DOLLARS);
    return PACK_PRIZE_DEFINITIONS.filter((prize) => {
        if (prize.type === 'dollar' && !allowAllDollars && prize.amount > 1) {
            return false;
        }
        return true;
    });
}

export function drawPackPrize(roleIds: Iterable<string>): PackPrizeDefinition {
    const eligible = getEligiblePackPrizes(roleIds);
    if (eligible.length === 0) {
        throw new Error('NO_ELIGIBLE_PRIZES');
    }
    const totalWeight = eligible.reduce((sum, prize) => sum + prize.weight, 0);
    const roll = randomInt(1, totalWeight);
    let cumulative = 0;
    for (const prize of eligible) {
        cumulative += prize.weight;
        if (roll <= cumulative) {
            return prize;
        }
    }
    const fallback = eligible[eligible.length - 1];
    if (!fallback) {
        throw new Error('NO_ELIGIBLE_PRIZES');
    }
    return fallback;
}

export interface PackOpenResult {
    prize: PackPrizeDefinition;
    packsRemaining: number;
    glyphBalance?: number;
    dollarBalance?: number;
    dollarsAdded?: number;
    dollarsCapped?: boolean;
}

export async function openPackForUser(runtime: GameRuntime, userId: string, roleIds: Iterable<string>): Promise<PackOpenResult> {
    const packsRemaining = await consumePackFromUser(runtime, userId);
    const prize = drawPackPrize(roleIds);
    if (prize.type === 'glyphs') {
        const prev = runtime.balances.data[userId] ?? 0;
        const updated = prev + prize.amount;
        runtime.balances.data[userId] = updated;
        await runtime.balances.write();
        return {
            prize,
            packsRemaining,
            glyphBalance: updated,
        };
    }
    const update = await addDollarsToUser(runtime, userId, prize.amount);
    return {
        prize,
        packsRemaining,
        dollarBalance: update.newBalance,
        dollarsAdded: update.added,
        dollarsCapped: update.capped,
    };
}

export async function setTotalRewards(runtime: GameRuntime, amount: number) {
    runtime.state.data.totalRewardsPerBlock = amount;
    await runtime.state.write();
}

export async function setBaseReward(runtime: GameRuntime, amount: number) {
    runtime.state.data.baseReward = amount;
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
    let resolving = false;
    const tick = async () => {
        if (Date.now() < (runtime.state.data.nextBlockAt ?? 0)) return;
        if (resolving) return; // guard against concurrent resolution if tick overlaps
        resolving = true;
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
        resolving = false;
    };
    return setInterval(tick, 1000);
}

// Batch file writes to reduce I/O operations
let pendingStateWrite: NodeJS.Timeout | null = null;
let pendingBalancesWrite: NodeJS.Timeout | null = null;

export async function recordChoice(runtime: GameRuntime, userId: string, choice: SymbolRune) {
    runtime.currentChoices[userId] = choice;
    runtime.state.data.currentChoices = { ...runtime.currentChoices };
    
    // Batch the write operation to avoid excessive I/O
    if (pendingStateWrite) {
        clearTimeout(pendingStateWrite);
    }
    pendingStateWrite = setTimeout(async () => {
        try {
            await runtime.state.write();
        } catch (error) {
            console.error('Error writing state:', error);
        }
        pendingStateWrite = null;
    }, 100); // Batch writes within 100ms
}

export async function resolveBlock(runtime: GameRuntime, botChoice: SymbolRune) {
    const winners = Object.entries(runtime.currentChoices);
    if (winners.length === 0) return;
    
    // Use configurable base reward from state
    const baseReward = runtime.state.data.baseReward ?? 1000000;
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
    
    // Keep all block history for accurate leaderboard calculations
    // Removed the 10-block limit to preserve complete game history
    
    // Batch the balances write operation
    if (pendingBalancesWrite) {
        clearTimeout(pendingBalancesWrite);
    }
    pendingBalancesWrite = setTimeout(async () => {
        try {
            await runtime.balances.write();
        } catch (error) {
            console.error('Error writing balances:', error);
        }
        pendingBalancesWrite = null;
    }, 100); // Batch writes within 100ms
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
    const lastBlockHistory = runtime.state.data.blockHistory.find((h: BlockHistory) => h.blockNumber === lastBlock);
    
    if (!lastBlockHistory || lastBlockHistory.memberResults.length === 0) {
        return "No member data available for the last block.";
    }
    
    let info = `**Block ${lastBlock} Member Results:**\n\n`;
    
    // Sort members by reward (highest first)
    const sortedResults = lastBlockHistory.memberResults.sort((a: MemberResult, b: MemberResult) => b.reward - a.reward);
    
    for (const result of sortedResults) {
        info += `• **<@${result.userId}>** chose ${result.choice} → ${result.reward.toLocaleString()} GLYPHS\n`;
    }
    
    return info;
}

export function getUserRewardRecords(runtime: GameRuntime, userId: string): string {
    const userHistory = runtime.state.data.blockHistory
        .filter((block: BlockHistory) => block.memberResults.some((result: MemberResult) => result.userId === userId))
        .sort((a: BlockHistory, b: BlockHistory) => b.blockNumber - a.blockNumber); // Most recent first
    
    if (userHistory.length === 0) {
        return "You haven't participated in any blocks yet.";
    }
    
    let info = `**Your Reward Records:**\n\n`;
    let totalEarned = 0;
    
    for (const block of userHistory) {
        const userResult = block.memberResults.find((result: MemberResult) => result.userId === userId);
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

export interface LeaderboardUserStats {
    userId: string;
    balance: number;
    picks: Partial<Record<SymbolRune, number>>;
    exactMatches: number;
    totalParticipations: number;
    lastParticipationAt: number | null;
    mostPicked: SymbolRune | null;
}

export function computeLeaderboardStats(runtime: GameRuntime): LeaderboardUserStats[] {
    const statsMap = new Map<string, LeaderboardUserStats>();

    const ensureStats = (userId: string): LeaderboardUserStats => {
        let stats = statsMap.get(userId);
        if (!stats) {
            stats = {
                userId,
                balance: runtime.balances.data[userId] ?? 0,
                picks: {},
                exactMatches: 0,
                totalParticipations: 0,
                lastParticipationAt: null,
                mostPicked: null,
            };
            statsMap.set(userId, stats);
        }
        return stats;
    };

    for (const block of runtime.state.data.blockHistory) {
        for (const result of block.memberResults) {
            const stats = ensureStats(result.userId);
            stats.balance = runtime.balances.data[result.userId] ?? 0;
            const existingPick = stats.picks[result.choice as SymbolRune] ?? 0;
            stats.picks[result.choice as SymbolRune] = existingPick + 1;
            if (result.distance === 0) {
                stats.exactMatches += 1;
            }
            stats.totalParticipations += 1;
            if (stats.lastParticipationAt === null || block.timestamp > stats.lastParticipationAt) {
                stats.lastParticipationAt = block.timestamp;
            }
        }
    }

    for (const [userId, balance] of Object.entries(runtime.balances.data)) {
        const stats = ensureStats(userId);
        stats.balance = balance;
    }

    for (const userId of Object.keys(runtime.currentChoices)) {
        ensureStats(userId);
    }

    const result = Array.from(statsMap.values()).map((stats) => {
        const pickEntries = Object.entries(stats.picks);
        let topRune: string | null = null;
        let topCount = -1;
        for (const [rune, count] of pickEntries) {
            const safeCount = typeof count === 'number' ? count : 0;
            if (safeCount > topCount) {
                topCount = safeCount;
                topRune = rune;
            }
        }
        const mostPicked = topRune ? (topRune as SymbolRune) : null;
        return {
            ...stats,
            picks: { ...stats.picks },
            mostPicked,
        };
    });

    result.sort((a, b) => {
        if (b.exactMatches !== a.exactMatches) return b.exactMatches - a.exactMatches;
        return b.balance - a.balance;
    });

    return result;
}

// Cache for leaderboard data to reduce computation
let leaderboardCache: { 
    data: string; 
    expiresAt: number; 
    lastBlockNumber: number;
    lastBalanceHash: string;
} | null = null;

export async function getLeaderboard(runtime: GameRuntime, interaction: Interaction): Promise<string> {
    try {
        const currentBlockNumber = runtime.state.data.currentBlock;
        const balanceHash = JSON.stringify(runtime.balances.data);
        const now = Date.now();

        if (
            leaderboardCache &&
            leaderboardCache.expiresAt > now &&
            leaderboardCache.lastBlockNumber === currentBlockNumber &&
            leaderboardCache.lastBalanceHash === balanceHash
        ) {
            return leaderboardCache.data;
        }

        const statsList = computeLeaderboardStats(runtime);
        if (statsList.length === 0) {
            return 'No leaderboard data yet.';
        }

        const topEntries = statsList.slice(0, 10);
        const requestingUserStats = statsList.find((entry) => entry.userId === interaction.user.id);
        const topUserIds = new Set<string>(topEntries.map((entry) => entry.userId));
        topUserIds.add(interaction.user.id);

        const userIdToUsername: Record<string, string> = {};
        const discordUserIds = Array.from(topUserIds).filter((uid) => /^\d{17,19}$/.test(uid));

        const fetchPromises = discordUserIds.map(async (uid) => {
            try {
                const user = await interaction.client.users.fetch(uid);
                return { uid, username: user.username };
            } catch (error) {
                if (error instanceof DiscordAPIError) {
                    if (error.code === 10013) {
                        console.warn(`User ${uid} no longer exists (deleted account)`);
                    } else if (error.code === 50013) {
                        console.warn(`Bot missing permissions to fetch user ${uid}:`, error.message);
                    } else {
                        console.warn(`Discord API error fetching user ${uid}:`, error.code, error.message);
                    }
                } else {
                    console.warn(`Failed to fetch user ${uid}:`, error);
                }
                return { uid, username: uid };
            }
        });

        const userResults = await Promise.all(fetchPromises);
        for (const result of userResults) {
            userIdToUsername[result.uid] = result.username;
        }
        for (const uid of topUserIds) {
            if (!userIdToUsername[uid]) {
                userIdToUsername[uid] = uid;
            }
        }

        let output = '**Leaderboard (Top 10 by Exact Matches):**\n\n';
        let rank = 1;
        for (const entry of topEntries) {
            const mostPicked = entry.mostPicked ?? '-';
            output += `${rank}. **${userIdToUsername[entry.userId]}** | Balance: ${entry.balance.toLocaleString()} | Most Picked: ${mostPicked} | Exact Matches: ${entry.exactMatches}\n`;
            rank += 1;
        }

        if (requestingUserStats && !topEntries.some((entry) => entry.userId === interaction.user.id)) {
            const mostPicked = requestingUserStats.mostPicked ?? '-';
            const rankIndex = statsList.findIndex((entry) => entry.userId === interaction.user.id);
            const userRank = rankIndex >= 0 ? rankIndex + 1 : statsList.length + 1;
            output += `\nYour Rank: ${userRank}. **${userIdToUsername[interaction.user.id]}** | Balance: ${requestingUserStats.balance.toLocaleString()} | Most Picked: ${mostPicked} | Exact Matches: ${requestingUserStats.exactMatches}\n`;
        }

        leaderboardCache = {
            data: output,
            expiresAt: now + 30000,
            lastBlockNumber: currentBlockNumber,
            lastBalanceHash: balanceHash,
        };

        return output;
    } catch (error) {
        if (error instanceof DiscordAPIError) {
            console.error('Discord API error generating leaderboard:', error.code, error.message);
        } else {
            console.error('Error generating leaderboard:', error);
        }
        return 'Error generating leaderboard. Please try again.';
    }
}

const exportDir = path.join(process.cwd(), 'data', 'exports');

export interface MiningExportPayload {
    generatedAt: string;
    metadata: {
        currentBlock: number;
        totalRewardsPerBlock: number;
        baseReward: number;
        blockDurationSec: number;
        nextBlockAt: number;
        lastBotChoice: string | null;
        autorunRemainingBlocks: number | null;
        notifyRoleId: string | null;
        notifyChannelId: string | null;
    };
    summary: {
        totalAccounts: number;
        totalGlyphs: number;
        totalBlockHistoryEntries: number;
        totalLeaderboardEntries: number;
        totalPacks: number;
        totalDollarBalance: number;
    };
    balances: BalanceMap;
    currentChoices: PlayerChoiceMap;
    state: PersistedState;
    leaderboard: LeaderboardUserStats[];
    market: {
        packs: Record<string, number>;
        dollars: Record<string, number>;
    };
}

export interface MiningExportResult {
    filePath: string;
    relativePath: string;
    payload: MiningExportPayload;
}

export async function exportMiningData(runtime: GameRuntime): Promise<MiningExportResult> {
    const statsList = computeLeaderboardStats(runtime);
    const balancesCopy: BalanceMap = Object.fromEntries(Object.entries(runtime.balances.data));
    const choicesCopy: PlayerChoiceMap = Object.fromEntries(Object.entries(runtime.currentChoices));
    const stateCopy = JSON.parse(JSON.stringify(runtime.state.data)) as PersistedState;
    const totalGlyphs = Object.values(balancesCopy).reduce<number>((sum, value) => sum + value, 0);
    const totalPacks = Object.values(stateCopy.marketPacks ?? {}).reduce<number>((sum, value) => sum + value, 0);
    const totalDollarBalance = Object.values(stateCopy.marketDollars ?? {}).reduce<number>((sum, value) => sum + value, 0);

    const payload: MiningExportPayload = {
        generatedAt: new Date().toISOString(),
        metadata: {
            currentBlock: stateCopy.currentBlock,
            totalRewardsPerBlock: stateCopy.totalRewardsPerBlock,
            baseReward: stateCopy.baseReward,
            blockDurationSec: stateCopy.blockDurationSec,
            nextBlockAt: stateCopy.nextBlockAt,
            lastBotChoice: stateCopy.lastBotChoice ?? null,
            autorunRemainingBlocks: typeof runtime.autorunRemainingBlocks === 'number' ? runtime.autorunRemainingBlocks : null,
            notifyRoleId: runtime.notifyRoleId ?? null,
            notifyChannelId: runtime.notifyChannelId ?? null,
        },
        summary: {
            totalAccounts: Object.keys(balancesCopy).length,
            totalGlyphs,
            totalBlockHistoryEntries: stateCopy.blockHistory.length,
            totalLeaderboardEntries: statsList.length,
            totalPacks,
            totalDollarBalance,
        },
        balances: balancesCopy,
        currentChoices: choicesCopy,
        state: stateCopy,
        leaderboard: statsList.map((entry) => ({
            ...entry,
            picks: { ...entry.picks },
        })),
        market: {
            packs: { ...stateCopy.marketPacks },
            dollars: { ...stateCopy.marketDollars },
        },
    };

    if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
    }

    const fileName = `glyphs-export-${dayjs().format('YYYY-MM-DDTHH-mm-ss')}.json`;
    const filePath = path.join(exportDir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');

    return {
        filePath,
        relativePath: path.relative(process.cwd(), filePath),
        payload,
    };
}

// Grumble state persistence functions
export async function saveGrumbleState(runtime: GameRuntime, grumbleState: GrumbleState | null) {
    runtime.state.data.grumbleState = grumbleState;
    
    // Batch the write operation to avoid excessive I/O
    if (pendingStateWrite) {
        clearTimeout(pendingStateWrite);
    }
    pendingStateWrite = setTimeout(async () => {
        try {
            await runtime.state.write();
        } catch (error) {
            console.error('Error writing grumble state:', error);
        }
        pendingStateWrite = null;
    }, 100); // Batch writes within 100ms
}

export function getGrumbleState(runtime: GameRuntime): GrumbleState | null {
    return runtime.state.data.grumbleState;
}

export async function clearGrumbleState(runtime: GameRuntime) {
    runtime.state.data.grumbleState = null;
    
    // Batch the write operation to avoid excessive I/O
    if (pendingStateWrite) {
        clearTimeout(pendingStateWrite);
    }
    pendingStateWrite = setTimeout(async () => {
        try {
            await runtime.state.write();
        } catch (error) {
            console.error('Error clearing grumble state:', error);
        }
        pendingStateWrite = null;
    }, 100); // Batch writes within 100ms
}

export function isGrumbleActive(runtime: GameRuntime): boolean {
    const grumbleState = runtime.state.data.grumbleState;
    return grumbleState !== null && grumbleState.isActive;
}

export function shouldGrumbleEnd(runtime: GameRuntime): boolean {
    const grumbleState = runtime.state.data.grumbleState;
    if (!grumbleState || !grumbleState.isActive) return false;
    
    // If using custom timer, check if timer has expired
    if (grumbleState.customTimerSec && grumbleState.customTimerEndsAt) {
        return Date.now() >= grumbleState.customTimerEndsAt;
    }
    
    // Otherwise, use block-based timing
    return runtime.state.data.currentBlock > grumbleState.blockNumber;
}

export function getGrumbleTimeLeft(runtime: GameRuntime): number {
    const grumbleState = runtime.state.data.grumbleState;
    if (!grumbleState || !grumbleState.isActive) return 0;
    
    // If using custom timer, return time left for custom timer
    if (grumbleState.customTimerSec && grumbleState.customTimerEndsAt) {
        return Math.max(0, grumbleState.customTimerEndsAt - Date.now());
    }
    
    // Otherwise, return time left for next block
    return timeLeftMs(runtime);
}

export function isGrumbleUsingCustomTimer(runtime: GameRuntime): boolean {
    const grumbleState = runtime.state.data.grumbleState;
    return grumbleState !== null && grumbleState.isActive && 
           grumbleState.customTimerSec !== undefined && 
           grumbleState.customTimerEndsAt !== undefined;
}

export async function setUserGlyphs(runtime: GameRuntime, userId: string, amount: number): Promise<number> {
    runtime.balances.data[userId] = amount;
    
    // Batch the write operation to avoid excessive I/O
    if (pendingBalancesWrite) {
        clearTimeout(pendingBalancesWrite);
    }
    pendingBalancesWrite = setTimeout(async () => {
        try {
            await runtime.balances.write();
        } catch (error) {
            console.error('Error writing user glyphs:', error);
        }
        pendingBalancesWrite = null;
    }, 100); // Batch writes within 100ms
    
    return amount;
}

export function getUserBetInfo(runtime: GameRuntime, userId: string): string {
    let info = "**Your Current Bets:**\n\n";
    
    // Check regular mining bet
    const miningChoice = runtime.currentChoices[userId];
    if (miningChoice) {
        info += `**Mining Bet:** ${miningChoice}\n`;
    } else {
        info += `**Mining Bet:** No bet placed\n`;
    }
    
    // Check grumble bet
    const grumbleState = runtime.state.data.grumbleState;
    if (grumbleState && grumbleState.isActive && grumbleState.bets[userId]) {
        const grumbleBet = grumbleState.bets[userId];
        info += `**Grumble Bet:** ${grumbleBet.guess} (${grumbleBet.amount.toLocaleString()} GLYPHS)\n`;
    } else {
        info += `**Grumble Bet:** No bet placed\n`;
    }
    
    // If no bets at all
    if (!miningChoice && (!grumbleState || !grumbleState.isActive || !grumbleState.bets[userId])) {
        info = "**Your Current Bets:**\n\nNo bets placed for this block.";
    }
    
    return info;
}

// Claim limit management functions
export function getTotalClaimedDollars(runtime: GameRuntime): number {
    return runtime.state.data.totalClaimedDollars ?? 0;
}

export function getClaimLimit(runtime: GameRuntime): number {
    return runtime.state.data.claimLimit ?? 80;
}

export function isClaimButtonDisabled(runtime: GameRuntime): boolean {
    return runtime.state.data.claimButtonDisabled ?? false;
}

export function isClaimLimitReached(runtime: GameRuntime): boolean {
    const totalClaimed = getTotalClaimedDollars(runtime);
    const limit = getClaimLimit(runtime);
    return totalClaimed >= limit;
}

export async function setClaimLimit(runtime: GameRuntime, limit: number): Promise<void> {
    runtime.state.data.claimLimit = limit;
    await runtime.state.write();
}

export async function resetClaimCounter(runtime: GameRuntime): Promise<void> {
    runtime.state.data.totalClaimedDollars = 0;
    runtime.state.data.claimButtonDisabled = false;
    await runtime.state.write();
}

export async function enableClaimButton(runtime: GameRuntime): Promise<void> {
    runtime.state.data.claimButtonDisabled = false;
    await runtime.state.write();
}

export async function disableClaimButton(runtime: GameRuntime): Promise<void> {
    runtime.state.data.claimButtonDisabled = true;
    await runtime.state.write();
}

// Auction management functions
export function generateAuctionId(): string {
    return `auction_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export async function createAuction(
    runtime: GameRuntime,
    description: string,
    rolesToTag: string[],
    endTime: number,
    numberOfWinners: number
): Promise<AuctionState> {
    runtime.state.data.auctions ??= {};
    const auctionId = generateAuctionId();
    const auction: AuctionState = {
        id: auctionId,
        description,
        rolesToTag,
        endTime,
        numberOfWinners,
        bids: {},
        messageId: null,
        channelId: null,
        isActive: true,
        ended: false,
    };
    runtime.state.data.auctions[auctionId] = auction;
    await runtime.state.write();
    return auction;
}

export function getAuction(runtime: GameRuntime, auctionId: string): AuctionState | null {
    runtime.state.data.auctions ??= {};
    return runtime.state.data.auctions[auctionId] || null;
}

export function getActiveAuctions(runtime: GameRuntime): AuctionState[] {
    runtime.state.data.auctions ??= {};
    const now = Date.now();
    return Object.values(runtime.state.data.auctions).filter(
        (auction) => auction.isActive && !auction.ended && auction.endTime > now
    );
}

export async function updateAuctionMessage(
    runtime: GameRuntime,
    auctionId: string,
    messageId: string,
    channelId: string
): Promise<void> {
    runtime.state.data.auctions ??= {};
    const auction = runtime.state.data.auctions[auctionId];
    if (auction) {
        auction.messageId = messageId;
        auction.channelId = channelId;
        await runtime.state.write();
    }
}

export async function placeBid(
    runtime: GameRuntime,
    auctionId: string,
    userId: string,
    amount: number
): Promise<{ success: boolean; error?: string }> {
    runtime.state.data.auctions ??= {};
    const auction = runtime.state.data.auctions[auctionId];
    if (!auction) {
        return { success: false, error: 'Auction not found' };
    }
    if (auction.ended || !auction.isActive) {
        return { success: false, error: 'Auction has ended' };
    }
    if (Date.now() >= auction.endTime) {
        return { success: false, error: 'Auction has ended' };
    }
    if (auction.bids[userId] !== undefined) {
        return { success: false, error: 'You already placed a bid' };
    }
    const userBalance = runtime.balances.data[userId] ?? 0;
    if (amount <= 0) {
        return { success: false, error: 'Bid amount must be greater than 0' };
    }
    if (amount > userBalance) {
        return { success: false, error: `You don't have enough GLYPHS. Your balance: ${userBalance.toLocaleString()}` };
    }
    // Deduct GLYPHS immediately
    runtime.balances.data[userId] = userBalance - amount;
    await runtime.balances.write();
    // Record bid
    auction.bids[userId] = amount;
    await runtime.state.write();
    return { success: true };
}

export function getUserBid(runtime: GameRuntime, auctionId: string, userId: string): number | null {
    runtime.state.data.auctions ??= {};
    const auction = runtime.state.data.auctions[auctionId];
    if (!auction) return null;
    return auction.bids[userId] ?? null;
}

export function getAuctionLeaderboard(runtime: GameRuntime, auctionId: string): Array<{ userId: string; bid: number }> {
    runtime.state.data.auctions ??= {};
    const auction = runtime.state.data.auctions[auctionId];
    if (!auction) return [];
    return Object.entries(auction.bids)
        .map(([userId, bid]) => ({ userId, bid }))
        .sort((a, b) => b.bid - a.bid);
}

export function getUserRank(runtime: GameRuntime, auctionId: string, userId: string): number | null {
    const leaderboard = getAuctionLeaderboard(runtime, auctionId);
    const index = leaderboard.findIndex((entry) => entry.userId === userId);
    return index >= 0 ? index + 1 : null;
}

export async function resolveAuction(runtime: GameRuntime, auctionId: string): Promise<void> {
    runtime.state.data.auctions ??= {};
    const auction = runtime.state.data.auctions[auctionId];
    if (!auction || auction.ended) return;
    
    auction.ended = true;
    auction.isActive = false;
    
    const leaderboard = getAuctionLeaderboard(runtime, auctionId);
    const winners = leaderboard.slice(0, auction.numberOfWinners);
    const winnerIds = new Set(winners.map((w) => w.userId));
    
    // Deduct GLYPHS from losers only (winners keep theirs)
    for (const [userId, bidAmount] of Object.entries(auction.bids)) {
        if (!winnerIds.has(userId)) {
            // Loser - GLYPHS already deducted when they bid, so nothing to do
            // (they already lost their GLYPHS when they placed the bid)
        }
    }
    
    await runtime.state.write();
}

export function getExpiredAuctions(runtime: GameRuntime): AuctionState[] {
    runtime.state.data.auctions ??= {};
    const now = Date.now();
    return Object.values(runtime.state.data.auctions).filter(
        (auction) => auction.isActive && !auction.ended && auction.endTime <= now
    );
}


