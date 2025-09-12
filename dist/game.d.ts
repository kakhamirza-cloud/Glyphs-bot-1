import { Low } from 'lowdb';
import { BalanceMap, PersistedState } from './storage';
export declare const SYMBOLS: readonly string[];
export type SymbolRune = typeof SYMBOLS[number];
export interface PlayerChoiceMap {
    [userId: string]: SymbolRune;
}
export interface GameRuntime {
    state: Low<PersistedState>;
    balances: Low<BalanceMap>;
    currentChoices: PlayerChoiceMap;
    onBlockAdvance?: (newBlock: number, botChoice: SymbolRune) => void;
}
export declare function initGame(): Promise<GameRuntime>;
export declare function timeLeftMs(runtime: GameRuntime): number;
export declare function formatDuration(ms: number): string;
export declare function pickRandomSymbol(): SymbolRune;
export declare function symbolDistance(a: SymbolRune, b: SymbolRune): number;
export declare function computeReward(baseReward: number, player: SymbolRune, bot: SymbolRune): number;
export declare function setTotalRewards(runtime: GameRuntime, amount: number): Promise<void>;
export declare function setBlockDuration(runtime: GameRuntime, seconds: number): Promise<void>;
export declare function setCurrentBlock(runtime: GameRuntime, block: number): Promise<void>;
export declare function startTicker(runtime: GameRuntime): NodeJS.Timeout;
export declare function recordChoice(runtime: GameRuntime, userId: string, choice: SymbolRune): Promise<void>;
export declare function resolveBlock(runtime: GameRuntime, botChoice: SymbolRune): Promise<void>;
export declare function getBalance(runtime: GameRuntime, userId: string): number;
export declare function resetBalances(runtime: GameRuntime): Promise<void>;
export declare function getLastBlockRewardInfo(runtime: GameRuntime): string;
export declare function getUserRewardRecords(runtime: GameRuntime, userId: string): string;
//# sourceMappingURL=game.d.ts.map