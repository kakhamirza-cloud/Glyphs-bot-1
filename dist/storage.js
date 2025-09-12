"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openState = openState;
exports.openBalances = openBalances;
exports.ensureDir = ensureDir;
const lowdb_1 = require("lowdb");
const node_1 = require("lowdb/node");
const node_path_1 = require("node:path");
const node_fs_1 = require("node:fs");
const dataDir = (0, node_path_1.join)(process.cwd(), 'data');
const stateFile = (0, node_path_1.join)(dataDir, 'state.json');
const balancesFile = (0, node_path_1.join)(dataDir, 'balances.json');
async function openState() {
    ensureDir();
    const adapter = new node_1.JSONFile(stateFile);
    const db = new lowdb_1.Low(adapter, {
        currentBlock: 1,
        totalRewardsPerBlock: 700000,
        blockDurationSec: 30,
        nextBlockAt: Date.now() + 30 * 1000,
        blockHistory: [],
    });
    await db.read();
    await db.write();
    return db;
}
async function openBalances() {
    ensureDir();
    const adapter = new node_1.JSONFile(balancesFile);
    const db = new lowdb_1.Low(adapter, {});
    await db.read();
    await db.write();
    return db;
}
function ensureDir() {
    if (!(0, node_fs_1.existsSync)(dataDir)) {
        (0, node_fs_1.mkdirSync)(dataDir, { recursive: true });
    }
}
//# sourceMappingURL=storage.js.map