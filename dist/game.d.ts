import { Low } from 'lowdb';
import { BalanceMap, PersistedState, GrumbleState } from './storage';
import { Interaction } from 'discord.js';
export declare const SYMBOLS: readonly string[];
export type SymbolRune = typeof SYMBOLS[number];
export interface PlayerChoiceMap {
    [userId: string]: SymbolRune;
}
export interface GameRuntime {
    state: Low<PersistedState>;
    balances: Low<BalanceMap>;
    currentChoices: PlayerChoiceMap;
    isActive: boolean;
    onBlockAdvance?: (newBlock: number, botChoice: SymbolRune) => void;
    autorunRemainingBlocks?: number | undefined;
    notifyRoleId?: string | undefined;
    notifyChannelId?: string | undefined;
}
export declare function initGame(): Promise<GameRuntime>;
export declare function timeLeftMs(runtime: GameRuntime): number;
export declare function formatDuration(ms: number): string;
export declare function pickRandomSymbol(): SymbolRune;
export declare function symbolDistance(a: SymbolRune, b: SymbolRune): number;
export declare function computeReward(baseReward: number, player: SymbolRune, bot: SymbolRune): number;
export declare function setTotalRewards(runtime: GameRuntime, amount: number): Promise<void>;
export declare function setBaseReward(runtime: GameRuntime, amount: number): Promise<void>;
export declare function setBlockDuration(runtime: GameRuntime, seconds: number): Promise<void>;
export declare function setCurrentBlock(runtime: GameRuntime, block: number): Promise<void>;
export declare function startTicker(runtime: GameRuntime): NodeJS.Timeout;
export declare function recordChoice(runtime: GameRuntime, userId: string, choice: SymbolRune): Promise<void>;
export declare function resolveBlock(runtime: GameRuntime, botChoice: SymbolRune): Promise<void>;
export declare function getBalance(runtime: GameRuntime, userId: string): number;
export declare function resetBalances(runtime: GameRuntime): Promise<void>;
export declare function getLastBlockRewardInfo(runtime: GameRuntime): string;
export declare function getUserRewardRecords(runtime: GameRuntime, userId: string): string;
export declare function getLeaderboard(runtime: GameRuntime, interaction: Interaction): Promise<string>;
export declare function saveGrumbleState(runtime: GameRuntime, grumbleState: GrumbleState | null): Promise<void>;
export declare function getGrumbleState(runtime: GameRuntime): GrumbleState | null;
export declare function clearGrumbleState(runtime: GameRuntime): Promise<void>;
export declare function isGrumbleActive(runtime: GameRuntime): boolean;
export declare function shouldGrumbleEnd(runtime: GameRuntime): boolean;
export declare function getGrumbleTimeLeft(runtime: GameRuntime): number;
export declare function isGrumbleUsingCustomTimer(runtime: GameRuntime): boolean;
export declare function setUserGlyphs(runtime: GameRuntime, userId: string, amount: number): Promise<number>;
export declare function getUserBetInfo(runtime: GameRuntime, userId: string): string;
//# sourceMappingURL=game.d.ts.map