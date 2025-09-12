import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

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

// PersistedState now includes:
// - currentBlock: number
// - totalRewardsPerBlock: number
// - blockDurationSec: number
// - nextBlockAt: number
// - lastBotChoice?: string
// - blockHistory: BlockHistory[]
// - currentChoices: Record<string, string> // NEW: persists miners' choices for the current block
export interface PersistedState {
    currentBlock: number;
    totalRewardsPerBlock: number;
    blockDurationSec: number;
    nextBlockAt: number; // epoch ms
    lastBotChoice?: string | undefined;
    blockHistory: BlockHistory[];
    currentChoices: Record<string, string>; // Persist miners' choices
}

export interface DBSchema {
    state: PersistedState;
    balances: BalanceMap;
}

const dataDir = join(process.cwd(), 'data');
const stateFile = join(dataDir, 'state.json');
const balancesFile = join(dataDir, 'balances.json');

export async function openState(): Promise<Low<PersistedState>> {
    ensureDir();
    const adapter = new JSONFile<PersistedState>(stateFile);
    const db = new Low<PersistedState>(adapter, {
        currentBlock: 1,
        totalRewardsPerBlock: 700_000,
        blockDurationSec: 30,
        nextBlockAt: Date.now() + 30 * 1000,
        blockHistory: [],
        currentChoices: {}, // Default empty
    });
    await db.read();
    // Ensure currentChoices exists if loading from old state
    if (!db.data.currentChoices) db.data.currentChoices = {};
    await db.write();
    return db;
}

export async function openBalances(): Promise<Low<BalanceMap>> {
    ensureDir();
    const adapter = new JSONFile<BalanceMap>(balancesFile);
    const db = new Low<BalanceMap>(adapter, {});
    await db.read();
    await db.write();
    return db;
}

export function ensureDir(): void {
    if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
    }
}


