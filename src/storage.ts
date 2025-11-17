import * as fs from 'fs';
import * as path from 'path';

export type BalanceMap = Record<string, number>;

export interface MemberResult {
    userId: string;
    choice: string;
    reward: number;
    distance: number;
}

export interface GrumbleState {
    prizePool: number;
    bets: Record<string, { amount: number; guess: string }>;
    messageId: string | null;
    channelId: string | null;
    blockNumber: number;
    isActive: boolean;
    // Timer settings for custom grumble timing
    customTimerSec?: number; // Custom timer in seconds (undefined = use block timing)
    customTimerEndsAt?: number; // When custom timer ends (epoch ms)
}

export interface AuctionState {
    id: string; // Unique auction ID
    description: string;
    rolesToTag: string[]; // Array of role IDs
    endTime: number; // epoch ms
    numberOfWinners: number;
    bids: Record<string, number>; // userId -> bid amount in GLYPHS
    messageId: string | null;
    channelId: string | null;
    isActive: boolean;
    ended: boolean;
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
// - grumbleState: GrumbleState | null // NEW: persists grumble game state
export interface PersistedState {
    currentBlock: number;
    totalRewardsPerBlock: number;
    baseReward: number; // Used for per-user reward calculation tiers
    blockDurationSec: number;
    nextBlockAt: number; // epoch ms
    lastBotChoice?: string | undefined;
    blockHistory: BlockHistory[];
    currentChoices: Record<string, string>; // Persist miners' choices
    grumbleState: GrumbleState | null; // Persist grumble game state
    marketPacks: Record<string, number>;
    marketDollars: Record<string, number>;
    totalClaimedDollars: number; // Total dollars claimed by all users
    claimLimit: number; // Configurable claim limit (default: 80)
    claimButtonDisabled: boolean; // Whether claim button is permanently disabled
    auctions: Record<string, AuctionState>; // auctionId -> AuctionState
}

export interface DBSchema {
    state: PersistedState;
    balances: BalanceMap;
}

const dataDir = path.join(process.cwd(), 'data');
const stateFile = path.join(dataDir, 'state.json');
const balancesFile = path.join(dataDir, 'balances.json');

export class StorageManager {
    private stateData: PersistedState;
    private balancesData: BalanceMap;

    constructor() {
        this.ensureDir();
        this.stateData = this.loadState();
        this.balancesData = this.loadBalances();
    }

    private ensureDir(): void {
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
    }

    private loadState(): PersistedState {
        try {
            if (fs.existsSync(stateFile)) {
                const data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
                // Ensure currentChoices exists if loading from old state
                if (!data.currentChoices) data.currentChoices = {};
                if (typeof data.baseReward !== 'number') data.baseReward = 1_000_000;
                // Ensure grumbleState exists if loading from old state
                if (!data.grumbleState) data.grumbleState = null;
                if (!data.marketPacks) data.marketPacks = {};
                if (!data.marketDollars) data.marketDollars = {};
                // Ensure claim tracking fields exist
                if (typeof data.totalClaimedDollars !== 'number') data.totalClaimedDollars = 0;
                if (typeof data.claimLimit !== 'number') data.claimLimit = 80;
                if (typeof data.claimButtonDisabled !== 'boolean') data.claimButtonDisabled = false;
                // Ensure auctions field exists
                if (!data.auctions) data.auctions = {};
                return data;
            }
        } catch (error) {
            console.error('Error loading state:', error);
        }
        
        // Default state
        return {
            currentBlock: 1,
            totalRewardsPerBlock: 700_000,
            baseReward: 1_000_000,
            blockDurationSec: 30,
            nextBlockAt: Date.now() + 30 * 1000,
            blockHistory: [],
            currentChoices: {},
            grumbleState: null,
            marketPacks: {},
            marketDollars: {},
            totalClaimedDollars: 0,
            claimLimit: 80,
            claimButtonDisabled: false,
            auctions: {},
        };
    }

    private loadBalances(): BalanceMap {
        try {
            if (fs.existsSync(balancesFile)) {
                return JSON.parse(fs.readFileSync(balancesFile, 'utf8'));
            }
        } catch (error) {
            console.error('Error loading balances:', error);
        }
        return {};
    }

    getState(): PersistedState {
        return this.stateData;
    }

    getBalances(): BalanceMap {
        return this.balancesData;
    }

    async writeState(): Promise<void> {
        try {
            fs.writeFileSync(stateFile, JSON.stringify(this.stateData, null, 2));
        } catch (error) {
            console.error('Error writing state:', error);
        }
    }

    async writeBalances(): Promise<void> {
        try {
            fs.writeFileSync(balancesFile, JSON.stringify(this.balancesData, null, 2));
        } catch (error) {
            console.error('Error writing balances:', error);
        }
    }
}

// Legacy compatibility functions
export async function openState(): Promise<{ data: PersistedState; write(): Promise<void> }> {
    const storage = new StorageManager();
    return {
        data: storage.getState(),
        write: () => storage.writeState()
    };
}

export async function openBalances(): Promise<{ data: BalanceMap; write(): Promise<void> }> {
    const storage = new StorageManager();
    return {
        data: storage.getBalances(),
        write: () => storage.writeBalances()
    };
}


