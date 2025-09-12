"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SYMBOLS = void 0;
exports.initGame = initGame;
exports.timeLeftMs = timeLeftMs;
exports.formatDuration = formatDuration;
exports.pickRandomSymbol = pickRandomSymbol;
exports.symbolDistance = symbolDistance;
exports.computeReward = computeReward;
exports.setTotalRewards = setTotalRewards;
exports.setBlockDuration = setBlockDuration;
exports.setCurrentBlock = setCurrentBlock;
exports.startTicker = startTicker;
exports.recordChoice = recordChoice;
exports.resolveBlock = resolveBlock;
exports.getBalance = getBalance;
exports.resetBalances = resetBalances;
exports.getLastBlockRewardInfo = getLastBlockRewardInfo;
exports.getUserRewardRecords = getUserRewardRecords;
const storage_1 = require("./storage");
// Ensure no duplicate runes - this will throw an error if duplicates are found
const RAW_SYMBOLS = [
    'ᚹ', 'ᚾ', 'ᚦ', 'ᚠ', 'ᚱ', 'ᚲ', 'ᛉ', 'ᛈ', 'ᚺ', 'ᛏ', 'ᛁ', 'ᛋ', 'ᛇ', 'ᚨ', 'ᛃ', 'ᛟ', 'ᛞ', 'ᛒ', 'ᛗ', 'ᛚ', 'ᛜ', 'ᛝ'
];
// Validate no duplicates
const uniqueSymbols = [...new Set(RAW_SYMBOLS)];
if (uniqueSymbols.length !== RAW_SYMBOLS.length) {
    console.error('ERROR: Duplicate runes found in SYMBOLS array!');
    console.error('Original count:', RAW_SYMBOLS.length);
    console.error('Unique count:', uniqueSymbols.length);
    process.exit(1);
}
exports.SYMBOLS = uniqueSymbols;
async function initGame() {
    const state = await (0, storage_1.openState)();
    const balances = await (0, storage_1.openBalances)();
    const runtime = {
        state,
        balances,
        currentChoices: {},
    };
    return runtime;
}
function timeLeftMs(runtime) {
    return Math.max(0, (runtime.state.data.nextBlockAt ?? Date.now()) - Date.now());
}
function formatDuration(ms) {
    const sec = Math.ceil(ms / 1000);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const parts = [];
    if (h)
        parts.push(`${h}h`);
    if (m || h)
        parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
}
function pickRandomSymbol() {
    const index = Math.floor(Math.random() * exports.SYMBOLS.length);
    return exports.SYMBOLS[index];
}
function symbolDistance(a, b) {
    const ai = exports.SYMBOLS.indexOf(a);
    const bi = exports.SYMBOLS.indexOf(b);
    const direct = Math.abs(ai - bi);
    const wrap = exports.SYMBOLS.length - direct;
    return Math.min(direct, wrap);
}
function computeReward(baseReward, player, bot) {
    const dist = symbolDistance(player, bot);
    // Base reward: 1000 GLYPHS per block
    // Exact match: 100% (1000 GLYPHS)
    // Distance 1-3: 70% (700 GLYPHS)
    // Distance 4-7: 40% (400 GLYPHS)
    // Distance 8+: 15% (150 GLYPHS)
    let percentage = 70; // Default for distance 1-3
    if (dist === 0)
        percentage = 100; // Exact match
    else if (dist > 7)
        percentage = 15; // Distance 8+
    else if (dist > 3)
        percentage = 40; // Distance 4-7
    return Math.floor(baseReward * (percentage / 100));
}
async function setTotalRewards(runtime, amount) {
    runtime.state.data.totalRewardsPerBlock = amount;
    await runtime.state.write();
}
async function setBlockDuration(runtime, seconds) {
    runtime.state.data.blockDurationSec = seconds;
    const now = Date.now();
    runtime.state.data.nextBlockAt = now + seconds * 1000;
    await runtime.state.write();
}
async function setCurrentBlock(runtime, block) {
    runtime.state.data.currentBlock = block;
    await runtime.state.write();
}
function startTicker(runtime) {
    const tick = async () => {
        if (Date.now() < (runtime.state.data.nextBlockAt ?? 0))
            return;
        // Advance block
        const botChoice = pickRandomSymbol();
        await resolveBlock(runtime, botChoice);
        runtime.state.data.lastBotChoice = botChoice;
        runtime.state.data.currentBlock += 1;
        runtime.state.data.nextBlockAt = Date.now() + runtime.state.data.blockDurationSec * 1000;
        await runtime.state.write();
        runtime.currentChoices = {};
        runtime.onBlockAdvance?.(runtime.state.data.currentBlock, botChoice);
    };
    return setInterval(tick, 1000);
}
async function recordChoice(runtime, userId, choice) {
    runtime.currentChoices[userId] = choice;
}
async function resolveBlock(runtime, botChoice) {
    const winners = Object.entries(runtime.currentChoices);
    if (winners.length === 0)
        return;
    // Base reward is 1000 GLYPHS per block
    const baseReward = 1000;
    const currentBlock = runtime.state.data.currentBlock;
    // Store historical data for this block
    const memberResults = [];
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
    const blockHistory = {
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
function getBalance(runtime, userId) {
    return runtime.balances.data[userId] ?? 0;
}
function resetBalances(runtime) {
    runtime.balances.data = {};
    return runtime.balances.write();
}
function getLastBlockRewardInfo(runtime) {
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
        const percentage = Math.round((result.reward / 1000) * 100);
        info += `• **<@${result.userId}>** chose ${result.choice} → ${result.reward.toLocaleString()} GLYPHS (${percentage}%)\n`;
    }
    return info;
}
function getUserRewardRecords(runtime, userId) {
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
            const percentage = Math.round((userResult.reward / 1000) * 100);
            info += `**Block ${block.blockNumber}:**\n`;
            info += `• Bot chose: ${block.botChoice}\n`;
            info += `• You chose: ${userResult.choice}\n`;
            info += `• Reward: ${userResult.reward.toLocaleString()} GLYPHS (${percentage}%)\n\n`;
            totalEarned += userResult.reward;
        }
    }
    info += `**Total Earned:** ${totalEarned.toLocaleString()} GLYPHS`;
    return info;
}
//# sourceMappingURL=game.js.map