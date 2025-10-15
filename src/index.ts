import 'dotenv/config';
import express from 'express';
import { Client, GatewayIntentBits, Interaction, MessageComponentInteraction, StringSelectMenuInteraction, Events, TextChannel, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, MessageFlags, DiscordAPIError, GuildMember, PartialGuildMember } from 'discord.js';
import { buildChoiceMenu, buildPanel, buildGrumbleRuneSelection, buildGrumbleAmountInput } from './ui';
import { GameRuntime, initGame, recordChoice, SYMBOLS, SymbolRune, startTicker, getBalance, getLastBlockRewardInfo, getUserRewardRecords, getLeaderboard, pickRandomSymbol, symbolDistance, saveGrumbleState, getGrumbleState, clearGrumbleState, isGrumbleActive, shouldGrumbleEnd, setUserGlyphs, getUserBetInfo } from './game';
import { GrumbleState } from './storage';
import { handleSlash } from './commands';
import { buildGrumblePanel } from './ui';

let runtime: GameRuntime;
let ticker: NodeJS.Timeout | undefined;
let panelMessageId: string | undefined;
let panelChannelId: string | undefined;
let uiRefresher: NodeJS.Timeout | undefined;
let healthLagMonitor: NodeJS.Timeout | undefined;
let healthMemoryLogger: NodeJS.Timeout | undefined;
let cooldownGcTimer: NodeJS.Timeout | undefined;
let grumbleTimer: NodeJS.Timeout | undefined;
let clientRef: Client | undefined;

// Basic overload protection: throttle panel refreshes
let lastRefreshAt = 0;
let pendingRefresh: NodeJS.Timeout | undefined;
const REFRESH_MIN_INTERVAL_MS = 2000; // limit edits to ~1 per 2s (increased from 1.5s)

// Global interaction throttle to protect against spam storms across the entire guild
// This limits how many button interactions the bot will process per short window.
const GLOBAL_BTN_WINDOW_MS = 1000; // 1 second window
const GLOBAL_BTN_MAX_PER_WINDOW = 25; // allow up to 25 button interactions per second globally
(global as any).__btnGlobalWindow ??= { windowStart: 0, count: 0 } as { windowStart: number; count: number };

// Lightweight cache for leaderboard responses triggered by the panel button to avoid
// repeated heavy computation and user fetches during spam bursts.
let cachedLeaderboardForButton: { content: string; expiresAt: number } | undefined;

// Event-loop lag and high-load flag help us shed non-essential work under stress
let isHighLoad = false;
let consecutiveLagSeconds = 0;

// Grumble state is now persisted in runtime.state.data.grumbleState

// Centralized graceful shutdown
async function shutdown(reason: string) {
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
            try { await runtime.state.write(); } catch {}
            try { await runtime.balances.write(); } catch {}
        }
        // Close Discord connection last
        if (clientRef) {
            try { clientRef.destroy(); } catch {}
        }
    } finally {
        process.exit(0);
    }
}

// Start lightweight health monitors to keep the bot responsive during long runs
function startHealthMonitors(client: Client) {
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
                    setTimeout(() => { isHighLoad = false; consecutiveLagSeconds = 0; }, 10_000);
                }
                console.warn(`Event loop lag detected: ~${driftMs}ms (consec=${consecutiveLagSeconds})`);
            } else {
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
        }, 60_000);
    }

    // Garbage-collect per-user cooldown maps to prevent unbounded growth over hours/days
    if (!cooldownGcTimer) {
        cooldownGcTimer = setInterval(() => {
            const cutoff = Date.now() - 10 * 60 * 1000; // 10 minutes
            const prune = (map: Map<string, number>) => {
                for (const [uid, ts] of map) { if (ts < cutoff) map.delete(uid); }
            };
            const globals: any = global as any;
            if (globals.__slashCooldowns instanceof Map) prune(globals.__slashCooldowns);
            if (globals.__btnCooldowns instanceof Map) prune(globals.__btnCooldowns);
            if (globals.__selectCooldowns instanceof Map) prune(globals.__selectCooldowns);
            
            // Clear grumble temp selections that are older than 5 minutes
            if (globals.__grumbleTempSelections) {
                const grumbleCutoff = Date.now() - 5 * 60 * 1000; // 5 minutes
                for (const [uid, data] of Object.entries(globals.__grumbleTempSelections)) {
                    if (data && typeof data === 'object' && 'timestamp' in data) {
                        if ((data as any).timestamp < grumbleCutoff) {
                            delete globals.__grumbleTempSelections[uid];
                        }
                    }
                }
            }
            
            // Clear leaderboard cache if it's expired
            if (cachedLeaderboardForButton && cachedLeaderboardForButton.expiresAt < Date.now()) {
                cachedLeaderboardForButton = undefined;
            }
        }, 30_000); // Run cleanup every 30 seconds instead of 60
    }
}

