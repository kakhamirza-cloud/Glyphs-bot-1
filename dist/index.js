"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const discord_js_1 = require("discord.js");
const ui_1 = require("./ui");
const game_1 = require("./game");
const commands_1 = require("./commands");
const ui_2 = require("./ui");
let runtime;
let ticker;
let panelMessageId;
let panelChannelId;
let uiRefresher;
let healthLagMonitor;
let healthMemoryLogger;
let cooldownGcTimer;
let grumbleTimer;
let clientRef;
// Basic overload protection: throttle panel refreshes
let lastRefreshAt = 0;
let pendingRefresh;
const REFRESH_MIN_INTERVAL_MS = 2000; // limit edits to ~1 per 2s (increased from 1.5s)
// Global interaction throttle to protect against spam storms across the entire guild
// This limits how many button interactions the bot will process per short window.
const GLOBAL_BTN_WINDOW_MS = 1000; // 1 second window
const GLOBAL_BTN_MAX_PER_WINDOW = 25; // allow up to 25 button interactions per second globally
(_a = global).__btnGlobalWindow ?? (_a.__btnGlobalWindow = { windowStart: 0, count: 0 });
// Lightweight cache for leaderboard responses triggered by the panel button to avoid
// repeated heavy computation and user fetches during spam bursts.
let cachedLeaderboardForButton;
// Event-loop lag and high-load flag help us shed non-essential work under stress
let isHighLoad = false;
let consecutiveLagSeconds = 0;
// Grumble state is now persisted in runtime.state.data.grumbleState
// Centralized graceful shutdown
async function shutdown(reason) {
    try {
        console.log('Shutting down:', reason);
        if (ticker) {
            clearInterval(ticker);
            ticker = undefined;
        }
        if (uiRefresher) {
            clearInterval(uiRefresher);
            uiRefresher = undefined;
        }
        if (healthLagMonitor) {
            clearInterval(healthLagMonitor);
            healthLagMonitor = undefined;
        }
        if (healthMemoryLogger) {
            clearInterval(healthMemoryLogger);
            healthMemoryLogger = undefined;
        }
        if (cooldownGcTimer) {
            clearInterval(cooldownGcTimer);
            cooldownGcTimer = undefined;
        }
        if (grumbleTimer) {
            clearTimeout(grumbleTimer);
            grumbleTimer = undefined;
        }
        // Persist any in-memory state before exit as a safeguard
        if (runtime) {
            try {
                await runtime.state.write();
            }
            catch { }
            try {
                await runtime.balances.write();
            }
            catch { }
        }
        // Close Discord connection last
        if (clientRef) {
            try {
                clientRef.destroy();
            }
            catch { }
        }
    }
    finally {
        process.exit(0);
    }
}
// Start lightweight health monitors to keep the bot responsive during long runs
function startHealthMonitors(client) {
    // Monitor event-loop lag to detect stalls; if sustained, enter high-load shedding mode briefly
    if (!healthLagMonitor) {
        let last = Date.now();
        healthLagMonitor = setInterval(() => {
            const now = Date.now();
            const driftMs = now - last - 1000;
            last = now;
            if (driftMs > 1000) {
                consecutiveLagSeconds += 1;
                if (consecutiveLagSeconds >= 5) {
                    isHighLoad = true;
                    // Exit high-load after a short cooldown automatically
                    setTimeout(() => { isHighLoad = false; consecutiveLagSeconds = 0; }, 10000);
                }
                console.warn(`Event loop lag detected: ~${driftMs}ms (consec=${consecutiveLagSeconds})`);
            }
            else {
                consecutiveLagSeconds = 0;
            }
        }, 1000);
    }
    // Periodic memory usage logging to help spot leaks in long sessions
    if (!healthMemoryLogger) {
        healthMemoryLogger = setInterval(() => {
            const mem = process.memoryUsage();
            const rssMb = (mem.rss / (1024 * 1024)).toFixed(1);
            const heapMb = (mem.heapUsed / (1024 * 1024)).toFixed(1);
            if (Number(heapMb) > 300) {
                console.warn(`High memory usage: heap=${heapMb}MB rss=${rssMb}MB`);
            }
        }, 60000);
    }
    // Garbage-collect per-user cooldown maps to prevent unbounded growth over hours/days
    if (!cooldownGcTimer) {
        cooldownGcTimer = setInterval(() => {
            const cutoff = Date.now() - 10 * 60 * 1000; // 10 minutes
            const prune = (map) => {
                for (const [uid, ts] of map) {
                    if (ts < cutoff)
                        map.delete(uid);
                }
            };
            const globals = global;
            if (globals.__slashCooldowns instanceof Map)
                prune(globals.__slashCooldowns);
            if (globals.__btnCooldowns instanceof Map)
                prune(globals.__btnCooldowns);
            if (globals.__selectCooldowns instanceof Map)
                prune(globals.__selectCooldowns);
            // Clear grumble temp selections that are older than 5 minutes
            if (globals.__grumbleTempSelections) {
                const grumbleCutoff = Date.now() - 5 * 60 * 1000; // 5 minutes
                for (const [uid, data] of Object.entries(globals.__grumbleTempSelections)) {
                    if (data && typeof data === 'object' && 'timestamp' in data) {
                        if (data.timestamp < grumbleCutoff) {
                            delete globals.__grumbleTempSelections[uid];
                        }
                    }
                }
            }
            // Clear leaderboard cache if it's expired
            if (cachedLeaderboardForButton && cachedLeaderboardForButton.expiresAt < Date.now()) {
                cachedLeaderboardForButton = undefined;
            }
        }, 30000); // Run cleanup every 30 seconds instead of 60
    }
}
async function ensureTicker(client) {
    if (!ticker) {
        ticker = (0, game_1.startTicker)(runtime);
        runtime.onBlockAdvance = async (newBlock, botChoice) => {
            // Refresh the game panel
            scheduleRefresh(client);
            // Notify role on block change if configured
            try {
                if (runtime.notifyChannelId && runtime.notifyRoleId) {
                    const channel = await client.channels.fetch(runtime.notifyChannelId);
                    if (channel && channel.isTextBased()) {
                        await channel.send({
                            content: `<@&${runtime.notifyRoleId}> Block ${newBlock} started. Bot picked: ${botChoice}`
                        });
                    }
                }
            }
            catch (e) {
                if (e instanceof discord_js_1.DiscordAPIError) {
                    if (e.code === 50013) { // Missing Permissions
                        console.error('Bot missing permissions to send block notification:', e.message);
                    }
                    else if (e.code === 50001) { // Missing Access
                        console.error('Bot missing access to send block notification:', e.message);
                    }
                    else {
                        console.error('Discord API error sending block notification:', e.code, e.message);
                    }
                }
                else {
                    console.error('Failed to send block advance notification:', e);
                }
            }
            // Handle autorun countdown and shutdown
            if (typeof runtime.autorunRemainingBlocks === 'number' && runtime.autorunRemainingBlocks > 0) {
                runtime.autorunRemainingBlocks -= 1;
                if (runtime.autorunRemainingBlocks <= 0) {
                    try {
                        if (runtime.notifyChannelId && runtime.notifyRoleId) {
                            const channel = await client.channels.fetch(runtime.notifyChannelId);
                            if (channel && channel.isTextBased()) {
                                await channel.send({
                                    content: `<@&${runtime.notifyRoleId}> Block is over. Shutting down...`
                                });
                            }
                        }
                    }
                    catch (e) {
                        if (e instanceof discord_js_1.DiscordAPIError) {
                            if (e.code === 50013) { // Missing Permissions
                                console.error('Bot missing permissions to send final block notification:', e.message);
                            }
                            else if (e.code === 50001) { // Missing Access
                                console.error('Bot missing access to send final block notification:', e.message);
                            }
                            else {
                                console.error('Discord API error sending final block notification:', e.code, e.message);
                            }
                        }
                        else {
                            console.error('Failed to send final block notification:', e);
                        }
                    }
                    // Graceful shutdown, but allow keeping the bot alive in development
                    if (!process.env.KEEP_ALIVE) {
                        setTimeout(() => process.exit(0), 1000);
                    }
                }
            }
            // Handle grumble resolution on block advance
            const grumble = (0, game_1.getGrumbleState)(runtime);
            if (grumble && grumble.isActive && (0, game_1.shouldGrumbleEnd)(runtime)) {
                await resolveGrumble(client, botChoice);
            }
        };
    }
    // Start a lightweight UI refresher to keep the countdown live.
    // This intentionally calls the throttled scheduleRefresh to respect rate limits.
    if (!uiRefresher) {
        uiRefresher = setInterval(() => {
            if (panelChannelId && panelMessageId) {
                scheduleRefresh(client);
            }
        }, 2000); // Reduced frequency from 1000ms to 2000ms to reduce load
    }
}
async function startGrumbleTimer(client) {
    if (grumbleTimer) {
        clearTimeout(grumbleTimer);
        grumbleTimer = undefined;
    }
    const grumble = (0, game_1.getGrumbleState)(runtime);
    if (!grumble || !grumble.isActive || !grumble.customTimerSec || !grumble.customTimerEndsAt) {
        return; // No custom timer active
    }
    const timeLeft = grumble.customTimerEndsAt - Date.now();
    if (timeLeft <= 0) {
        // Timer already expired, resolve grumble immediately
        await resolveGrumble(client, (0, game_1.pickRandomSymbol)());
        return;
    }
    grumbleTimer = setTimeout(async () => {
        await resolveGrumble(client, (0, game_1.pickRandomSymbol)());
    }, timeLeft);
}
async function resolveGrumble(client, botChoice) {
    const grumble = (0, game_1.getGrumbleState)(runtime);
    if (!grumble || !grumble.isActive)
        return;
    // End grumble, find winner
    const bets = grumble.bets;
    if (Object.keys(bets).length === 0) {
        // No participants - send to same channel as block notifications
        let notificationChannel = null;
        if (runtime.notifyChannelId) {
            notificationChannel = await client.channels.fetch(runtime.notifyChannelId);
        }
        else if (grumble.channelId) {
            // Fallback to grumble channel if no notification channel is set
            notificationChannel = await client.channels.fetch(grumble.channelId);
        }
        if (notificationChannel && notificationChannel.isTextBased()) {
            const roleMention = runtime.notifyRoleId ? `<@&${runtime.notifyRoleId}> ` : '';
            await notificationChannel.send(`${roleMention}No one joined the grumble. Prize pool is returned.`);
        }
    }
    else {
        // Find all winners with minimum distance (handle ties)
        let minDist = Infinity;
        const winners = [];
        for (const [userId, bet] of Object.entries(bets)) {
            const betObj = bet;
            const dist = (0, game_1.symbolDistance)(betObj.guess, botChoice);
            if (dist < minDist) {
                // New minimum distance found
                minDist = dist;
                winners.length = 0; // Clear previous winners
                winners.push({ userId, bet: betObj });
            }
            else if (dist === minDist) {
                // Tie for minimum distance
                winners.push({ userId, bet: betObj });
            }
        }
        // Send grumble result to the same channel as block notifications
        let notificationChannel = null;
        if (runtime.notifyChannelId) {
            notificationChannel = await client.channels.fetch(runtime.notifyChannelId);
        }
        else if (grumble.channelId) {
            // Fallback to grumble channel if no notification channel is set
            notificationChannel = await client.channels.fetch(grumble.channelId);
        }
        if (notificationChannel && notificationChannel.isTextBased()) {
            if (winners.length > 0) {
                const prizePerWinner = Math.floor(grumble.prizePool / winners.length);
                const roleMention = runtime.notifyRoleId ? `<@&${runtime.notifyRoleId}> ` : '';
                // Distribute prizes to all winners
                const winnerMentions = [];
                for (const winner of winners) {
                    const winnerBalance = runtime.balances.data[winner.userId] || 0;
                    runtime.balances.data[winner.userId] = winnerBalance + prizePerWinner;
                    winnerMentions.push(`<@${winner.userId}>`);
                }
                await runtime.balances.write();
                // Send notification
                if (winners.length === 1) {
                    // Single winner
                    const winner = winners[0];
                    if (winner) {
                        const winnerBalance = runtime.balances.data[winner.userId] || 0;
                        await notificationChannel.send(`${roleMention}<@${winner.userId}> wins the grumble and takes ${grumble.prizePool.toLocaleString()} GLYPHS! Bot chose: ${botChoice}\nNew balance: ${winnerBalance.toLocaleString()} GLYPHS`);
                    }
                }
                else {
                    // Multiple winners (tie)
                    await notificationChannel.send(`${roleMention}🏆 **TIE!** ${winnerMentions.join(', ')} all win the grumble!\n\nBot chose: ${botChoice}\nPrize pool: ${grumble.prizePool.toLocaleString()} GLYPHS\nEach winner gets: ${prizePerWinner.toLocaleString()} GLYPHS`);
                }
            }
            else {
                const roleMention = runtime.notifyRoleId ? `<@&${runtime.notifyRoleId}> ` : '';
                await notificationChannel.send(`${roleMention}No valid winner for the grumble.`);
            }
        }
    }
    await (0, game_1.clearGrumbleState)(runtime);
    // Clear the grumble timer
    if (grumbleTimer) {
        clearTimeout(grumbleTimer);
        grumbleTimer = undefined;
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
    catch (error) {
        if (error instanceof discord_js_1.DiscordAPIError) {
            if (error.code === 10008) { // Unknown Message
                console.warn('Panel message no longer exists, clearing reference');
                panelMessageId = undefined;
                panelChannelId = undefined;
            }
            else if (error.code === 50013) { // Missing Permissions
                console.error('Bot missing permissions to edit panel message:', error.message);
            }
            else if (error.code === 50001) { // Missing Access
                console.error('Bot missing access to edit panel message:', error.message);
            }
            else {
                console.error('Discord API error editing panel message:', error.code, error.message);
            }
        }
        else {
            console.error('Failed to edit panel message:', error);
        }
    }
}
function scheduleRefresh(client) {
    const now = Date.now();
    const elapsed = now - lastRefreshAt;
    if (elapsed >= REFRESH_MIN_INTERVAL_MS && !pendingRefresh) {
        lastRefreshAt = now;
        void refreshPanel(client);
        return;
    }
    if (pendingRefresh)
        return;
    const delay = Math.max(0, REFRESH_MIN_INTERVAL_MS - elapsed);
    pendingRefresh = setTimeout(() => {
        pendingRefresh = undefined;
        lastRefreshAt = Date.now();
        void refreshPanel(client);
    }, delay);
}
async function postPanel(channel) {
    const { embed, rows } = (0, ui_1.buildPanel)(runtime);
    // Send the panel message and store its ID for future updates
    const message = await channel.send({ embeds: [embed], components: rows });
    panelMessageId = message.id;
    panelChannelId = channel.id;
    // Ensure the UI refresher is running so the countdown updates live after posting
    // even if no interactions occur.
    // The refresher uses scheduleRefresh, which is already throttled.
    // This helps avoid a "stuck" Next Block In display.
    if (!uiRefresher) {
        // The client instance isn't directly available here; a subsequent interaction or
        // ready event will invoke ensureTicker which starts the refresher. This is just a guard.
    }
}
async function main() {
    runtime = await (0, game_1.initGame)();
    const client = new discord_js_1.Client({ intents: [discord_js_1.GatewayIntentBits.Guilds, discord_js_1.GatewayIntentBits.GuildMembers] });
    clientRef = client; // keep a reference for graceful shutdown
    client.once(discord_js_1.Events.ClientReady, async () => {
        await ensureTicker(client);
        // Load and validate grumble state on startup
        const grumbleState = (0, game_1.getGrumbleState)(runtime);
        if (grumbleState && grumbleState.isActive) {
            // Check if grumble should end (block has passed)
            if ((0, game_1.shouldGrumbleEnd)(runtime)) {
                console.log('Grumble from previous session has expired, clearing state');
                await (0, game_1.clearGrumbleState)(runtime);
            }
            else {
                console.log(`Loaded active grumble from previous session: ${grumbleState.prizePool.toLocaleString()} GLYPHS prize pool, ${Object.keys(grumbleState.bets).length} participants`);
                // Check if there's a custom timer that needs to be restarted
                if (grumbleState.customTimerSec && grumbleState.customTimerEndsAt) {
                    await startGrumbleTimer(client);
                    console.log(`Restarted custom grumble timer: ${grumbleState.customTimerSec} seconds remaining`);
                }
            }
        }
        console.log('Glyphs bot ready');
        // Start health monitors once the gateway is ready
        startHealthMonitors(client);
    });
    // Handle guild member leave events to check for grumble winner leaving
    client.on(discord_js_1.Events.GuildMemberRemove, async (member) => {
        try {
            const grumble = (0, game_1.getGrumbleState)(runtime);
            if (!grumble || !grumble.isActive || !grumble.bets || Object.keys(grumble.bets).length === 0) {
                return; // No active grumble or no participants
            }
            // Check if the leaving member is a participant in the current grumble
            if (grumble.bets[member.id]) {
                // For grumble, we need to check if they would be the winner based on current bot choice
                // Since grumble ends at the next block, we need to determine who would win
                const currentBotChoice = runtime.state.data.lastBotChoice;
                if (currentBotChoice) {
                    // Find all potential winners based on current bot choice
                    let minDist = Infinity;
                    const potentialWinners = [];
                    for (const [userId, bet] of Object.entries(grumble.bets)) {
                        const betObj = bet;
                        const dist = (0, game_1.symbolDistance)(betObj.guess, currentBotChoice);
                        if (dist < minDist) {
                            minDist = dist;
                            potentialWinners.length = 0; // Clear previous winners
                            potentialWinners.push(userId);
                        }
                        else if (dist === minDist) {
                            potentialWinners.push(userId);
                        }
                    }
                    if (potentialWinners.includes(member.id)) {
                        // The winner has left! Send notification and start next grumble session
                        let notificationChannel = null;
                        if (runtime.notifyChannelId) {
                            notificationChannel = await client.channels.fetch(runtime.notifyChannelId);
                        }
                        else if (grumble.channelId) {
                            notificationChannel = await client.channels.fetch(grumble.channelId);
                        }
                        if (notificationChannel && notificationChannel.isTextBased()) {
                            const roleMention = runtime.notifyRoleId ? `<@&${runtime.notifyRoleId}> ` : '';
                            await notificationChannel.send(`${roleMention}🚨 **The winner has left and rug!** 🚨\n\nStarting next grumble session with increased prize pool...`);
                        }
                        // Start next grumble session while preserving the prize pool
                        const preservedPrizePool = grumble.prizePool;
                        const preservedBets = { ...grumble.bets };
                        // Reset grumble state but keep prize pool
                        const newGrumbleState = {
                            prizePool: preservedPrizePool, // Keep the prize pool
                            bets: {}, // Reset bets for new session
                            messageId: grumble.messageId, // Keep same message
                            channelId: grumble.channelId, // Keep same channel
                            blockNumber: runtime.state.data.currentBlock, // Set to current block
                            isActive: true, // Keep active
                        };
                        await (0, game_1.saveGrumbleState)(runtime, newGrumbleState);
                        // Update the grumble panel to show the new session with preserved prize pool
                        try {
                            if (grumble.channelId && grumble.messageId) {
                                const channel = await client.channels.fetch(grumble.channelId);
                                if (channel && channel.isTextBased()) {
                                    const grumbleMsg = await channel.messages.fetch(grumble.messageId);
                                    const { embed, rows } = (0, ui_2.buildGrumblePanel)(preservedPrizePool, false, runtime);
                                    await grumbleMsg.edit({ embeds: [embed], components: rows });
                                }
                            }
                        }
                        catch (error) {
                            console.error('Error updating grumble panel after winner left:', error);
                        }
                        console.log(`Grumble winner ${member.user.username} (${member.id}) left the server. Started new grumble session with preserved prize pool: ${preservedPrizePool.toLocaleString()} GLYPHS`);
                    }
                }
            }
        }
        catch (error) {
            console.error('Error handling guild member leave for grumble:', error);
        }
    });
    client.on(discord_js_1.Events.InteractionCreate, async (interaction) => {
        var _a, _b, _c, _d, _e;
        // Helper function to safely reply to interactions with error handling
        const safeReply = async (content, options) => {
            try {
                if ('replied' in interaction && (interaction.replied || interaction.deferred)) {
                    console.warn('Attempted to reply to already handled interaction:', interaction.id);
                    return;
                }
                if ('reply' in interaction) {
                    return await interaction.reply({ content, ...options });
                }
            }
            catch (error) {
                if (error instanceof discord_js_1.DiscordAPIError) {
                    // Handle specific Discord API errors
                    if (error.code === 50013) { // Missing Permissions
                        console.error('Bot missing permissions for interaction reply:', error.message);
                    }
                    else if (error.code === 50001) { // Missing Access
                        console.error('Bot missing access for interaction reply:', error.message);
                    }
                    else if (error.code === 10062) { // Unknown Interaction
                        console.error('Unknown interaction (likely expired):', error.message);
                    }
                    else {
                        console.error('Discord API error in interaction reply:', error.code, error.message);
                    }
                }
                else {
                    console.error('Failed to reply to interaction:', error);
                }
            }
        };
        const safeUpdate = async (content, options) => {
            try {
                if ('replied' in interaction && (interaction.replied || interaction.deferred)) {
                    console.warn('Attempted to update already handled interaction:', interaction.id);
                    return;
                }
                if ('update' in interaction) {
                    return await interaction.update({ content, ...options });
                }
            }
            catch (error) {
                if (error instanceof discord_js_1.DiscordAPIError) {
                    // Handle specific Discord API errors
                    if (error.code === 50013) { // Missing Permissions
                        console.error('Bot missing permissions for interaction update:', error.message);
                    }
                    else if (error.code === 50001) { // Missing Access
                        console.error('Bot missing access for interaction update:', error.message);
                    }
                    else if (error.code === 10062) { // Unknown Interaction
                        console.error('Unknown interaction (likely expired) for update:', error.message);
                    }
                    else {
                        console.error('Discord API error in interaction update:', error.code, error.message);
                    }
                }
                else {
                    console.error('Failed to update interaction:', error);
                }
            }
        };
        if (interaction.isChatInputCommand()) {
            // Basic per-user throttle for slash commands to avoid accidental double submits
            const userSlashCooldownMs = 750;
            const now = Date.now();
            (_a = global).__slashCooldowns ?? (_a.__slashCooldowns = new Map());
            const slashCooldowns = global.__slashCooldowns;
            const prevSlash = slashCooldowns.get(interaction.user.id) ?? 0;
            if (now - prevSlash < userSlashCooldownMs) {
                // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                return safeReply('You\'re sending commands too quickly. Please wait a moment.', { flags: discord_js_1.MessageFlags.Ephemeral });
            }
            slashCooldowns.set(interaction.user.id, now);
            // Global throttle for slash commands
            (_b = global).__slashGlobalWindow ?? (_b.__slashGlobalWindow = { windowStart: 0, count: 0 });
            const sg = global.__slashGlobalWindow;
            if (now - sg.windowStart > GLOBAL_BTN_WINDOW_MS) { // reuse same window size
                sg.windowStart = now;
                sg.count = 0;
            }
            sg.count += 1;
            if (sg.count > Math.max(10, Math.floor(GLOBAL_BTN_MAX_PER_WINDOW / 2))) { // stricter for slash
                // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                return safeReply('High command activity right now. Please try again shortly.', { flags: discord_js_1.MessageFlags.Ephemeral });
            }
            // Always allow /start and /stop
            if (interaction.commandName === 'start' || interaction.commandName === 'stop') {
                await (0, commands_1.handleSlash)(interaction, runtime);
                scheduleRefresh(client);
                return;
            }
            // /runblocks is a management command that should work when active
            if (interaction.commandName === 'runblocks') {
                // Only allow admins
                if (!interaction.memberPermissions || !interaction.memberPermissions.has(discord_js_1.PermissionFlagsBits.Administrator)) {
                    // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                    return safeReply('You do not have permission to use this command.', { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                const blocks = interaction.options.getInteger('blocks', true);
                const roleId = interaction.options.getString('role');
                const channelId = interaction.options.getString('channel');
                if (blocks <= 0) {
                    // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                    return safeReply('Blocks must be greater than 0.', { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                runtime.autorunRemainingBlocks = blocks;
                if (roleId)
                    runtime.notifyRoleId = roleId;
                if (channelId)
                    runtime.notifyChannelId = channelId;
                // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                await safeReply(`Autorun started for ${blocks} block(s). Notifications: ${roleId ? `<@&${roleId}>` : 'unchanged'} in ${channelId ? `<#${channelId}>` : 'unchanged or unset'}.`, { flags: discord_js_1.MessageFlags.Ephemeral });
                scheduleRefresh(client);
                return;
            }
            // Only allow other commands if active
            if (!runtime.isActive) {
                // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                return safeReply('Bot is currently stopped. Use /start to enable it again.', { flags: discord_js_1.MessageFlags.Ephemeral });
            }
            if (interaction.commandName === 'post') {
                if (!interaction.channel || !interaction.channel.isTextBased())
                    return;
                await postPanel(interaction.channel);
                await (0, commands_1.handleSlash)(interaction, runtime); // reply handled in commands.ts
                scheduleRefresh(client);
                return;
            }
            if (interaction.commandName === 'refresh') {
                // Refresh the existing panel if it exists
                if (panelChannelId && panelMessageId) {
                    await refreshPanel(client);
                    // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                    await safeReply('Mining bot UI panel has been refreshed.', { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                else {
                    // No existing panel, post a new one
                    if (!interaction.channel || !interaction.channel.isTextBased())
                        return;
                    await postPanel(interaction.channel);
                    // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                    await safeReply('Mining bot UI panel has been posted.', { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                return;
            }
            if (interaction.commandName === 'start') {
                if (!interaction.channel || !interaction.channel.isTextBased())
                    return;
                await postPanel(interaction.channel);
                // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                return safeReply('Panel posted.', { flags: discord_js_1.MessageFlags.Ephemeral });
            }
            if (interaction.commandName === 'grumble') {
                // Only allow admins
                if (!interaction.memberPermissions || !interaction.memberPermissions.has(discord_js_1.PermissionFlagsBits.Administrator)) {
                    return safeReply('You do not have permission to use this command.', { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                // Start a new grumble game (reset state)
                if ((0, game_1.isGrumbleActive)(runtime)) {
                    return safeReply('A grumble is already active. Use /grumble_restart to restart it.', { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                const newGrumbleState = {
                    prizePool: 0,
                    bets: {}, // userId: { amount, guess }
                    messageId: null,
                    channelId: interaction.channelId,
                    blockNumber: runtime.state.data.currentBlock,
                    isActive: true,
                };
                await (0, game_1.saveGrumbleState)(runtime, newGrumbleState);
                // Post the grumble panel in the channel
                if (!interaction.channel || !interaction.channel.isTextBased())
                    return;
                const grumble = (0, game_1.getGrumbleState)(runtime);
                if (!grumble) {
                    return safeReply('Error: Failed to create grumble state.', { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                try {
                    const { embed, rows } = (0, ui_2.buildGrumblePanel)(grumble.prizePool, false, runtime);
                    const message = await interaction.channel.send({ embeds: [embed], components: rows });
                    // Update grumble state with message info
                    const updatedGrumbleState = {
                        prizePool: grumble.prizePool,
                        bets: grumble.bets,
                        messageId: message.id,
                        channelId: message.channel.id,
                        blockNumber: grumble.blockNumber,
                        isActive: grumble.isActive,
                    };
                    await (0, game_1.saveGrumbleState)(runtime, updatedGrumbleState);
                    // Reply to the user that grumble was started
                    await safeReply('Grumble started! The grumble panel has been posted.', { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                catch (error) {
                    if (error instanceof discord_js_1.DiscordAPIError) {
                        if (error.code === 50013) { // Missing Permissions
                            console.error('Bot missing permissions to send grumble panel:', error.message);
                            return safeReply('Error: Bot missing permissions to post grumble panel in this channel.', { flags: discord_js_1.MessageFlags.Ephemeral });
                        }
                        else if (error.code === 50001) { // Missing Access
                            console.error('Bot missing access to send grumble panel:', error.message);
                            return safeReply('Error: Bot cannot access this channel to post grumble panel.', { flags: discord_js_1.MessageFlags.Ephemeral });
                        }
                        else {
                            console.error('Discord API error sending grumble panel:', error.code, error.message);
                            return safeReply('Error posting grumble panel. Please try again.', { flags: discord_js_1.MessageFlags.Ephemeral });
                        }
                    }
                    else {
                        console.error('Failed to send grumble panel:', error);
                        return safeReply('Error posting grumble panel. Please try again.', { flags: discord_js_1.MessageFlags.Ephemeral });
                    }
                }
                return;
            }
            if (interaction.commandName === 'grumble_restart') {
                // Only allow admins
                if (!interaction.memberPermissions || !interaction.memberPermissions.has(discord_js_1.PermissionFlagsBits.Administrator)) {
                    return safeReply('You do not have permission to use this command.', { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                // Restart the current grumble game (preserve participant history)
                if (!(0, game_1.isGrumbleActive)(runtime)) {
                    return safeReply('No active grumble to restart.', { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                const grumble = (0, game_1.getGrumbleState)(runtime);
                if (!grumble) {
                    return safeReply('Error: No grumble state found.', { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                // Preserve the existing bets and prize pool, but update the block number
                const updatedGrumbleState = {
                    prizePool: grumble.prizePool,
                    bets: grumble.bets,
                    messageId: grumble.messageId,
                    channelId: grumble.channelId,
                    blockNumber: runtime.state.data.currentBlock,
                    isActive: grumble.isActive,
                };
                await (0, game_1.saveGrumbleState)(runtime, updatedGrumbleState);
                // Update the grumble panel to show the new timing
                try {
                    if (grumble.channelId && grumble.messageId) {
                        const channel = await client.channels.fetch(grumble.channelId);
                        if (channel && channel.isTextBased()) {
                            const grumbleMsg = await channel.messages.fetch(grumble.messageId);
                            const { embed, rows } = (0, ui_2.buildGrumblePanel)(grumble.prizePool, false, runtime);
                            await grumbleMsg.edit({ embeds: [embed], components: rows });
                            await safeReply('Grumble restarted! The grumble will now end at the next block. Participant history preserved.', { flags: discord_js_1.MessageFlags.Ephemeral });
                        }
                    }
                }
                catch (error) {
                    console.error('Error updating grumble panel during restart:', error);
                    await safeReply('Grumble restarted but failed to update panel. Participant history preserved.', { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                return;
            }
            if (interaction.commandName === 'grumblepanel') {
                // Only allow admins
                if (!interaction.memberPermissions || !interaction.memberPermissions.has(discord_js_1.PermissionFlagsBits.Administrator)) {
                    return safeReply('You do not have permission to use this command.', { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                // Repost the grumble panel if there's an active grumble
                if (!(0, game_1.isGrumbleActive)(runtime)) {
                    return safeReply('No active grumble to repost panel for.', { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                const grumble = (0, game_1.getGrumbleState)(runtime);
                if (!grumble) {
                    return safeReply('Error: No grumble state found.', { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                // Post the grumble panel in the channel
                if (!interaction.channel || !interaction.channel.isTextBased())
                    return;
                try {
                    const { embed, rows } = (0, ui_2.buildGrumblePanel)(grumble.prizePool, false, runtime);
                    const message = await interaction.channel.send({ embeds: [embed], components: rows });
                    // Update grumble state with new message info
                    const updatedGrumbleState = {
                        prizePool: grumble.prizePool,
                        bets: grumble.bets,
                        messageId: message.id,
                        channelId: message.channel.id,
                        blockNumber: grumble.blockNumber,
                        isActive: grumble.isActive,
                    };
                    await (0, game_1.saveGrumbleState)(runtime, updatedGrumbleState);
                    // Reply to the user that grumble panel was reposted
                    await safeReply('Grumble panel reposted successfully.', { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                catch (error) {
                    if (error instanceof discord_js_1.DiscordAPIError) {
                        if (error.code === 50013) { // Missing Permissions
                            console.error('Bot missing permissions to send grumble panel:', error.message);
                            return safeReply('Error: Bot missing permissions to post grumble panel in this channel.', { flags: discord_js_1.MessageFlags.Ephemeral });
                        }
                        else if (error.code === 50001) { // Missing Access
                            console.error('Bot missing access to send grumble panel:', error.message);
                            return safeReply('Error: Bot cannot access this channel to post grumble panel.', { flags: discord_js_1.MessageFlags.Ephemeral });
                        }
                        else {
                            console.error('Discord API error sending grumble panel:', error.code, error.message);
                            return safeReply('Error posting grumble panel. Please try again.', { flags: discord_js_1.MessageFlags.Ephemeral });
                        }
                    }
                    else {
                        console.error('Failed to send grumble panel:', error);
                        return safeReply('Error posting grumble panel. Please try again.', { flags: discord_js_1.MessageFlags.Ephemeral });
                    }
                }
                return;
            }
            if (interaction.commandName === 'grumbletimer') {
                // Only allow admins
                if (!interaction.memberPermissions || !interaction.memberPermissions.has(discord_js_1.PermissionFlagsBits.Administrator)) {
                    return safeReply('You do not have permission to use this command.', { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                const seconds = interaction.options.getInteger('seconds', true);
                if (seconds < 0) {
                    return safeReply('Timer must be 0 or greater. Use 0 to disable custom timer.', { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                // Check if there's an active grumble
                if (!(0, game_1.isGrumbleActive)(runtime)) {
                    return safeReply('No active grumble to set timer for.', { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                const grumble = (0, game_1.getGrumbleState)(runtime);
                if (!grumble) {
                    return safeReply('Error: No grumble state found.', { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                // Update grumble state with timer settings
                const updatedGrumbleState = {
                    ...grumble,
                    ...(seconds === 0 ? {} : {
                        customTimerSec: seconds,
                        customTimerEndsAt: Date.now() + (seconds * 1000)
                    })
                };
                await (0, game_1.saveGrumbleState)(runtime, updatedGrumbleState);
                // Start the grumble timer if custom timer is set
                if (seconds > 0) {
                    await startGrumbleTimer(client);
                }
                // Update the grumble panel to show the new timer
                try {
                    if (grumble.channelId && grumble.messageId) {
                        const channel = await client.channels.fetch(grumble.channelId);
                        if (channel && channel.isTextBased()) {
                            const grumbleMsg = await channel.messages.fetch(grumble.messageId);
                            const { embed, rows } = (0, ui_2.buildGrumblePanel)(grumble.prizePool, false, runtime);
                            await grumbleMsg.edit({ embeds: [embed], components: rows });
                        }
                    }
                }
                catch (error) {
                    console.error('Error updating grumble panel after timer change:', error);
                }
                if (seconds === 0) {
                    await safeReply('Custom grumble timer disabled. Grumble will now follow block timing.', { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                else {
                    await safeReply(`Grumble timer set to ${seconds} seconds. Grumble will end in ${seconds} seconds regardless of blocks.`, { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                return;
            }
            if (interaction.commandName === 'setglyphs') {
                // Only allow admins
                if (!interaction.memberPermissions || !interaction.memberPermissions.has(discord_js_1.PermissionFlagsBits.Administrator)) {
                    return safeReply('You do not have permission to use this command.', { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                const targetUser = interaction.options.getUser('user', true);
                const amount = interaction.options.getInteger('amount', true);
                if (amount <= 0) {
                    return safeReply('Amount must be greater than 0.', { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                try {
                    const newBalance = await (0, game_1.setUserGlyphs)(runtime, targetUser.id, amount);
                    await safeReply(`Set ${targetUser.username}'s balance to ${newBalance.toLocaleString()} GLYPHS.`, { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                catch (error) {
                    console.error('Error setting user glyphs:', error);
                    await safeReply('Error updating user balance. Please try again.', { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                return;
            }
            await (0, commands_1.handleSlash)(interaction, runtime);
            scheduleRefresh(client);
            return;
        }
        if (interaction.isButton()) {
            // Per-user cooldown to reduce spam clicking
            const userCooldownMs = 750;
            const now = Date.now();
            (_c = global).__btnCooldowns ?? (_c.__btnCooldowns = new Map());
            const cooldowns = global.__btnCooldowns;
            const prev = cooldowns.get(interaction.user.id) ?? 0;
            if (now - prev < userCooldownMs) {
                if (!interaction.replied && !interaction.deferred) {
                    return safeReply('You\'re doing that too fast. Please wait a moment.', { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                return;
            }
            cooldowns.set(interaction.user.id, now);
            // Global rate limit: shed excess load if too many interactions arrive at once
            const g = global.__btnGlobalWindow;
            if (now - g.windowStart > GLOBAL_BTN_WINDOW_MS) {
                g.windowStart = now;
                g.count = 0;
            }
            g.count += 1;
            if (g.count > GLOBAL_BTN_MAX_PER_WINDOW) {
                // Politely inform the user; ephemeral to avoid extra channel noise
                if (!interaction.replied && !interaction.deferred) {
                    return safeReply('The bot is busy right now due to high activity. Please try again in a moment.', { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                return;
            }
            // Handle the 'mine' button
            if (interaction.customId === 'mine') {
                const selected = runtime.currentChoices[interaction.user.id];
                const buttonRows = (0, ui_1.buildChoiceMenu)(selected);
                // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                return safeReply('Pick your rune:', { components: buttonRows, flags: discord_js_1.MessageFlags.Ephemeral });
            }
            // Handle the 'balance' button
            if (interaction.customId === 'balance') {
                const bal = (0, game_1.getBalance)(runtime, interaction.user.id);
                // Prefill an X (Twitter) intent URL with the user's balance and a mention to @glyphsrunes
                const tweetText = `GLYPHS Balance = ${bal.toLocaleString()} GLYPHS\nCome Mining in @glyphsrunes`;
                const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;
                const shareBtn = new discord_js_1.ButtonBuilder().setLabel('Share on X').setStyle(discord_js_1.ButtonStyle.Link).setURL(tweetUrl);
                const row = new discord_js_1.ActionRowBuilder().addComponents(shareBtn);
                // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                return safeReply(`Your balance: ${bal.toLocaleString()} GLYPHS`, { components: [row], flags: discord_js_1.MessageFlags.Ephemeral });
            }
            // Handle the 'checkbet' button
            if (interaction.customId === 'checkbet') {
                const betInfo = (0, game_1.getUserBetInfo)(runtime, interaction.user.id);
                // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                return safeReply(betInfo, { flags: discord_js_1.MessageFlags.Ephemeral });
            }
            // Handle the 'lastreward' button
            if (interaction.customId === 'lastreward') {
                const lastBlockInfo = (0, game_1.getLastBlockRewardInfo)(runtime);
                // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                return safeReply(lastBlockInfo, { flags: discord_js_1.MessageFlags.Ephemeral });
            }
            // Handle the 'rewardrecords' button
            if (interaction.customId === 'rewardrecords') {
                const userRecords = (0, game_1.getUserRewardRecords)(runtime, interaction.user.id);
                // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                return safeReply(userRecords, { flags: discord_js_1.MessageFlags.Ephemeral });
            }
            // Handle the 'leaderboard' button
            if (interaction.customId === 'leaderboard') {
                try {
                    // Under high load, avoid repeated expensive leaderboard recomputation
                    if (isHighLoad && cachedLeaderboardForButton) {
                        // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                        return safeReply(cachedLeaderboardForButton.content, { flags: discord_js_1.MessageFlags.Ephemeral });
                    }
                    // Serve cached leaderboard if fresh to reduce repeated work under spam
                    if (cachedLeaderboardForButton && cachedLeaderboardForButton.expiresAt > Date.now()) {
                        // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                        return safeReply(cachedLeaderboardForButton.content, { flags: discord_js_1.MessageFlags.Ephemeral });
                    }
                    const leaderboard = await (0, game_1.getLeaderboard)(runtime, interaction);
                    cachedLeaderboardForButton = { content: leaderboard, expiresAt: Date.now() + 5000 }; // 5s cache
                    // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                    return safeReply(leaderboard, { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                catch (error) {
                    if (error instanceof discord_js_1.DiscordAPIError) {
                        console.error('Discord API error in leaderboard interaction:', error.code, error.message);
                    }
                    else {
                        console.error('Error handling leaderboard interaction:', error);
                    }
                    if (!interaction.replied && !interaction.deferred) {
                        // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                        return safeReply('Error generating leaderboard. Please try again.', { flags: discord_js_1.MessageFlags.Ephemeral });
                    }
                }
            }
            // Handle rune selection buttons
            if (interaction.customId.startsWith('rune_')) {
                const choice = interaction.customId.replace('rune_', '');
                if (!game_1.SYMBOLS.includes(choice))
                    return safeReply('Invalid choice.', { flags: discord_js_1.MessageFlags.Ephemeral });
                await (0, game_1.recordChoice)(runtime, interaction.user.id, choice);
                const buttonRows = (0, ui_1.buildChoiceMenu)(choice);
                await safeUpdate(`You chose ${choice}. You can change it until the block ends.`, { components: buttonRows });
                scheduleRefresh(client);
                return;
            }
            // Handle the 'grumble_join' button
            if (interaction.customId === 'grumble_join') {
                const grumble = (0, game_1.getGrumbleState)(runtime);
                if (!grumble || !grumble.isActive)
                    return safeReply('No active grumble.', { flags: discord_js_1.MessageFlags.Ephemeral });
                if (grumble.bets[interaction.user.id]) {
                    // User already joined - show their current bet info
                    const userBet = grumble.bets[interaction.user.id];
                    if (userBet) {
                        return safeReply(`**Your Current Grumble Bet:**\n\n💰 **Amount:** ${userBet.amount.toLocaleString()} GLYPHS\n🎯 **Rune Guess:** ${userBet.guess}\n\nYou cannot change your bet once placed.`, { flags: discord_js_1.MessageFlags.Ephemeral });
                    }
                }
                else {
                    // User hasn't joined yet - show rune selection menu
                    const { embed, rows } = (0, ui_1.buildGrumbleRuneSelection)();
                    await safeReply('Choose your rune for the grumble:', { embeds: [embed], components: rows, flags: discord_js_1.MessageFlags.Ephemeral });
                }
                return;
            }
            // Handle grumble rune selection
            if (interaction.customId.startsWith('grumble_rune_')) {
                const grumble = (0, game_1.getGrumbleState)(runtime);
                if (!grumble || !grumble.isActive)
                    return safeReply('No active grumble.', { flags: discord_js_1.MessageFlags.Ephemeral });
                if (grumble.bets[interaction.user.id]) {
                    return safeReply('You already joined the grumble.', { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                const selectedRune = interaction.customId.replace('grumble_rune_', '');
                if (!game_1.SYMBOLS.includes(selectedRune)) {
                    return safeReply('Invalid rune selection.', { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                // Store the selected rune temporarily with timestamp
                (_d = global).__grumbleTempSelections ?? (_d.__grumbleTempSelections = {});
                global.__grumbleTempSelections[interaction.user.id] = {
                    rune: selectedRune,
                    timestamp: Date.now()
                };
                // Show amount input
                const { embed, rows } = (0, ui_1.buildGrumbleAmountInput)(selectedRune, (0, game_1.getBalance)(runtime, interaction.user.id));
                await safeReply('Choose your bet amount:', { embeds: [embed], components: rows, flags: discord_js_1.MessageFlags.Ephemeral });
                return;
            }
            // Handle grumble amount selection
            if (interaction.customId.startsWith('grumble_amount_')) {
                const grumble = (0, game_1.getGrumbleState)(runtime);
                if (!grumble || !grumble.isActive)
                    return safeReply('No active grumble.', { flags: discord_js_1.MessageFlags.Ephemeral });
                if (grumble.bets[interaction.user.id]) {
                    return safeReply('You already joined the grumble.', { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                const tempSelections = global.__grumbleTempSelections;
                if (!tempSelections || !tempSelections[interaction.user.id]) {
                    return safeReply('Please select a rune first.', { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                const amountStr = interaction.customId.replace('grumble_amount_', '');
                const amount = parseInt(amountStr, 10);
                if (!amount || amount <= 0) {
                    return safeReply('Invalid amount.', { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                const userBalance = (0, game_1.getBalance)(runtime, interaction.user.id);
                if (amount > userBalance) {
                    return safeReply(`You don't have enough glyphs. Your balance: ${userBalance.toLocaleString()} GLYPHS`, { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                const selectedRune = tempSelections[interaction.user.id].rune;
                // Process the bet
                runtime.balances.data[interaction.user.id] = userBalance - amount;
                await runtime.balances.write();
                // Update grumble state
                const updatedGrumbleState = {
                    ...grumble,
                    prizePool: grumble.prizePool + amount,
                    bets: {
                        ...grumble.bets,
                        [interaction.user.id]: { amount, guess: selectedRune }
                    }
                };
                await (0, game_1.saveGrumbleState)(runtime, updatedGrumbleState);
                // Clean up temp selection
                delete tempSelections[interaction.user.id];
                // Update grumble panel
                if (grumble.channelId && grumble.messageId) {
                    const channel = await client.channels.fetch(grumble.channelId);
                    if (channel && channel.isTextBased()) {
                        const grumbleMsg = await channel.messages.fetch(grumble.messageId);
                        const { embed, rows } = (0, ui_2.buildGrumblePanel)(updatedGrumbleState.prizePool, true, runtime);
                        await grumbleMsg.edit({ embeds: [embed], components: rows });
                    }
                }
                await safeReply(`You joined the grumble with ${amount.toLocaleString()} GLYPHS and guessed ${selectedRune}. Good luck! Your new balance: ${(userBalance - amount).toLocaleString()} GLYPHS`, { flags: discord_js_1.MessageFlags.Ephemeral });
                return;
            }
        }
        // Future-proof: apply similar throttles to select menus if added later
        if (interaction.isStringSelectMenu && interaction.isStringSelectMenu()) {
            const userSelectCooldownMs = 750;
            const now = Date.now();
            (_e = global).__selectCooldowns ?? (_e.__selectCooldowns = new Map());
            const selectCooldowns = global.__selectCooldowns;
            const prevSel = selectCooldowns.get(interaction.user.id) ?? 0;
            if (now - prevSel < userSelectCooldownMs) {
                if (!interaction.replied && !interaction.deferred) {
                    return safeReply('You\'re doing that too fast. Please wait a moment.', { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                return;
            }
            selectCooldowns.set(interaction.user.id, now);
            const g = global.__btnGlobalWindow;
            if (now - g.windowStart > GLOBAL_BTN_WINDOW_MS) {
                g.windowStart = now;
                g.count = 0;
            }
            g.count += 1;
            if (g.count > GLOBAL_BTN_MAX_PER_WINDOW) {
                if (!interaction.replied && !interaction.deferred) {
                    return safeReply('The bot is busy right now due to high activity. Please try again in a moment.', { flags: discord_js_1.MessageFlags.Ephemeral });
                }
                return;
            }
        }
    });
    await client.login(process.env.DISCORD_TOKEN);
}
main().catch(err => {
    console.error(err);
    process.exit(1);
});
// Global safety nets to prevent crashes from unhandled errors
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    // Try to keep running after logging; do not exit immediately
});
// Graceful shutdown on common signals
process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
//# sourceMappingURL=index.js.map