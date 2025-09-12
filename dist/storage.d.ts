import { Low } from 'lowdb';
export type BalanceMap = Record<string, number>;
export interface MemberResult {
    userId: string;
    choice: string;
    reward: number;
    distance: number;
}
export interface BlockHistory {
    blockNumber: number;
    botChoice: string;
    memberResults: MemberResult[];
    timestamp: number;
}
export interface PersistedState {
    currentBlock: number;
    totalRewardsPerBlock: number;
    blockDurationSec: number;
    nextBlockAt: number;
    lastBotChoice?: string | undefined;
    blockHistory: BlockHistory[];
}
export interface DBSchema {
    state: PersistedState;
    balances: BalanceMap;
}
export declare function openState(): Promise<Low<PersistedState>>;
export declare function openBalances(): Promise<Low<BalanceMap>>;
export declare function ensureDir(): void;
//# sourceMappingURL=storage.d.ts.map