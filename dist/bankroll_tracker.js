"use strict";
// src/bankroll_tracker.ts (minimal)
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logBankrollUsage = logBankrollUsage;
exports.logProductionRun = logProductionRun;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
async function logBankrollUsage(bankroll = 10000, oddsProvider = 'unknown', sportsProcessed = []) {
    const now = new Date();
    const isoString = now.toISOString();
    const [date, time] = isoString.split('T');
    const log = {
        date,
        time: time.split('.')[0], // Remove milliseconds
        bankroll,
        oddsProvider,
        sportsProcessed,
        timestamp: isoString
    };
    try {
        await promises_1.default.mkdir('.cache', { recursive: true });
        await promises_1.default.writeFile(path_1.default.join('.cache', 'bankroll.json'), JSON.stringify(log, null, 2));
        console.log(`[Bankroll] Logged usage: ${bankroll} via ${oddsProvider} for [${sportsProcessed.join(',')}]`);
    }
    catch (error) {
        console.error('[Bankroll] Failed to log usage:', error);
    }
}
async function logProductionRun(provider, sports) {
    await logBankrollUsage(10000, provider, sports);
}
