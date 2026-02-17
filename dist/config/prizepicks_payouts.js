"use strict";
// src/config/prizepicks_payouts.ts
// Single source of truth for PrizePicks payout structures
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRIZEPICKS_PAYOUTS = void 0;
exports.getPayoutsAsRecord = getPayoutsAsRecord;
exports.getMaxPayoutMultiplier = getMaxPayoutMultiplier;
exports.isPowerStructure = isPowerStructure;
exports.getSupportedStructures = getSupportedStructures;
// PrizePicks payout structures (official as of Feb 2026)
exports.PRIZEPICKS_PAYOUTS = {
    // Power plays (all-or-nothing)
    '2P': [{ hits: 2, multiplier: 3 }],
    '3P': [{ hits: 3, multiplier: 6 }],
    '4P': [{ hits: 4, multiplier: 10 }],
    '5P': [{ hits: 5, multiplier: 20 }],
    '6P': [{ hits: 6, multiplier: 37.5 }],
    // Flex plays (tiered payouts)
    '3F': [
        { hits: 3, multiplier: 3 }, // 3× entry fee
        { hits: 2, multiplier: 1 }, // 1× entry fee (break even)
    ],
    '4F': [
        { hits: 4, multiplier: 6 }, // 6× entry fee
        { hits: 3, multiplier: 1.5 }, // 1.5× entry fee
    ],
    '5F': [
        { hits: 5, multiplier: 10 }, // 10× entry fee
        { hits: 4, multiplier: 2 }, // 2× entry fee
        { hits: 3, multiplier: 0.4 }, // 0.4× entry fee
    ],
    '6F': [
        { hits: 6, multiplier: 25 }, // 25× entry fee
        { hits: 5, multiplier: 2 }, // 2× entry fee
        { hits: 4, multiplier: 0.4 }, // 0.4× entry fee
    ],
};
// Helper: Convert to simple record for engine calculations
function getPayoutsAsRecord(flexType) {
    const payouts = exports.PRIZEPICKS_PAYOUTS[flexType] || [];
    const record = {};
    for (const p of payouts) {
        record[p.hits] = p.multiplier;
    }
    return record;
}
// Helper: Get max payout multiplier for a structure
function getMaxPayoutMultiplier(flexType) {
    const payouts = exports.PRIZEPICKS_PAYOUTS[flexType] || [];
    if (payouts.length === 0)
        return 0;
    return Math.max(...payouts.map(p => p.multiplier));
}
// Helper: Check if structure is Power vs Flex
function isPowerStructure(flexType) {
    return flexType.includes('P');
}
// Helper: Get all supported structure types
function getSupportedStructures() {
    return Object.keys(exports.PRIZEPICKS_PAYOUTS);
}
