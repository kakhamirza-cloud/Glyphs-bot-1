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
exports.setBaseReward = setBaseReward;
exports.setBlockDuration = setBlockDuration;
exports.setCurrentBlock = setCurrentBlock;
exports.startTicker = startTicker;
exports.recordChoice = recordChoice;
exports.resolveBlock = resolveBlock;
exports.getBalance = getBalance;
exports.resetBalances = resetBalances;
exports.getLastBlockRewardInfo = getLastBlockRewardInfo;
exports.getUserRewardRecords = getUserRewardRecords;
exports.getLeaderboard = getLeaderboard;
exports.saveGrumbleState = saveGrumbleState;
exports.getGrumbleState = getGrumbleState;
exports.clearGrumbleState = clearGrumbleState;
exports.isGrumbleActive = isGrumbleActive;
exports.shouldGrumbleEnd = shouldGrumbleEnd;
exports.getGrumbleTimeLeft = getGrumbleTimeLeft;
exports.isGrumbleUsingCustomTimer = isGrumbleUsingCustomTimer;
exports.setUserGlyphs = setUserGlyphs;
exports.getUserBetInfo = getUserBetInfo;
const storage_1 = require("./storage");
const discord_js_1 = require("discord.js");
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
        currentChoices: state.data.currentChoices || {},
        isActive: true, // Bot starts as active
        autorunRemainingBlocks: undefined,
        notifyRoleId: process.env.DISCORD_NOTIFY_ROLE_ID,
        notifyChannelId: process.env.DISCORD_NOTIFY_CHANNEL_ID,
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
    // Randomized reward ranges per tier (scaled by baseReward/1000)
    let min = 0, max = 0;
    if (dist === 0) {
        min = 950;
        max = 1000; // Exact match
    }
    else if (dist > 7) {
        min = 150;
        max = 300; // Distance 8+
    }
    else if (dist > 3) {
        min = 400;
        max = 600; // Distance 4-7
    }
    else {
        min = 700;
        max = 900; // Distance 1-3
    }
    const reward = Math.floor(baseReward * (randomInt(min, max) / 1000));
    return reward;
}
function randomInt(min, max) {
    // Inclusive min and max
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
async function setTotalRewards(runtime, amount) {
    runtime.state.data.totalRewardsPerBlock = amount;
    await runtime.state.write();
}
async function setBaseReward(runtime, amount) {
    runtime.state.data.baseReward = amount;
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
    let resolving = false;
    const tick = async () => {
        if (Date.now() < (runtime.state.data.nextBlockAt ?? 0))
            return;
        if (resolving)
            return; // guard against concurrent resolution if tick overlaps
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
let pendingStateWrite = null;
let pendingBalancesWrite = null;
async function recordChoice(runtime, userId, choice) {
    runtime.currentChoices[userId] = choice;
    runtime.state.data.currentChoices = { ...runtime.currentChoices };
    // Batch the write operation to avoid excessive I/O
    if (pendingStateWrite) {
        clearTimeout(pendingStateWrite);
    }
    pendingStateWrite = setTimeout(async () => {
        try {
            await runtime.state.write();
        }
        catch (error) {
            console.error('Error writing state:', error);
        }
        pendingStateWrite = null;
    }, 100); // Batch writes within 100ms
}
async function resolveBlock(runtime, botChoice) {
    const winners = Object.entries(runtime.currentChoices);
    if (winners.length === 0)
        return;
    // Use configurable base reward from state
    const baseReward = runtime.state.data.baseReward ?? 1000000;
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
    // Keep all block history for accurate leaderboard calculations
    // Removed the 10-block limit to preserve complete game history
    // Batch the balances write operation
    if (pendingBalancesWrite) {
        clearTimeout(pendingBalancesWrite);
    }
    pendingBalancesWrite = setTimeout(async () => {
        try {
            await runtime.balances.write();
        }
        catch (error) {
            console.error('Error writing balances:', error);
        }
        pendingBalancesWrite = null;
    }, 100); // Batch writes within 100ms
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
        info += `• **<@${result.userId}>** chose ${result.choice} → ${result.reward.toLocaleString()} GLYPHS\n`;
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
// Cache for leaderboard data to reduce computation
let leaderboardCache = null;
async function getLeaderboard(runtime, interaction) {
    try {
        // Check if we can use cached data
        const currentBlockNumber = runtime.state.data.currentBlock;
        const balanceHash = JSON.stringify(runtime.balances.data);
        const now = Date.now();
        if (leaderboardCache &&
            leaderboardCache.expiresAt > now &&
            leaderboardCache.lastBlockNumber === currentBlockNumber &&
            leaderboardCache.lastBalanceHash === balanceHash) {
            return leaderboardCache.data;
        }
        // Gather stats for all users who have ever participated
        const userStats = {};
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
                    if (result.distance === 0)
                        stats.exactMatches++;
                }
            }
        }
        // If no data
        if (Object.keys(userStats).length === 0)
            return 'No leaderboard data yet.';
        // Sort by exact matches, then balance
        const sorted = Object.entries(userStats).sort((a, b) => {
            if (b[1].exactMatches !== a[1].exactMatches)
                return b[1].exactMatches - a[1].exactMatches;
            return b[1].balance - a[1].balance;
        });
        // Prepare leaderboard lines
        let lines = '**Leaderboard (Top 10 by Exact Matches):**\n\n';
        let rank = 1;
        let userIdToUsername = {};
        // Fetch usernames for top 10 and the requesting user
        const topUserIds = sorted.slice(0, 10).map(([uid]) => uid);
        if (!topUserIds.includes(interaction.user.id))
            topUserIds.push(interaction.user.id);
        // Only try to fetch real Discord user IDs (those that look like Discord snowflakes)
        const discordUserIds = topUserIds.filter(uid => /^\d{17,19}$/.test(uid));
        // Batch fetch users to reduce API calls and improve performance
        const fetchPromises = discordUserIds.map(async (uid) => {
            try {
                const user = await interaction.client.users.fetch(uid);
                return { uid, username: user.username };
            }
            catch (error) {
                if (error instanceof discord_js_1.DiscordAPIError) {
                    if (error.code === 10013) { // Unknown User
                        console.warn(`User ${uid} no longer exists (deleted account)`);
                    }
                    else if (error.code === 50013) { // Missing Permissions
                        console.warn(`Bot missing permissions to fetch user ${uid}:`, error.message);
                    }
                    else {
                        console.warn(`Discord API error fetching user ${uid}:`, error.code, error.message);
                    }
                }
                else {
                    console.warn(`Failed to fetch user ${uid}:`, error);
                }
                return { uid, username: uid };
            }
        });
        // Wait for all user fetches to complete in parallel
        const userResults = await Promise.all(fetchPromises);
        for (const result of userResults) {
            userIdToUsername[result.uid] = result.username;
        }
        // For non-Discord user IDs (like simulation users), just use the ID as display name
        for (const uid of topUserIds) {
            if (!userIdToUsername[uid]) {
                userIdToUsername[uid] = uid;
            }
        }
        for (let i = 0; i < Math.min(10, sorted.length); i++) {
            const entry = sorted[i];
            if (!entry)
                continue;
            const [uid, stats] = entry;
            if (!stats)
                continue;
            const picksEntries = Object.entries(stats.picks);
            let mostPicked = '-';
            if (picksEntries.length > 0) {
                const sortedPick = picksEntries.sort((a, b) => b[1] - a[1])[0];
                if (sortedPick && sortedPick[0])
                    mostPicked = sortedPick[0];
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
                    if (sortedPick && sortedPick[0])
                        mostPicked = sortedPick[0];
                }
                lines += `\nYour Rank: ${sorted.findIndex(([uid]) => uid === interaction.user.id) + 1}. **${userIdToUsername[interaction.user.id]}** | Balance: ${stats.balance.toLocaleString()} | Most Picked: ${mostPicked} | Exact Matches: ${stats.exactMatches}\n`;
            }
        }
        // Cache the result for 30 seconds
        leaderboardCache = {
            data: lines,
            expiresAt: now + 30000, // 30 seconds
            lastBlockNumber: currentBlockNumber,
            lastBalanceHash: balanceHash
        };
        return lines;
    }
    catch (error) {
        if (error instanceof discord_js_1.DiscordAPIError) {
            console.error('Discord API error generating leaderboard:', error.code, error.message);
        }
        else {
            console.error('Error generating leaderboard:', error);
        }
        return 'Error generating leaderboard. Please try again.';
    }
}
// Grumble state persistence functions
async function saveGrumbleState(runtime, grumbleState) {
    runtime.state.data.grumbleState = grumbleState;
    // Batch the write operation to avoid excessive I/O
    if (pendingStateWrite) {
        clearTimeout(pendingStateWrite);
    }
    pendingStateWrite = setTimeout(async () => {
        try {
            await runtime.state.write();
        }
        catch (error) {
            console.error('Error writing grumble state:', error);
        }
        pendingStateWrite = null;
    }, 100); // Batch writes within 100ms
}
function getGrumbleState(runtime) {
    return runtime.state.data.grumbleState;
}
async function clearGrumbleState(runtime) {
    runtime.state.data.grumbleState = null;
    // Batch the write operation to avoid excessive I/O
    if (pendingStateWrite) {
        clearTimeout(pendingStateWrite);
    }
    pendingStateWrite = setTimeout(async () => {
        try {
            await runtime.state.write();
        }
        catch (error) {
            console.error('Error clearing grumble state:', error);
        }
        pendingStateWrite = null;
    }, 100); // Batch writes within 100ms
}
function isGrumbleActive(runtime) {
    const grumbleState = runtime.state.data.grumbleState;
    return grumbleState !== null && grumbleState.isActive;
}
function shouldGrumbleEnd(runtime) {
    const grumbleState = runtime.state.data.grumbleState;
    if (!grumbleState || !grumbleState.isActive)
        return false;
    // If using custom timer, check if timer has expired
    if (grumbleState.customTimerSec && grumbleState.customTimerEndsAt) {
        return Date.now() >= grumbleState.customTimerEndsAt;
    }
    // Otherwise, use block-based timing
    return runtime.state.data.currentBlock > grumbleState.blockNumber;
}
function getGrumbleTimeLeft(runtime) {
    const grumbleState = runtime.state.data.grumbleState;
    if (!grumbleState || !grumbleState.isActive)
        return 0;
    // If using custom timer, return time left for custom timer
    if (grumbleState.customTimerSec && grumbleState.customTimerEndsAt) {
        return Math.max(0, grumbleState.customTimerEndsAt - Date.now());
    }
    // Otherwise, return time left for next block
    return timeLeftMs(runtime);
}
function isGrumbleUsingCustomTimer(runtime) {
    const grumbleState = runtime.state.data.grumbleState;
    return grumbleState !== null && grumbleState.isActive &&
        grumbleState.customTimerSec !== undefined &&
        grumbleState.customTimerEndsAt !== undefined;
}
async function setUserGlyphs(runtime, userId, amount) {
    runtime.balances.data[userId] = amount;
    // Batch the write operation to avoid excessive I/O
    if (pendingBalancesWrite) {
        clearTimeout(pendingBalancesWrite);
    }
    pendingBalancesWrite = setTimeout(async () => {
        try {
            await runtime.balances.write();
        }
        catch (error) {
            console.error('Error writing user glyphs:', error);
        }
        pendingBalancesWrite = null;
    }, 100); // Batch writes within 100ms
    return amount;
}
function getUserBetInfo(runtime, userId) {
    let info = "**Your Current Bets:**\n\n";
    // Check regular mining bet
    const miningChoice = runtime.currentChoices[userId];
    if (miningChoice) {
        info += `**Mining Bet:** ${miningChoice}\n`;
    }
    else {
        info += `**Mining Bet:** No bet placed\n`;
    }
    // Check grumble bet
    const grumbleState = runtime.state.data.grumbleState;
    if (grumbleState && grumbleState.isActive && grumbleState.bets[userId]) {
        const grumbleBet = grumbleState.bets[userId];
        info += `**Grumble Bet:** ${grumbleBet.guess} (${grumbleBet.amount.toLocaleString()} GLYPHS)\n`;
    }
    else {
        info += `**Grumble Bet:** No bet placed\n`;
    }
    // If no bets at all
    if (!miningChoice && (!grumbleState || !grumbleState.isActive || !grumbleState.bets[userId])) {
        info = "**Your Current Bets:**\n\nNo bets placed for this block.";
    }
    return info;
}
//# sourceMappingURL=game.js.map