async function ensureTicker(client: Client) {
    if (!ticker) {
        ticker = startTicker(runtime);
        runtime.onBlockAdvance = async (newBlock, botChoice) => {
            // Refresh the game panel
            scheduleRefresh(client);
            // Notify role on block change if configured
            try {
                if (runtime.notifyChannelId && runtime.notifyRoleId) {
                    const channel = await client.channels.fetch(runtime.notifyChannelId);
                    if (channel && channel.isTextBased()) {
                        await (channel as TextChannel).send({
                            content: `<@&${runtime.notifyRoleId}> Block ${newBlock} started. Bot picked: ${botChoice}`
                        });
                    }
                }
            } catch (e) {
                if (e instanceof DiscordAPIError) {
                    if (e.code === 50013) { // Missing Permissions
                        console.error('Bot missing permissions to send block notification:', e.message);
                    } else if (e.code === 50001) { // Missing Access
                        console.error('Bot missing access to send block notification:', e.message);
                    } else {
                        console.error('Discord API error sending block notification:', e.code, e.message);
                    }
                } else {
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
                                await (channel as TextChannel).send({
                                    content: `<@&${runtime.notifyRoleId}> Block is over. Shutting down...`
                                });
                            }
                        }
                    } catch (e) {
                        if (e instanceof DiscordAPIError) {
                            if (e.code === 50013) { // Missing Permissions
                                console.error('Bot missing permissions to send final block notification:', e.message);
                            } else if (e.code === 50001) { // Missing Access
                                console.error('Bot missing access to send final block notification:', e.message);
                            } else {
                                console.error('Discord API error sending final block notification:', e.code, e.message);
                            }
                        } else {
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
            const grumble = getGrumbleState(runtime);
            if (grumble && grumble.isActive && shouldGrumbleEnd(runtime)) {
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

async function startGrumbleTimer(client: Client) {
    if (grumbleTimer) {
        clearTimeout(grumbleTimer);
        grumbleTimer = undefined;
    }
    
    const grumble = getGrumbleState(runtime);
    if (!grumble || !grumble.isActive || !grumble.customTimerSec || !grumble.customTimerEndsAt) {
        return; // No custom timer active
    }
    
    const timeLeft = grumble.customTimerEndsAt - Date.now();
    if (timeLeft <= 0) {
        // Timer already expired, resolve grumble immediately
        await resolveGrumble(client, pickRandomSymbol());
        return;
    }
    
    grumbleTimer = setTimeout(async () => {
        await resolveGrumble(client, pickRandomSymbol());
    }, timeLeft);
}

async function resolveGrumble(client: Client, botChoice: SymbolRune) {
    const grumble = getGrumbleState(runtime);
    if (!grumble || !grumble.isActive) return;
    
    // End grumble, find winner
    const bets = grumble.bets;
    if (Object.keys(bets).length === 0) {
        // No participants - send to same channel as block notifications
        let notificationChannel = null;
        if (runtime.notifyChannelId) {
            notificationChannel = await client.channels.fetch(runtime.notifyChannelId);
        } else if (grumble.channelId) {
            // Fallback to grumble channel if no notification channel is set
            notificationChannel = await client.channels.fetch(grumble.channelId);
        }
        
        if (notificationChannel && notificationChannel.isTextBased()) {
            const roleMention = runtime.notifyRoleId ? `<@&${runtime.notifyRoleId}> ` : '';
            await (notificationChannel as TextChannel).send(`${roleMention}No one joined the grumble. Prize pool is returned.`);
        }
    } else {
        // Find all winners with minimum distance (handle ties)
        let minDist = Infinity;
        const winners: { userId: string; bet: { amount: number; guess: string } }[] = [];
        
        for (const [userId, bet] of Object.entries(bets)) {
            const betObj = bet as { amount: number; guess: string };
            const dist = symbolDistance(betObj.guess as SymbolRune, botChoice);
            
            if (dist < minDist) {
                // New minimum distance found
                minDist = dist;
                winners.length = 0; // Clear previous winners
                winners.push({ userId, bet: betObj });
            } else if (dist === minDist) {
                // Tie for minimum distance
                winners.push({ userId, bet: betObj });
            }
        }
        // Send grumble result to the same channel as block notifications
        let notificationChannel = null;
        if (runtime.notifyChannelId) {
            notificationChannel = await client.channels.fetch(runtime.notifyChannelId);
        } else if (grumble.channelId) {
            // Fallback to grumble channel if no notification channel is set
            notificationChannel = await client.channels.fetch(grumble.channelId);
        }
        
        if (notificationChannel && notificationChannel.isTextBased()) {
            if (winners.length > 0) {
                const prizePerWinner = Math.floor(grumble.prizePool / winners.length);
                const roleMention = runtime.notifyRoleId ? `<@&${runtime.notifyRoleId}> ` : '';
                
                // Distribute prizes to all winners
                const winnerMentions: string[] = [];
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
                        await (notificationChannel as TextChannel).send(`${roleMention}<@${winner.userId}> wins the grumble and takes ${grumble.prizePool.toLocaleString()} GLYPHS! Bot chose: ${botChoice}\nNew balance: ${winnerBalance.toLocaleString()} GLYPHS`);
                    }
                } else {
                    // Multiple winners (tie)
                    await (notificationChannel as TextChannel).send(`${roleMention}🏆 **TIE!** ${winnerMentions.join(', ')} all win the grumble!\n\nBot chose: ${botChoice}\nPrize pool: ${grumble.prizePool.toLocaleString()} GLYPHS\nEach winner gets: ${prizePerWinner.toLocaleString()} GLYPHS`);
                }
            } else {
                const roleMention = runtime.notifyRoleId ? `<@&${runtime.notifyRoleId}> ` : '';
                await (notificationChannel as TextChannel).send(`${roleMention}No valid winner for the grumble.`);
            }
        }
    }
    await clearGrumbleState(runtime);
    
    // Clear the grumble timer
    if (grumbleTimer) {
        clearTimeout(grumbleTimer);
        grumbleTimer = undefined;
    }
}

async function refreshPanel(client: Client) {
    if (!panelChannelId || !panelMessageId) return;
    const channel = await client.channels.fetch(panelChannelId);
    if (!channel || !channel.isTextBased()) return;
    const { embed, rows } = buildPanel(runtime);
    try {
        const msg = await (channel as TextChannel).messages.fetch(panelMessageId);
        await msg.edit({ embeds: [embed], components: rows });
    } catch (error) {
        if (error instanceof DiscordAPIError) {
            if (error.code === 10008) { // Unknown Message
                console.warn('Panel message no longer exists, clearing reference');
                panelMessageId = undefined;
                panelChannelId = undefined;
            } else if (error.code === 50013) { // Missing Permissions
                console.error('Bot missing permissions to edit panel message:', error.message);
            } else if (error.code === 50001) { // Missing Access
                console.error('Bot missing access to edit panel message:', error.message);
            } else {
                console.error('Discord API error editing panel message:', error.code, error.message);
            }
        } else {
            console.error('Failed to edit panel message:', error);
        }
    }
}

function scheduleRefresh(client: Client) {
    const now = Date.now();
    const elapsed = now - lastRefreshAt;
    if (elapsed >= REFRESH_MIN_INTERVAL_MS && !pendingRefresh) {
        lastRefreshAt = now;
        void refreshPanel(client);
        return;
    }
    if (pendingRefresh) return;
    const delay = Math.max(0, REFRESH_MIN_INTERVAL_MS - elapsed);
    pendingRefresh = setTimeout(() => {
        pendingRefresh = undefined;
        lastRefreshAt = Date.now();
        void refreshPanel(client);
    }, delay);
}

async function postPanel(channel: TextChannel) {
    const { embed, rows } = buildPanel(runtime);
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
    runtime = await initGame();

    const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
    clientRef = client; // keep a reference for graceful shutdown

    client.once(Events.ClientReady, async () => {
        await ensureTicker(client);
        
        // Load and validate grumble state on startup
        const grumbleState = getGrumbleState(runtime);
        if (grumbleState && grumbleState.isActive) {
            // Check if grumble should end (block has passed)
            if (shouldGrumbleEnd(runtime)) {
                console.log('Grumble from previous session has expired, clearing state');
                await clearGrumbleState(runtime);
            } else {
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
    client.on(Events.GuildMemberRemove, async (member: GuildMember | PartialGuildMember) => {
        try {
            const grumble = getGrumbleState(runtime);
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
                    const potentialWinners: string[] = [];
                    
                    for (const [userId, bet] of Object.entries(grumble.bets)) {
                        const betObj = bet as { amount: number; guess: string };
                        const dist = symbolDistance(betObj.guess as SymbolRune, currentBotChoice as SymbolRune);
                        
                        if (dist < minDist) {
                            minDist = dist;
                            potentialWinners.length = 0; // Clear previous winners
                            potentialWinners.push(userId);
                        } else if (dist === minDist) {
                            potentialWinners.push(userId);
                        }
                    }
                    
                    if (potentialWinners.includes(member.id)) {
                        // The winner has left! Send notification and start next grumble session
                        let notificationChannel = null;
                        if (runtime.notifyChannelId) {
                            notificationChannel = await client.channels.fetch(runtime.notifyChannelId);
                        } else if (grumble.channelId) {
                            notificationChannel = await client.channels.fetch(grumble.channelId);
                        }
                        
                        if (notificationChannel && notificationChannel.isTextBased()) {
                            const roleMention = runtime.notifyRoleId ? `<@&${runtime.notifyRoleId}> ` : '';
                            await (notificationChannel as TextChannel).send(`${roleMention}🚨 **The winner has left and rug!** 🚨\n\nStarting next grumble session with increased prize pool...`);
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
                        await saveGrumbleState(runtime, newGrumbleState);
                        
                        // Update the grumble panel to show the new session with preserved prize pool
                        try {
                            if (grumble.channelId && grumble.messageId) {
                                const channel = await client.channels.fetch(grumble.channelId);
                                if (channel && channel.isTextBased()) {
                                    const grumbleMsg = await (channel as TextChannel).messages.fetch(grumble.messageId);
                                    const { embed, rows } = buildGrumblePanel(preservedPrizePool, false, runtime);
                                    await grumbleMsg.edit({ embeds: [embed], components: rows });
                                }
                            }
                        } catch (error) {
                            console.error('Error updating grumble panel after winner left:', error);
                        }
                        
                        console.log(`Grumble winner ${member.user.username} (${member.id}) left the server. Started new grumble session with preserved prize pool: ${preservedPrizePool.toLocaleString()} GLYPHS`);
                    }
                }
            }
        } catch (error) {
            console.error('Error handling guild member leave for grumble:', error);
        }
    });

    client.on(Events.InteractionCreate, async (interaction: Interaction) => {
        // Helper function to safely reply to interactions with error handling
        const safeReply = async (content: string, options?: any) => {
            try {
                if ('replied' in interaction && (interaction.replied || interaction.deferred)) {
                    console.warn('Attempted to reply to already handled interaction:', interaction.id);
                    return;
                }
                if ('reply' in interaction) {
                    return await interaction.reply({ content, ...options });
                }
            } catch (error) {
                if (error instanceof DiscordAPIError) {
                    // Handle specific Discord API errors
                    if (error.code === 50013) { // Missing Permissions
                        console.error('Bot missing permissions for interaction reply:', error.message);
                    } else if (error.code === 50001) { // Missing Access
                        console.error('Bot missing access for interaction reply:', error.message);
                    } else if (error.code === 10062) { // Unknown Interaction
                        console.error('Unknown interaction (likely expired):', error.message);
                    } else {
                        console.error('Discord API error in interaction reply:', error.code, error.message);
                    }
                } else {
                    console.error('Failed to reply to interaction:', error);
                }
            }
        };

        const safeUpdate = async (content: string, options?: any) => {
            try {
                if ('replied' in interaction && (interaction.replied || interaction.deferred)) {
                    console.warn('Attempted to update already handled interaction:', interaction.id);
                    return;
                }
                if ('update' in interaction) {
                    return await interaction.update({ content, ...options });
                }
            } catch (error) {
                if (error instanceof DiscordAPIError) {
                    // Handle specific Discord API errors
                    if (error.code === 50013) { // Missing Permissions
                        console.error('Bot missing permissions for interaction update:', error.message);
                    } else if (error.code === 50001) { // Missing Access
                        console.error('Bot missing access for interaction update:', error.message);
                    } else if (error.code === 10062) { // Unknown Interaction
                        console.error('Unknown interaction (likely expired) for update:', error.message);
                    } else {
                        console.error('Discord API error in interaction update:', error.code, error.message);
                    }
                } else {
                    console.error('Failed to update interaction:', error);
                }
            }
        };

        if (interaction.isChatInputCommand()) {
            // Basic per-user throttle for slash commands to avoid accidental double submits
            const userSlashCooldownMs = 750;
            const now = Date.now();
            (global as any).__slashCooldowns ??= new Map<string, number>();
            const slashCooldowns = (global as any).__slashCooldowns as Map<string, number>;
            const prevSlash = slashCooldowns.get(interaction.user.id) ?? 0;
            if (now - prevSlash < userSlashCooldownMs) {
                // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                return safeReply('You\'re sending commands too quickly. Please wait a moment.', { flags: MessageFlags.Ephemeral });
            }
            slashCooldowns.set(interaction.user.id, now);

            // Global throttle for slash commands
            (global as any).__slashGlobalWindow ??= { windowStart: 0, count: 0 } as { windowStart: number; count: number };
            const sg = (global as any).__slashGlobalWindow as { windowStart: number; count: number };
            if (now - sg.windowStart > GLOBAL_BTN_WINDOW_MS) { // reuse same window size
                sg.windowStart = now;
                sg.count = 0;
            }
            sg.count += 1;
            if (sg.count > Math.max(10, Math.floor(GLOBAL_BTN_MAX_PER_WINDOW / 2))) { // stricter for slash
                // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                return safeReply('High command activity right now. Please try again shortly.', { flags: MessageFlags.Ephemeral });
            }
            // Always allow /start and /stop
            if (interaction.commandName === 'start' || interaction.commandName === 'stop') {
                await handleSlash(interaction, runtime);
                scheduleRefresh(client);
                return;
            }
            // /runblocks is a management command that should work when active
            if (interaction.commandName === 'runblocks') {
                // Only allow admins
                if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
                    // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                    return safeReply('You do not have permission to use this command.', { flags: MessageFlags.Ephemeral });
                }
                const blocks = interaction.options.getInteger('blocks', true);
                const roleId = interaction.options.getString('role');
                const channelId = interaction.options.getString('channel');
                if (blocks <= 0) {
                    // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                    return safeReply('Blocks must be greater than 0.', { flags: MessageFlags.Ephemeral });
                }
                runtime.autorunRemainingBlocks = blocks;
                if (roleId) runtime.notifyRoleId = roleId;
                if (channelId) runtime.notifyChannelId = channelId;
                // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                await safeReply(`Autorun started for ${blocks} block(s). Notifications: ${roleId ? `<@&${roleId}>` : 'unchanged'} in ${channelId ? `<#${channelId}>` : 'unchanged or unset'}.`, { flags: MessageFlags.Ephemeral });
                scheduleRefresh(client);
                return;
            }
            // Only allow other commands if active
            if (!runtime.isActive) {
                // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                return safeReply('Bot is currently stopped. Use /start to enable it again.', { flags: MessageFlags.Ephemeral });
            }
            if (interaction.commandName === 'post') {
                if (!interaction.channel || !interaction.channel.isTextBased()) return;
                await postPanel(interaction.channel as TextChannel);
                await handleSlash(interaction, runtime); // reply handled in commands.ts
                scheduleRefresh(client);
                return;
            }
            if (interaction.commandName === 'refresh') {
                // Refresh the existing panel if it exists
                if (panelChannelId && panelMessageId) {
                    await refreshPanel(client);
                    // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                    await safeReply('Mining bot UI panel has been refreshed.', { flags: MessageFlags.Ephemeral });
                } else {
                    // No existing panel, post a new one
                    if (!interaction.channel || !interaction.channel.isTextBased()) return;
                    await postPanel(interaction.channel as TextChannel);
                    // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                    await safeReply('Mining bot UI panel has been posted.', { flags: MessageFlags.Ephemeral });
                }
                return;
            }
            if (interaction.commandName === 'start') {
                if (!interaction.channel || !interaction.channel.isTextBased()) return;
                await postPanel(interaction.channel as TextChannel);
                // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                return safeReply('Panel posted.', { flags: MessageFlags.Ephemeral });
            }
            if (interaction.commandName === 'grumble') {
                // Only allow admins
                if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
                    return safeReply('You do not have permission to use this command.', { flags: MessageFlags.Ephemeral });
                }
                // Start a new grumble game (reset state)
                if (isGrumbleActive(runtime)) {
                    return safeReply('A grumble is already active. Use /grumble_restart to restart it.', { flags: MessageFlags.Ephemeral });
                }
                const newGrumbleState = {
                    prizePool: 0,
                    bets: {}, // userId: { amount, guess }
                    messageId: null,
                    channelId: interaction.channelId,
                    blockNumber: runtime.state.data.currentBlock,
                    isActive: true,
                };
                await saveGrumbleState(runtime, newGrumbleState);
                // Post the grumble panel in the channel
                if (!interaction.channel || !interaction.channel.isTextBased()) return;
                const grumble = getGrumbleState(runtime);
                if (!grumble) {
                    return safeReply('Error: Failed to create grumble state.', { flags: MessageFlags.Ephemeral });
                }
                try {
                    const { embed, rows } = buildGrumblePanel(grumble.prizePool, false, runtime);
                    const message = await (interaction.channel as TextChannel).send({ embeds: [embed], components: rows });
                    // Update grumble state with message info
                    const updatedGrumbleState: GrumbleState = {
                        prizePool: grumble.prizePool,
                        bets: grumble.bets,
                        messageId: message.id,
                        channelId: message.channel.id,
                        blockNumber: grumble.blockNumber,
                        isActive: grumble.isActive,
                    };
                    await saveGrumbleState(runtime, updatedGrumbleState);
                    // Reply to the user that grumble was started
                    await safeReply('Grumble started! The grumble panel has been posted.', { flags: MessageFlags.Ephemeral });
                } catch (error) {
                    if (error instanceof DiscordAPIError) {
                        if (error.code === 50013) { // Missing Permissions
                            console.error('Bot missing permissions to send grumble panel:', error.message);
                            return safeReply('Error: Bot missing permissions to post grumble panel in this channel.', { flags: MessageFlags.Ephemeral });
                        } else if (error.code === 50001) { // Missing Access
                            console.error('Bot missing access to send grumble panel:', error.message);
                            return safeReply('Error: Bot cannot access this channel to post grumble panel.', { flags: MessageFlags.Ephemeral });
                        } else {
                            console.error('Discord API error sending grumble panel:', error.code, error.message);
                            return safeReply('Error posting grumble panel. Please try again.', { flags: MessageFlags.Ephemeral });
                        }
                    } else {
                        console.error('Failed to send grumble panel:', error);
                        return safeReply('Error posting grumble panel. Please try again.', { flags: MessageFlags.Ephemeral });
                    }
                }
                return;
            }
            if (interaction.commandName === 'grumble_restart') {
                // Only allow admins
                if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
                    return safeReply('You do not have permission to use this command.', { flags: MessageFlags.Ephemeral });
                }
                // Restart the current grumble game (preserve participant history)
                if (!isGrumbleActive(runtime)) {
                    return safeReply('No active grumble to restart.', { flags: MessageFlags.Ephemeral });
                }
                
                const grumble = getGrumbleState(runtime);
                if (!grumble) {
                    return safeReply('Error: No grumble state found.', { flags: MessageFlags.Ephemeral });
                }
                // Preserve the existing bets and prize pool, but update the block number
                const updatedGrumbleState: GrumbleState = {
                    prizePool: grumble.prizePool,
                    bets: grumble.bets,
                    messageId: grumble.messageId,
                    channelId: grumble.channelId,
                    blockNumber: runtime.state.data.currentBlock,
                    isActive: grumble.isActive,
                };
                await saveGrumbleState(runtime, updatedGrumbleState);
                
                // Update the grumble panel to show the new timing
                try {
                    if (grumble.channelId && grumble.messageId) {
                        const channel = await client.channels.fetch(grumble.channelId);
                        if (channel && channel.isTextBased()) {
                            const grumbleMsg = await (channel as TextChannel).messages.fetch(grumble.messageId);
                            const { embed, rows } = buildGrumblePanel(grumble.prizePool, false, runtime);
                            await grumbleMsg.edit({ embeds: [embed], components: rows });
                            await safeReply('Grumble restarted! The grumble will now end at the next block. Participant history preserved.', { flags: MessageFlags.Ephemeral });
                        }
                    }
                } catch (error) {
                    console.error('Error updating grumble panel during restart:', error);
                    await safeReply('Grumble restarted but failed to update panel. Participant history preserved.', { flags: MessageFlags.Ephemeral });
                }
                return;
            }
            if (interaction.commandName === 'grumblepanel') {
                // Only allow admins
                if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
                    return safeReply('You do not have permission to use this command.', { flags: MessageFlags.Ephemeral });
                }
                // Repost the grumble panel if there's an active grumble
                if (!isGrumbleActive(runtime)) {
                    return safeReply('No active grumble to repost panel for.', { flags: MessageFlags.Ephemeral });
                }
                
                const grumble = getGrumbleState(runtime);
                if (!grumble) {
                    return safeReply('Error: No grumble state found.', { flags: MessageFlags.Ephemeral });
                }
                
                // Post the grumble panel in the channel
                if (!interaction.channel || !interaction.channel.isTextBased()) return;
                try {
                    const { embed, rows } = buildGrumblePanel(grumble.prizePool, false, runtime);
                    const message = await (interaction.channel as TextChannel).send({ embeds: [embed], components: rows });
                    // Update grumble state with new message info
                    const updatedGrumbleState: GrumbleState = {
                        prizePool: grumble.prizePool,
                        bets: grumble.bets,
                        messageId: message.id,
                        channelId: message.channel.id,
                        blockNumber: grumble.blockNumber,
                        isActive: grumble.isActive,
                    };
                    await saveGrumbleState(runtime, updatedGrumbleState);
                    // Reply to the user that grumble panel was reposted
                    await safeReply('Grumble panel reposted successfully.', { flags: MessageFlags.Ephemeral });
                } catch (error) {
                    if (error instanceof DiscordAPIError) {
                        if (error.code === 50013) { // Missing Permissions
                            console.error('Bot missing permissions to send grumble panel:', error.message);
                            return safeReply('Error: Bot missing permissions to post grumble panel in this channel.', { flags: MessageFlags.Ephemeral });
                        } else if (error.code === 50001) { // Missing Access
                            console.error('Bot missing access to send grumble panel:', error.message);
                            return safeReply('Error: Bot cannot access this channel to post grumble panel.', { flags: MessageFlags.Ephemeral });
                        } else {
                            console.error('Discord API error sending grumble panel:', error.code, error.message);
                            return safeReply('Error posting grumble panel. Please try again.', { flags: MessageFlags.Ephemeral });
                        }
                    } else {
                        console.error('Failed to send grumble panel:', error);
                        return safeReply('Error posting grumble panel. Please try again.', { flags: MessageFlags.Ephemeral });
                    }
                }
                return;
            }
            if (interaction.commandName === 'grumbletimer') {
                // Only allow admins
                if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
                    return safeReply('You do not have permission to use this command.', { flags: MessageFlags.Ephemeral });
                }
                
                const seconds = interaction.options.getInteger('seconds', true);
                
                if (seconds < 0) {
                    return safeReply('Timer must be 0 or greater. Use 0 to disable custom timer.', { flags: MessageFlags.Ephemeral });
                }
                
                // Check if there's an active grumble
                if (!isGrumbleActive(runtime)) {
                    return safeReply('No active grumble to set timer for.', { flags: MessageFlags.Ephemeral });
                }
                
                const grumble = getGrumbleState(runtime);
                if (!grumble) {
                    return safeReply('Error: No grumble state found.', { flags: MessageFlags.Ephemeral });
                }
                
                // Update grumble state with timer settings
                const updatedGrumbleState: GrumbleState = {
                    ...grumble,
                    ...(seconds === 0 ? {} : {
                        customTimerSec: seconds,
                        customTimerEndsAt: Date.now() + (seconds * 1000)
                    })
                };
                await saveGrumbleState(runtime, updatedGrumbleState);
                
                // Start the grumble timer if custom timer is set
                if (seconds > 0) {
                    await startGrumbleTimer(client);
                }
                
                // Update the grumble panel to show the new timer
                try {
                    if (grumble.channelId && grumble.messageId) {
                        const channel = await client.channels.fetch(grumble.channelId);
                        if (channel && channel.isTextBased()) {
                            const grumbleMsg = await (channel as TextChannel).messages.fetch(grumble.messageId);
                            const { embed, rows } = buildGrumblePanel(grumble.prizePool, false, runtime);
                            await grumbleMsg.edit({ embeds: [embed], components: rows });
                        }
                    }
                } catch (error) {
                    console.error('Error updating grumble panel after timer change:', error);
                }
                
                if (seconds === 0) {
                    await safeReply('Custom grumble timer disabled. Grumble will now follow block timing.', { flags: MessageFlags.Ephemeral });
                } else {
                    await safeReply(`Grumble timer set to ${seconds} seconds. Grumble will end in ${seconds} seconds regardless of blocks.`, { flags: MessageFlags.Ephemeral });
                }
                return;
            }
            if (interaction.commandName === 'setglyphs') {
                // Only allow admins
                if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
                    return safeReply('You do not have permission to use this command.', { flags: MessageFlags.Ephemeral });
                }
                
                const targetUser = interaction.options.getUser('user', true);
                const amount = interaction.options.getInteger('amount', true);
                
                if (amount <= 0) {
                    return safeReply('Amount must be greater than 0.', { flags: MessageFlags.Ephemeral });
                }
                
                try {
                    const newBalance = await setUserGlyphs(runtime, targetUser.id, amount);
                    await safeReply(`Set ${targetUser.username}'s balance to ${newBalance.toLocaleString()} GLYPHS.`, { flags: MessageFlags.Ephemeral });
                } catch (error) {
                    console.error('Error setting user glyphs:', error);
                    await safeReply('Error updating user balance. Please try again.', { flags: MessageFlags.Ephemeral });
                }
                return;
            }
            await handleSlash(interaction, runtime);
            scheduleRefresh(client);
            return;
        }

        if (interaction.isButton()) {
            // Per-user cooldown to reduce spam clicking
            const userCooldownMs = 750;
            const now = Date.now();
            (global as any).__btnCooldowns ??= new Map<string, number>();
            const cooldowns = (global as any).__btnCooldowns as Map<string, number>;
            const prev = cooldowns.get(interaction.user.id) ?? 0;
            if (now - prev < userCooldownMs) {
                if (!interaction.replied && !interaction.deferred) {
                    return safeReply('You\'re doing that too fast. Please wait a moment.', { flags: MessageFlags.Ephemeral });
                }
                return;
            }
            cooldowns.set(interaction.user.id, now);

            // Global rate limit: shed excess load if too many interactions arrive at once
            const g = (global as any).__btnGlobalWindow as { windowStart: number; count: number };
            if (now - g.windowStart > GLOBAL_BTN_WINDOW_MS) {
                g.windowStart = now;
                g.count = 0;
            }
            g.count += 1;
            if (g.count > GLOBAL_BTN_MAX_PER_WINDOW) {
                // Politely inform the user; ephemeral to avoid extra channel noise
                if (!interaction.replied && !interaction.deferred) {
                    return safeReply('The bot is busy right now due to high activity. Please try again in a moment.', { flags: MessageFlags.Ephemeral });
                }
                return;
            }
            // Handle the 'mine' button
            if (interaction.customId === 'mine') {
                const selected = runtime.currentChoices[interaction.user.id] as SymbolRune | undefined;
                const buttonRows = buildChoiceMenu(selected);
                // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                return safeReply('Pick your rune:', { components: buttonRows, flags: MessageFlags.Ephemeral });
            }
            // Handle the 'balance' button
            if (interaction.customId === 'balance') {
                const bal = getBalance(runtime, interaction.user.id);
                // Prefill an X (Twitter) intent URL with the user's balance and a mention to @glyphsrunes
                const tweetText = `GLYPHS Balance = ${bal.toLocaleString()} GLYPHS\nCome Mining in @glyphsrunes`;
                const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;
                const shareBtn = new ButtonBuilder().setLabel('Share on X').setStyle(ButtonStyle.Link).setURL(tweetUrl);
                const row = new ActionRowBuilder<ButtonBuilder>().addComponents(shareBtn);
                // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                return safeReply(`Your balance: ${bal.toLocaleString()} GLYPHS`, { components: [row], flags: MessageFlags.Ephemeral });
            }
            // Handle the 'checkbet' button
            if (interaction.customId === 'checkbet') {
                const betInfo = getUserBetInfo(runtime, interaction.user.id);
                // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                return safeReply(betInfo, { flags: MessageFlags.Ephemeral });
            }
            // Handle the 'lastreward' button
            if (interaction.customId === 'lastreward') {
                const lastBlockInfo = getLastBlockRewardInfo(runtime);
                // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                return safeReply(lastBlockInfo, { flags: MessageFlags.Ephemeral });
            }
            // Handle the 'rewardrecords' button
            if (interaction.customId === 'rewardrecords') {
                const userRecords = getUserRewardRecords(runtime, interaction.user.id);
                // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                return safeReply(userRecords, { flags: MessageFlags.Ephemeral });
            }
            // Handle the 'leaderboard' button
            if (interaction.customId === 'leaderboard') {
                try {
                    // Under high load, avoid repeated expensive leaderboard recomputation
                    if (isHighLoad && cachedLeaderboardForButton) {
                        // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                        return safeReply(cachedLeaderboardForButton.content, { flags: MessageFlags.Ephemeral });
                    }
                    // Serve cached leaderboard if fresh to reduce repeated work under spam
                    if (cachedLeaderboardForButton && cachedLeaderboardForButton.expiresAt > Date.now()) {
                        // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                        return safeReply(cachedLeaderboardForButton.content, { flags: MessageFlags.Ephemeral });
                    }
                    const leaderboard = await getLeaderboard(runtime, interaction);
                    cachedLeaderboardForButton = { content: leaderboard, expiresAt: Date.now() + 5000 }; // 5s cache
                    // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                    return safeReply(leaderboard, { flags: MessageFlags.Ephemeral });
                } catch (error) {
                    if (error instanceof DiscordAPIError) {
                        console.error('Discord API error in leaderboard interaction:', error.code, error.message);
                    } else {
                        console.error('Error handling leaderboard interaction:', error);
                    }
                    if (!interaction.replied && !interaction.deferred) {
                        // Changed from 'ephemeral: true' to 'flags: MessageFlags.Ephemeral' due to Discord.js deprecation
                        return safeReply('Error generating leaderboard. Please try again.', { flags: MessageFlags.Ephemeral });
                    }
                }
            }
            // Handle rune selection buttons
            if (interaction.customId.startsWith('rune_')) {
                const choice = interaction.customId.replace('rune_', '') as SymbolRune;
                if (!SYMBOLS.includes(choice)) return safeReply('Invalid choice.', { flags: MessageFlags.Ephemeral });
                await recordChoice(runtime, interaction.user.id, choice);
                const buttonRows = buildChoiceMenu(choice);
                await safeUpdate(`You chose ${choice}. You can change it until the block ends.`, { components: buttonRows });
                scheduleRefresh(client);
                return;
            }
            // Handle the 'grumble_join' button
            if (interaction.customId === 'grumble_join') {
                const grumble = getGrumbleState(runtime);
                if (!grumble || !grumble.isActive) return safeReply('No active grumble.', { flags: MessageFlags.Ephemeral });
                
                if (grumble.bets[interaction.user.id]) {
                    // User already joined - show their current bet info
                    const userBet = grumble.bets[interaction.user.id];
                    if (userBet) {
                        return safeReply(`**Your Current Grumble Bet:**\n\n💰 **Amount:** ${userBet.amount.toLocaleString()} GLYPHS\n🎯 **Rune Guess:** ${userBet.guess}\n\nYou cannot change your bet once placed.`, { flags: MessageFlags.Ephemeral });
                    }
                } else {
                    // User hasn't joined yet - show rune selection menu
                    const { embed, rows } = buildGrumbleRuneSelection();
                    await safeReply('Choose your rune for the grumble:', { embeds: [embed], components: rows, flags: MessageFlags.Ephemeral });
                }
                return;
            }
            // Handle grumble rune selection
            if (interaction.customId.startsWith('grumble_rune_')) {
                const grumble = getGrumbleState(runtime);
                if (!grumble || !grumble.isActive) return safeReply('No active grumble.', { flags: MessageFlags.Ephemeral });
                if (grumble.bets[interaction.user.id]) {
                    return safeReply('You already joined the grumble.', { flags: MessageFlags.Ephemeral });
                }
                
                const selectedRune = interaction.customId.replace('grumble_rune_', '');
                if (!SYMBOLS.includes(selectedRune)) {
                    return safeReply('Invalid rune selection.', { flags: MessageFlags.Ephemeral });
                }
                
                // Store the selected rune temporarily with timestamp
                (global as any).__grumbleTempSelections ??= {};
                (global as any).__grumbleTempSelections[interaction.user.id] = { 
                    rune: selectedRune, 
                    timestamp: Date.now() 
                };
                
                // Show amount input
                const { embed, rows } = buildGrumbleAmountInput(selectedRune, getBalance(runtime, interaction.user.id));
                await safeReply('Choose your bet amount:', { embeds: [embed], components: rows, flags: MessageFlags.Ephemeral });
                return;
            }
            // Handle grumble amount selection
            if (interaction.customId.startsWith('grumble_amount_')) {
                const grumble = getGrumbleState(runtime);
                if (!grumble || !grumble.isActive) return safeReply('No active grumble.', { flags: MessageFlags.Ephemeral });
                if (grumble.bets[interaction.user.id]) {
                    return safeReply('You already joined the grumble.', { flags: MessageFlags.Ephemeral });
                }
                
                const tempSelections = (global as any).__grumbleTempSelections;
                if (!tempSelections || !tempSelections[interaction.user.id]) {
                    return safeReply('Please select a rune first.', { flags: MessageFlags.Ephemeral });
                }
                
                const amountStr = interaction.customId.replace('grumble_amount_', '');
                const amount = parseInt(amountStr, 10);
                if (!amount || amount <= 0) {
                    return safeReply('Invalid amount.', { flags: MessageFlags.Ephemeral });
                }
                
                const userBalance = getBalance(runtime, interaction.user.id);
                if (amount > userBalance) {
                    return safeReply(`You don't have enough glyphs. Your balance: ${userBalance.toLocaleString()} GLYPHS`, { flags: MessageFlags.Ephemeral });
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
                await saveGrumbleState(runtime, updatedGrumbleState);
                
                // Clean up temp selection
                delete tempSelections[interaction.user.id];
                
                // Update grumble panel
                if (grumble.channelId && grumble.messageId) {
                    const channel = await client.channels.fetch(grumble.channelId);
                    if (channel && channel.isTextBased()) {
                        const grumbleMsg = await (channel as TextChannel).messages.fetch(grumble.messageId);
                        const { embed, rows } = buildGrumblePanel(updatedGrumbleState.prizePool, true, runtime);
                        await grumbleMsg.edit({ embeds: [embed], components: rows });
                    }
                }
                
                await safeReply(`You joined the grumble with ${amount.toLocaleString()} GLYPHS and guessed ${selectedRune}. Good luck! Your new balance: ${(userBalance - amount).toLocaleString()} GLYPHS`, { flags: MessageFlags.Ephemeral });
                return;
            }
        }

        // Future-proof: apply similar throttles to select menus if added later
        if (interaction.isStringSelectMenu && interaction.isStringSelectMenu()) {
            const userSelectCooldownMs = 750;
            const now = Date.now();
            (global as any).__selectCooldowns ??= new Map<string, number>();
            const selectCooldowns = (global as any).__selectCooldowns as Map<string, number>;
            const prevSel = selectCooldowns.get(interaction.user.id) ?? 0;
            if (now - prevSel < userSelectCooldownMs) {
                if (!interaction.replied && !interaction.deferred) {
                    return safeReply('You\'re doing that too fast. Please wait a moment.', { flags: MessageFlags.Ephemeral });
                }
                return;
            }
            selectCooldowns.set(interaction.user.id, now);

            const g = (global as any).__btnGlobalWindow as { windowStart: number; count: number };
            if (now - g.windowStart > GLOBAL_BTN_WINDOW_MS) {
                g.windowStart = now;
                g.count = 0;
            }
            g.count += 1;
            if (g.count > GLOBAL_BTN_MAX_PER_WINDOW) {
                if (!interaction.replied && !interaction.deferred) {
                    return safeReply('The bot is busy right now due to high activity. Please try again in a moment.', { flags: MessageFlags.Ephemeral });
                }
                return;
            }
        }
    });

    // Start health check server for Railway
    const app = express();
    const port = process.env.PORT || 3000;
    
    app.get('/health', (req, res) => {
        res.status(200).json({ 
            status: 'healthy', 
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: process.memoryUsage()
        });
    });
    
    app.get('/', (req, res) => {
        res.status(200).json({ 
            message: 'Glyphs Bot 1 is running',
            status: 'online'
        });
    });
    
    app.listen(port, () => {
        console.log(`🏥 Health check server running on port ${port}`);
    });

    await client.login(process.env.DISCORD_TOKEN!);
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

