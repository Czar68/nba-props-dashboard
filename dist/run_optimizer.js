"use strict";
// src/run_optimizer.ts
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable no-console */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const fetch_props_1 = require("./fetch_props");
const merge_odds_1 = require("./merge_odds");
const calculate_ev_1 = require("./calculate_ev");
const card_ev_1 = require("./card_ev");
const fantasy_analyzer_1 = require("./fantasy_analyzer");
const cli_args_1 = require("./cli_args");
const engine_interface_1 = require("./engine_interface");
// TEMPORARY: Clear cache to debug EV engine issues
(0, engine_interface_1.resetPerformanceCounters)();
console.log(" Cache cleared - starting fresh");
// --------- Tuning knobs ---------
// Minimum edge per leg (fraction, e.g. 0.02 = +2% edge)
const MIN_EDGE_PER_LEG = 0.015; // Relaxed from 2% to 1.5%
// Minimum leg EV filter (aggressive performance optimization)
const MIN_LEG_EV = 0.020; // Relaxed from 3.0% to 2.0% leg EV minimum
// At most 1 leg per player per card (no duplicate players on a card)
const MAX_LEGS_PER_PLAYER = 1;
// ---- Dynamic Card Build Attempt Scaling ----
// Per-structure target accepted cards for all plays
// Conservative targets reflect that 5F/6F will dominate but leave room for high-edge smaller plays
const FLEX_TARGET_ACCEPTED_CARDS = {
    '2P': 1, // Rare, but accept when it hits
    '3P': 2, // Three-leg power, conservative
    '3F': 2, // Three-leg flex, rare at 5% floor
    '4P': 2, // Four-leg power, selective
    '4F': 3, // Four-leg flex, slightly more feasible
    '5P': 3, // Five-leg power version
    '5F': 8, // Main structure
    '6P': 2, // Six-leg power, rare but possible
    '6F': 6, // Second main structure
    '7P': 0, // Not used by PrizePicks
    '7F': 0, // Not used by PrizePicks
    '8P': 0, // Not used by PrizePicks
    '8F': 0, // Not used by PrizePicks
};
// Base attempts per target accepted card for flex structures
const FLEX_BASE_ATTEMPTS_PER_CARD = 25; // 25 attempts per desired +EV card (tuned for performance)
// Maximum fraction of global attempts per flex structure
const FLEX_MAX_ATTEMPTS_FRACTION_OF_GLOBAL = 0.4; // At most 40% of MAX_CARD_BUILD_TRIES per structure
// Legacy constants for backward compatibility (deprecated)
const BASE_ATTEMPTS_PER_FLEX_CARD = FLEX_BASE_ATTEMPTS_PER_CARD;
const MAX_ATTEMPTS_FLEX_FRACTION = FLEX_MAX_ATTEMPTS_FRACTION_OF_GLOBAL;
// Target number of accepted cards per structure (unified mapping for all structures)
const TARGET_ACCEPTED_CARDS = {
    '2P': FLEX_TARGET_ACCEPTED_CARDS['2P'],
    '3P': FLEX_TARGET_ACCEPTED_CARDS['3P'],
    '3F': FLEX_TARGET_ACCEPTED_CARDS['3F'],
    '4P': FLEX_TARGET_ACCEPTED_CARDS['4P'],
    '4F': FLEX_TARGET_ACCEPTED_CARDS['4F'],
    '5P': FLEX_TARGET_ACCEPTED_CARDS['5P'],
    '5F': FLEX_TARGET_ACCEPTED_CARDS['5F'],
    '6P': FLEX_TARGET_ACCEPTED_CARDS['6P'],
    '6F': FLEX_TARGET_ACCEPTED_CARDS['6F'],
};
// ---- Flex Feasibility Pruning ----
// Enable/disable flex feasibility pruning to reduce wasted EV calls
const ENABLE_FLEX_FEASIBILITY_PRUNING = true;
// Simple upper bound multiplier for converting leg EV to card EV
// This is a conservative overestimate - if this bound fails, the real EV will definitely fail
const LEG_EV_TO_CARD_EV_MULTIPLIER = 1.2; // 120% of average leg EV as upper bound for card EV (was 0.6, too conservative)
/**
 * Precompute feasibility data for the current run
 * @param legs - Filtered viable legs
 * @returns Feasibility data for 5F and 6F structures
 */
function precomputeFlexFeasibilityData(legs) {
    // Sort legs by descending leg EV (best legs first)
    const viableLegs = [...legs].sort((a, b) => b.legEv - a.legEv);
    // Extract just the EV values in descending order for easy access
    const allLegEvsSortedDesc = viableLegs.map(leg => leg.legEv);
    // Precompute maximum possible average leg EV for each structure size
    const maxAvgEvBySize = {};
    // For structure size 5 (5F): top 5 legs average
    if (viableLegs.length >= 5) {
        const top5 = viableLegs.slice(0, 5);
        maxAvgEvBySize[5] = top5.reduce((sum, leg) => sum + leg.legEv, 0) / 5;
    }
    else {
        maxAvgEvBySize[5] = 0;
    }
    // For structure size 6 (6F): top 6 legs average
    if (viableLegs.length >= 6) {
        const top6 = viableLegs.slice(0, 6);
        maxAvgEvBySize[6] = top6.reduce((sum, leg) => sum + leg.legEv, 0) / 6;
    }
    else {
        maxAvgEvBySize[6] = 0;
    }
    console.log(`🔍 Flex feasibility precomputed:`);
    console.log(`   Viable legs: ${viableLegs.length} (best leg EV: ${viableLegs[0]?.legEv.toFixed(3) || 'N/A'})`);
    console.log(`   Max avg leg EV for 5F: ${maxAvgEvBySize[5].toFixed(3)}`);
    console.log(`   Max avg leg EV for 6F: ${maxAvgEvBySize[6].toFixed(3)}`);
    return { viableLegs, allLegEvsSortedDesc, maxAvgEvBySize };
}
/**
 * Check if a partial flex card has any chance of meeting the EV threshold
 * This is a cheap upper bound check - if it fails, the card cannot possibly succeed
 *
 * @param currentLegs - Legs already selected for the card
 * @param structureSize - Total legs needed (5 or 6)
 * @param threshold - Required card EV threshold
 * @param feasibilityData - Precomputed feasibility data
 * @returns true if card might meet threshold, false if definitely below threshold
 */
function checkFlexCardFeasibility(currentLegs, structureSize, threshold, feasibilityData) {
    if (!ENABLE_FLEX_FEASIBILITY_PRUNING) {
        return true; // Pruning disabled - always evaluate
    }
    const { viableLegs } = feasibilityData;
    const currentSize = currentLegs.length;
    // Early exit: not enough legs available
    if (viableLegs.length < structureSize) {
        return false;
    }
    // Calculate current average leg EV
    const currentAvgEv = currentLegs.reduce((sum, leg) => sum + leg.legEv, 0) / currentSize;
    // Determine best possible average leg EV by filling remaining slots with top legs
    const remainingSlots = structureSize - currentSize;
    let bestPossibleAvgEv = currentAvgEv * currentSize; // Start with current total
    // Add best remaining legs (excluding ones already used)
    const usedPlayerIds = new Set(currentLegs.map(leg => leg.player));
    let addedCount = 0;
    for (const leg of viableLegs) {
        if (addedCount >= remainingSlots)
            break;
        if (!usedPlayerIds.has(leg.player)) {
            bestPossibleAvgEv += leg.legEv;
            addedCount++;
        }
    }
    bestPossibleAvgEv /= structureSize; // Convert to average
    // Apply conservative upper bound multiplier
    // This is a generous overestimate - if even this fails, real EV will definitely fail
    const bestPossibleCardEv = bestPossibleAvgEv * LEG_EV_TO_CARD_EV_MULTIPLIER;
    const isFeasible = bestPossibleCardEv >= threshold;
    // Optional: Log pruning decisions for debugging
    if (!isFeasible && currentSize >= 2) {
        console.log(`🚫 Pruned ${structureSize}F card (${currentSize}/${structureSize} legs): best possible EV ${bestPossibleCardEv.toFixed(3)} < threshold ${threshold}`);
    }
    return isFeasible;
}
/**
 * Get best-case EV upper bound for flex structure
 * This helper provides a best-case EV upper bound used only for pruning and does not affect the actual EV calculation.
 *
 * @param params - Configuration for upper bound calculation
 * @returns Upper bound on card EV for pruning decisions
 */
function getBestCaseFlexEvUpperBound(params) {
    const { structureSize, currentLegEvs, allLegEvsSortedDesc, structureThresholdEv } = params;
    const currentSize = currentLegEvs.length;
    const remainingSlots = structureSize - currentSize;
    // If we already have a full card, just use the current average
    if (remainingSlots === 0) {
        const currentAvgEv = currentLegEvs.reduce((sum, ev) => sum + ev, 0) / currentSize;
        return currentAvgEv * LEG_EV_TO_CARD_EV_MULTIPLIER;
    }
    // Create a set of current leg EVs to avoid duplicates
    const currentEvSet = new Set(currentLegEvs);
    // Get the best possible leg EVs by taking top structureSize EVs from all available legs
    // Mix in current legs and fill remaining slots with best available legs
    const bestPossibleLegEvs = [...currentLegEvs];
    // Add best remaining legs (excluding ones already used)
    let addedCount = 0;
    for (const legEv of allLegEvsSortedDesc) {
        if (addedCount >= remainingSlots)
            break;
        if (!currentEvSet.has(legEv)) {
            bestPossibleLegEvs.push(legEv);
            addedCount++;
        }
    }
    // If we couldn't fill all slots, not enough legs available
    if (bestPossibleLegEvs.length < structureSize) {
        return 0; // Cannot possibly meet threshold
    }
    // Take the top structureSize EVs from the combined set
    bestPossibleLegEvs.sort((a, b) => b - a);
    const topLegEvs = bestPossibleLegEvs.slice(0, structureSize);
    // Calculate best possible average leg EV
    const bestPossibleAvgEv = topLegEvs.reduce((sum, ev) => sum + ev, 0) / structureSize;
    // Apply conservative upper bound multiplier
    // This is a generous overestimate - if even this fails, real EV will definitely fail
    const bestPossibleCardEv = bestPossibleAvgEv * LEG_EV_TO_CARD_EV_MULTIPLIER;
    return bestPossibleCardEv;
}
/**
 * Calculate maximum card build attempts for a structure based on viable legs and targets
 *
 * @param params - Configuration for attempt calculation
 * @returns Number of attempts to try (always integer ≥ 0)
 */
function getMaxAttemptsForStructure(params) {
    const { structureSize, viableLegCount, targetAcceptedCards, globalMaxAttempts } = params;
    // Early exit: not enough legs to build structure
    if (viableLegCount < structureSize) {
        return 0;
    }
    // Safe combinatorial ceiling (upper bound without heavy math)
    // C(n, k) = n! / (k! * (n-k)!) - we use a safe upper bound
    let combinatorialCeiling;
    if (viableLegCount <= structureSize + 1) {
        // Small case: exact calculation is safe
        combinatorialCeiling = viableLegCount * (viableLegCount - 1) * (viableLegCount - 2);
    }
    else {
        // Large case: use safe upper bound (n^k / k!)
        const safeUpperBound = Math.pow(viableLegCount, structureSize) / factorial(structureSize);
        combinatorialCeiling = Math.min(safeUpperBound, globalMaxAttempts);
    }
    // Desired attempts based on target cards
    const desiredAttempts = targetAcceptedCards * FLEX_BASE_ATTEMPTS_PER_CARD;
    // Global max per structure (fraction of total budget)
    const globalMaxForStructure = Math.floor(globalMaxAttempts * FLEX_MAX_ATTEMPTS_FRACTION_OF_GLOBAL);
    // Return the minimum of all constraints
    const maxAttempts = Math.min(combinatorialCeiling, desiredAttempts, globalMaxForStructure);
    // Ensure integer and non-negative
    return Math.max(0, Math.floor(maxAttempts));
}
/**
 * Simple factorial helper for small numbers (5 and 6)
 */
function factorial(n) {
    if (n <= 1)
        return 1;
    return n * factorial(n - 1);
}
/**
 * Minimum card EV by slip type (fraction of stake). Used when building and when filtering before write.
 *
 * Data-driven thresholds from scripts/analyze_thresholds.ts (27-leg SGO sample, 2026-02-07):
 *
 *   2P: never +EV (-18% to -5%)     → drop all (threshold 0%)
 *   3P: -15% to +5%, 5.5% are +EV   → floor +3%, keeps 1.4% with avg +4.15%
 *   3F: never +EV with typical edges → drop all (threshold 0%)
 *   4P: always -EV (-27% to -2%)     → drop all (threshold 0%)
 *   4F: -14% to +4%, 2.9% are +EV   → keep +EV only (threshold 0%)
 *   5P: -24% to +10%, 2.3% are +EV  → keep +EV only (threshold 0%)
 *   5F: -14% to +12%, 19.7% are +EV → floor +5%, keeps 1.7% with avg +6.31%
 *   6P: -26% to +11%, 4.0% are +EV  → keep +EV only (threshold 0%)
 *   6F: -19% to +16%, 19.3% are +EV → floor +5%, keeps 2.8% with avg +6.85%
 */
/**
 * Unified 5% EV floor across all structures
 * No exceptions: all structures must earn +5% edge or they don't generate
 * This maintains edge integrity and prevents creep toward marginal 2-3% plays
 * Bankroll discipline: $500-$1K requires consistent 5% minimum edge
 */
function getMinEvForFlexType(flexType) {
    // TEMPORARILY SET TO NEGATIVE FOR TESTING: Allow negative EV cards to test the pipeline
    const GLOBAL_MIN_CARD_EV = -0.05; // Allow down to -5% for testing (was 3.5%)
    return GLOBAL_MIN_CARD_EV;
}
// ---- Timezone helpers (EST/EDT via America/New_York) ----
function toEasternIsoString(date) {
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });
    const parts = formatter
        .formatToParts(date)
        .reduce((acc, p) => {
        if (p.type !== "literal")
            acc[p.type] = p.value;
        return acc;
    }, {});
    const year = parts.year ?? "0000";
    const month = parts.month ?? "01";
    const day = parts.day ?? "01";
    const hour = parts.hour ?? "00";
    const minute = parts.minute ?? "00";
    const second = parts.second ?? "00";
    // Example: 2026-01-26T14:05:30 ET
    return `${year}-${month}-${day}T${hour}:${minute}:${second} ET`;
}
// ---- Correlation helpers for card construction ----
// Correlation caps per card
const MAX_LEGS_PER_TEAM_PER_CARD = 3;
const MAX_LEGS_PER_GAME_PER_CARD = 4;
function getGameKey(leg) {
    const t = leg.team ?? "";
    const o = leg.opponent ?? "";
    return [t, o].sort().join("_vs_");
}
function isCardWithinCorrelationLimits(window) {
    const teamCounts = new Map();
    const gameCounts = new Map();
    for (const leg of window) {
        const team = leg.team ?? "";
        const gameKey = getGameKey(leg);
        if (team) {
            const c = teamCounts.get(team) ?? 0;
            if (c + 1 > MAX_LEGS_PER_TEAM_PER_CARD)
                return false;
            teamCounts.set(team, c + 1);
        }
        if (gameKey) {
            const g = gameCounts.get(gameKey) ?? 0;
            if (g + 1 > MAX_LEGS_PER_GAME_PER_CARD)
                return false;
            gameCounts.set(gameKey, g + 1);
        }
    }
    return true;
}
// Correlation penalty: same player on multiple legs reduces effective EV
const CORRELATION_PENALTY_PER_DUPLICATE = 0.95;
function applyCorrelationPenalty(result) {
    const playerCounts = new Map();
    for (const { pick } of result.legs) {
        playerCounts.set(pick.player, (playerCounts.get(pick.player) ?? 0) + 1);
    }
    let extraLegsFromSamePlayer = 0;
    for (const count of playerCounts.values()) {
        if (count > 1)
            extraLegsFromSamePlayer += count - 1;
    }
    const factor = extraLegsFromSamePlayer === 0
        ? 1
        : Math.pow(CORRELATION_PENALTY_PER_DUPLICATE, extraLegsFromSamePlayer);
    const cardEvAdjusted = result.cardEv * factor;
    const totalReturnAdjusted = (cardEvAdjusted + 1) * result.stake;
    return {
        ...result,
        cardEv: cardEvAdjusted,
        expectedValue: cardEvAdjusted,
        totalReturn: totalReturnAdjusted,
    };
}
// ---- EV-based card construction ----
const MAX_LEGS_POOL = 30; // how many top legs to consider
const MAX_CARD_BUILD_TRIES = 3000; // how many attempts per size
async function buildCardsForSize(legs, size, flexType, feasibilityData) {
    console.log(`  📋 Building ${flexType} cards from ${legs.length} legs...`);
    // Work from the top legs by edge
    const pool = [...legs].sort((a, b) => b.edge - a.edge).slice(0, MAX_LEGS_POOL);
    console.log(`  📊 Using top ${pool.length} legs by edge`);
    // DEBUG: Log leg details
    console.log(`  🔍 [DEBUG] ${flexType} Input Analysis:`);
    console.log(`     Total legs: ${legs.length}`);
    console.log(`     Pool size: ${pool.length}`);
    console.log(`     Structure size: ${size}`);
    console.log(`     Pool leg EV range: ${pool.length > 0 ? `${Math.max(...pool.map(l => l.legEv)).toFixed(3)} - ${Math.min(...pool.map(l => l.legEv)).toFixed(3)}` : 'N/A'}`);
    console.log(`     Pool leg edge range: ${pool.length > 0 ? `${Math.max(...pool.map(l => l.edge)).toFixed(3)} - ${Math.min(...pool.map(l => l.edge)).toFixed(3)}` : 'N/A'}`);
    // Calculate dynamic max attempts for all structures
    let maxAttempts = MAX_CARD_BUILD_TRIES;
    const targetCards = TARGET_ACCEPTED_CARDS[flexType] || 3;
    maxAttempts = getMaxAttemptsForStructure({
        structureSize: size,
        viableLegCount: pool.length,
        targetAcceptedCards: targetCards,
        globalMaxAttempts: MAX_CARD_BUILD_TRIES
    });
    console.log(`  🎯 Dynamic attempts for ${flexType}: ${maxAttempts} (target: ${targetCards} cards, ${pool.length} viable legs)`);
    // DEBUG: Check if attempts allocation is the issue
    if (maxAttempts === 0) {
        console.log(`  🚨 [DEBUG] ${flexType}: CRITICAL - maxAttempts is 0! This explains 0 candidates.`);
        console.log(`     Structure size: ${size}, Pool length: ${pool.length}, Target cards: ${targetCards}`);
        return [];
    }
    const candidates = [];
    // ---- Metrics Tracking ----
    let evCallsMade = 0;
    let cardsAccepted = 0;
    let prunedCandidates = 0; // Track pruned flex candidates
    let successfulCardBuilds = 0; // DEBUG: Track successful card construction
    let failedCardBuilds = 0; // DEBUG: Track failed card construction
    let feasibilityPruned = 0; // DEBUG: Track feasibility pruning
    let evRejected = 0; // DEBUG: Track EV rejections
    const startTime = Date.now();
    console.log(`  🔍 [DEBUG] Starting card building loop for ${flexType}...`);
    for (let t = 0; t < maxAttempts; t += 1) {
        // ABORT: Check if EV engine is degraded and stop building cards
        if ((0, engine_interface_1.isEvEngineDegraded)()) {
            console.log(`🚨 EV engine degraded, aborting card generation for ${flexType} (avoiding thousands of EV=0 evaluations)`);
            break;
        }
        // Progress reporting (adjust frequency based on attempt count)
        const progressInterval = maxAttempts >= 1000 ? 500 : 100;
        if (t % progressInterval === 0 && t > 0) {
            console.log(`  ⏳ ${flexType}: ${t}/${maxAttempts} attempts, ${candidates.length} candidates found`);
            console.log(`     [DEBUG] Card builds: ${successfulCardBuilds} success, ${failedCardBuilds} failed, ${feasibilityPruned} feasibility-pruned, ${evRejected} EV-rejected`);
        }
        // Shuffle pool each attempt so we get diverse card combos, not just top-N every time
        const shuffled = t === 0 ? pool : [...pool].sort(() => Math.random() - 0.5);
        const chosen = [];
        const usedPlayers = new Set();
        // Greedy fill from the top pool; max 1 leg per player (no duplicate legs)
        for (const leg of shuffled) {
            if (chosen.length >= size)
                break;
            if (usedPlayers.has(leg.player))
                continue;
            const prospective = [...chosen, leg];
            if (!isCardWithinCorrelationLimits(prospective))
                continue;
            chosen.push(leg);
            usedPlayers.add(leg.player);
        }
        // DEBUG: Check if card construction failed
        if (chosen.length !== size) {
            failedCardBuilds++;
            if (t < 5) { // Only log first few failures to avoid spam
                console.log(`  🔍 [DEBUG] ${flexType} attempt ${t}: Failed to build card - needed ${size} legs, got ${chosen.length}`);
                console.log(`     Available legs: ${pool.length}, Used players: ${usedPlayers.size}`);
            }
            continue;
        }
        successfulCardBuilds++;
        // Enforce no duplicate players (defensive check)
        const playerIds = chosen.map((p) => p.player);
        if (new Set(playerIds).size !== playerIds.length) {
            console.log(`  🔍 [DEBUG] ${flexType} attempt ${t}: Duplicate player check failed`);
            continue;
        }
        const cardLegs = chosen.map((pick) => ({
            pick,
            side: "over",
        }));
        // Log EV evaluation attempt
        if (t % 10 === 0 || t < 10) { // More frequent logging for debugging
            console.log(`  🔍 ${flexType}: Evaluating card ${t} (avgProb=${chosen.reduce((sum, l) => sum + l.trueProb, 0) / chosen.length})`);
        }
        // ---- Flex Feasibility Pruning ----
        // TEMPORARILY DISABLED: Apply feasibility scoring to all structures uniformly to reduce wasted EV calls
        // This pruning appears to be too aggressive and preventing any cards from being evaluated
        let shouldSkipFeasibilityCheck = false;
        if (feasibilityData && !shouldSkipFeasibilityCheck) {
            const threshold = getMinEvForFlexType(flexType);
            const currentLegEvs = chosen.map(leg => leg.legEv);
            const upperBound = getBestCaseFlexEvUpperBound({
                structureSize: size,
                currentLegEvs,
                allLegEvsSortedDesc: feasibilityData.allLegEvsSortedDesc,
                structureThresholdEv: threshold
            });
            if (upperBound < threshold) {
                prunedCandidates++;
                feasibilityPruned++;
                if (t < 3) { // Log first few feasibility prunes
                    console.log(`  🔍 [DEBUG] ${flexType} attempt ${t}: Feasibility pruned - upperBound=${upperBound.toFixed(4)} < threshold=${threshold}`);
                }
                continue; // Skip this card - cannot possibly meet threshold
            }
        }
        const rawResult = await (0, card_ev_1.evaluateFlexCard)(flexType, cardLegs, 1);
        evCallsMade++; // Track EV engine calls
        // DEBUG: Log EV evaluation results for first few cards
        if (t < 5) {
            console.log(`  🔍 [DEBUG] ${flexType} attempt ${t}: EV evaluation result:`, rawResult ? {
                cardEv: rawResult.cardEv,
                winProbability: rawResult.winProbability
            } : 'null');
        }
        if (!rawResult) {
            evRejected++;
            if (t < 3) { // Log first few EV rejections
                console.log(`  🔍 [DEBUG] ${flexType} attempt ${t}: EV evaluation returned null`);
            }
            continue; // skip this card (not +EV)
        }
        const result = applyCorrelationPenalty(rawResult);
        if (!Number.isFinite(result.cardEv)) {
            if (t < 3) {
                console.log(`  🔍 [DEBUG] ${flexType} attempt ${t}: Invalid EV (${result.cardEv})`);
            }
            continue;
        }
        if (result.cardEv < getMinEvForFlexType(flexType)) {
            if (t < 5) { // Log more EV rejections for debugging
                console.log(`  🔍 [DEBUG] ${flexType} attempt ${t}: EV too low (${result.cardEv.toFixed(4)} < ${getMinEvForFlexType(flexType)})`);
            }
            continue;
        }
        candidates.push(result);
        cardsAccepted++; // Track accepted +EV cards
    }
    console.log(`  📈 ${flexType}: ${candidates.length} raw candidates from ${maxAttempts} attempts`);
    // DEBUG: Summary of what happened
    console.log(`  🔍 [DEBUG] ${flexType} Building Summary:`);
    console.log(`     Total attempts: ${maxAttempts}`);
    console.log(`     Successful card builds: ${successfulCardBuilds}`);
    console.log(`     Failed card builds: ${failedCardBuilds}`);
    console.log(`     Feasibility pruned: ${feasibilityPruned}`);
    console.log(`     EV rejections: ${evRejected}`);
    console.log(`     EV calls made: ${evCallsMade}`);
    console.log(`     Final candidates: ${candidates.length}`);
    if (candidates.length === 0) {
        console.log(`  🚨 [DEBUG] ${flexType}: DIAGNOSIS - 0 candidates!`);
        if (failedCardBuilds === maxAttempts) {
            console.log(`     → ALL attempts failed to build cards (couldn't get ${size} legs)`);
            console.log(`     → Check if pool has enough unique players or correlation limits are too strict`);
        }
        else if (feasibilityPruned > 0) {
            console.log(`     → Feasibility pruning removed ${feasibilityPruned} cards`);
            console.log(`     → Check if feasibility thresholds are too strict`);
        }
        else if (evRejected > 0) {
            console.log(`     → EV evaluation rejected ${evRejected} cards`);
            console.log(`     → Check if EV thresholds are too strict or EV engine has issues`);
        }
        else {
            console.log(`     → Unknown cause - investigate further`);
        }
    }
    // Deduplicate by leg IDs (unordered)
    const bestByKey = new Map();
    for (const c of candidates) {
        const key = c.legs
            .map((l) => l.pick.id)
            .slice()
            .sort()
            .join("|");
        const existing = bestByKey.get(key);
        if (!existing || c.cardEv > existing.cardEv) {
            bestByKey.set(key, c);
        }
    }
    const finalCards = [...bestByKey.values()].sort((a, b) => b.cardEv - a.cardEv);
    // ---- Metrics Logging ----
    const endTime = Date.now();
    const durationMs = endTime - startTime;
    const attemptsUsed = Math.min(maxAttempts, finalCards.length > 0 ? maxAttempts : 0); // Actual attempts made
    // Log detailed metrics for all structures
    console.log(`  📊 ${flexType} Metrics:`);
    console.log(`     Attempts allocated: ${maxAttempts} | Attempts used: ${attemptsUsed} | Duration: ${durationMs}ms`);
    console.log(`     EV engine calls: ${evCallsMade} | Accepted cards: ${cardsAccepted} | Final cards: ${finalCards.length}`);
    console.log(`     Pruned candidates: ${prunedCandidates} | EV call efficiency: ${evCallsMade > 0 ? ((cardsAccepted / evCallsMade) * 100).toFixed(1) : 0}% acceptance rate`);
    // Log the number of +EV cards kept for this structure
    console.log(`  ✅ ${flexType}: kept ${finalCards.length} +EV cards (MIN_CARD_EV=${getMinEvForFlexType(flexType)})`);
    return finalCards;
}
// ---- CSV writers ----
function writeLegsCsv(legs, outPath, runTimestamp) {
    const headers = [
        "Sport",
        "id",
        "player",
        "team",
        "stat",
        "line",
        "league",
        "book",
        "overOdds",
        "underOdds",
        "trueProb",
        "edge",
        "legEv",
        "runTimestamp",
        "gameTime",
        "IsWithin24h",
    ];
    const lines = [];
    lines.push(headers.join(","));
    const runDate = new Date();
    for (const leg of legs) {
        let gameTime = "";
        let isWithin24h = "";
        if (leg.startTime) {
            gameTime = leg.startTime;
            const start = new Date(leg.startTime);
            const diffMs = start.getTime() - runDate.getTime();
            const diffHours = diffMs / (1000 * 60 * 60);
            isWithin24h = diffHours >= 0 && diffHours <= 24 ? "TRUE" : "FALSE";
        }
        const row = [
            leg.sport,
            leg.id,
            leg.player,
            leg.team ?? "",
            leg.stat,
            leg.line,
            leg.league ?? "",
            leg.book ?? "",
            leg.overOdds ?? "",
            leg.underOdds ?? "",
            leg.trueProb,
            leg.edge,
            leg.legEv,
            runTimestamp,
            gameTime,
            isWithin24h,
        ].map((v) => {
            if (v === null || v === undefined)
                return "";
            const s = String(v);
            return s.includes(",") ? s.replace(/,/g, ";") : s;
        });
        lines.push(row.join(","));
    }
    fs_1.default.writeFileSync(outPath, lines.join("\n"), "utf8");
}
function writeCardsCsv(cards, outPath, runTimestamp) {
    const headers = [
        "Sport",
        "site",
        "flexType",
        "cardEv",
        "winProbCash",
        "winProbAny",
        "avgProb",
        "avgEdgePct",
        "leg1Id",
        "leg2Id",
        "leg3Id",
        "leg4Id",
        "leg5Id",
        "leg6Id",
        "runTimestamp",
    ];
    const lines = [];
    lines.push(headers.join(","));
    for (const card of cards) {
        const legIds = card.legs.map((leg) => leg.pick.id);
        // Derive sport from first leg (cards should be single-sport)
        const sport = card.legs.length > 0 ? card.legs[0].pick.sport : "NBA";
        const row = [
            sport,
            "PP",
            card.flexType,
            card.cardEv,
            card.winProbCash,
            card.winProbAny,
            card.avgProb,
            card.avgEdgePct,
            legIds[0] ?? "",
            legIds[1] ?? "",
            legIds[2] ?? "",
            legIds[3] ?? "",
            legIds[4] ?? "",
            legIds[5] ?? "",
            runTimestamp,
        ].map((v) => {
            if (v === null || v === undefined)
                return "";
            const s = String(v);
            return s.includes(",") ? s.replace(/,/g, " ") : s;
        });
        lines.push(row.join(","));
    }
    fs_1.default.writeFileSync(outPath, lines.join("\n"), "utf8");
}
// ---- Card volume diagnostics ----
function logCardVolumeDiagnostics(cards) {
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  CARD VOLUME DIAGNOSTICS");
    console.log("═══════════════════════════════════════════════════════════\n");
    // Group cards by structure type
    const byStructure = new Map();
    for (const card of cards) {
        const existing = byStructure.get(card.flexType) || [];
        byStructure.set(card.flexType, [...existing, card]);
    }
    // Calculate statistics for each structure
    const stats = [];
    for (const [structure, structureCards] of byStructure.entries()) {
        const evs = structureCards.map(c => c.cardEv);
        stats.push({
            structure,
            total: structureCards.length,
            avgEv: evs.reduce((sum, ev) => sum + ev, 0) / evs.length,
            maxEv: Math.max(...evs),
            minEv: Math.min(...evs),
        });
    }
    // Sort by structure type (Power first, then Flex)
    stats.sort((a, b) => {
        const aIsPower = a.structure.includes('P');
        const bIsPower = b.structure.includes('P');
        if (aIsPower !== bIsPower)
            return aIsPower ? -1 : 1;
        return a.structure.localeCompare(b.structure);
    });
    console.log("Structure | Cards | Avg EV | Max EV | Min EV");
    console.log("-----------|--------|--------|--------|--------");
    for (const stat of stats) {
        const avgEv = (stat.avgEv * 100).toFixed(2) + '%';
        const maxEv = (stat.maxEv * 100).toFixed(2) + '%';
        const minEv = (stat.minEv * 100).toFixed(2) + '%';
        console.log(`${stat.structure.padEnd(9)} | ${stat.total.toString().padStart(6)} | ${avgEv.padStart(6)} | ${maxEv.padStart(6)} | ${minEv.padStart(6)}`);
    }
    // Summary insights
    console.log("\n📊 Volume Control Insights:");
    const totalCards = cards.length;
    const powerCards = stats.filter(s => s.structure.includes('P')).reduce((sum, s) => sum + s.total, 0);
    const flexCards = stats.filter(s => s.structure.includes('F')).reduce((sum, s) => sum + s.total, 0);
    console.log(`• Total cards: ${totalCards} (${powerCards} Power, ${flexCards} Flex)`);
    const highEvCards = cards.filter(c => c.cardEv >= 0.05).length;
    console.log(`• High-EV cards (+5%+): ${highEvCards} (${((highEvCards / totalCards) * 100).toFixed(1)}%)`);
    const positiveEvCards = cards.filter(c => c.cardEv > 0).length;
    console.log(`• Positive EV cards: ${positiveEvCards} (${((positiveEvCards / totalCards) * 100).toFixed(1)}%)`);
    console.log("\n💡 Threshold effectiveness:");
    for (const stat of stats) {
        const threshold = getMinEvForFlexType(stat.structure);
        const aboveThreshold = byStructure.get(stat.structure)?.filter(c => c.cardEv >= threshold).length || 0;
        const pct = stat.total > 0 ? ((aboveThreshold / stat.total) * 100).toFixed(1) : '0.0';
        console.log(`• ${stat.structure}: ${aboveThreshold}/${stat.total} (${pct}%) above threshold`);
    }
}
// ---- Main runner ----
async function run() {
    const runTimestamp = toEasternIsoString(new Date());
    // Parse CLI arguments
    const args = (0, cli_args_1.parseArgs)();
    // Show help if requested
    if (args.help) {
        const { showHelp } = await Promise.resolve().then(() => __importStar(require("./cli_args")));
        showHelp();
        return;
    }
    // Reset performance counters for this run
    (0, engine_interface_1.resetPerformanceCounters)();
    const raw = await (0, fetch_props_1.fetchPrizePicksRawProps)(args.sports);
    console.log("Raw PrizePicks props:", raw.length);
    const result = await (0, merge_odds_1.mergeOddsWithPropsWithMetadata)(raw);
    const merged = result.odds;
    console.log("Merged picks:", merged.length);
    // Display odds source information
    if (result.metadata.isFromCache) {
        const fetchedAt = result.metadata.fetchedAt ? new Date(result.metadata.fetchedAt).toLocaleString() : "unknown";
        console.log(`Odds source: cache (from ${result.metadata.originalProvider || "unknown"}, fetched at ${fetchedAt})`);
    }
    else {
        const provider = result.metadata.providerUsed;
        const timestamp = result.metadata.fetchedAt ? new Date(result.metadata.fetchedAt).toLocaleString() : new Date().toLocaleString();
        if (provider === "SGO") {
            console.log(`Odds source: SGO (fresh), fetched at ${timestamp}`);
        }
        else if (provider === "TheRundown") {
            console.log(`Odds source: TheRundown (fresh, SGO skipped/unavailable), fetched at ${timestamp}`);
        }
        else {
            console.log(`Odds source: none (no odds available)`);
        }
    }
    const withEv = await (0, calculate_ev_1.calculateEvForMergedPicks)(merged);
    console.log("Ev picks:", withEv.length);
    console.log("---- EV-based filtering ----");
    // 1) Filter by minimum edge per leg
    const legsAfterEdge = withEv.filter((leg) => leg.edge >= MIN_EDGE_PER_LEG);
    // 2) Filter by minimum leg EV (aggressive performance optimization)
    const legsAfterEvFilter = legsAfterEdge.filter((leg) => leg.legEv >= MIN_LEG_EV);
    console.log(`Legs after edge filter (>= ${MIN_EDGE_PER_LEG}): ${legsAfterEdge.length} of ${withEv.length}`);
    console.log(`Legs after EV filter (>= ${(MIN_LEG_EV * 100).toFixed(1)}%): ${legsAfterEvFilter.length} of ${legsAfterEdge.length}`);
    // 3) Enforce max legs per player global across all cards
    const counts = new Map();
    const filtered = legsAfterEvFilter.filter((leg) => {
        const key = leg.player;
        const count = counts.get(key) ?? 0;
        if (count + 1 > MAX_LEGS_PER_PLAYER)
            return false;
        counts.set(key, count + 1);
        return true;
    });
    console.log(`Legs after player cap (<= ${MAX_LEGS_PER_PLAYER} per player): ${filtered.length} of ${legsAfterEvFilter.length}`);
    // ---- Early exit if too few legs remain ----
    const minLegsNeeded = 6; // Need at least 6 legs for 6-leg structures
    if (filtered.length < minLegsNeeded) {
        console.log(`❌ Too few legs after filtering: ${filtered.length} legs (need at least ${minLegsNeeded})`);
        console.log(`   Consider lowering MIN_LEG_EV from ${(MIN_LEG_EV * 100).toFixed(1)}% or MIN_EDGE_PER_LEG from ${(MIN_EDGE_PER_LEG * 100).toFixed(1)}%`);
        return; // Exit early - cannot build any meaningful structures
    }
    // ---- Persist filtered legs to JSON ----
    // Sort legs by legEv descending for consistent ordering across all outputs
    const sortedLegs = [...filtered].sort((a, b) => {
        // Primary sort: legEv descending
        if (b.legEv !== a.legEv) {
            return b.legEv - a.legEv;
        }
        // Secondary sort: id ascending for deterministic tie-breaking
        return a.id.localeCompare(b.id);
    });
    const legsOutPath = path_1.default.join(process.cwd(), "prizepicks-legs.json");
    fs_1.default.writeFileSync(legsOutPath, JSON.stringify({ runTimestamp, legs: sortedLegs }, null, 2), "utf8");
    console.log(`Wrote ${sortedLegs.length} legs to ${legsOutPath}`);
    // ---- Also write CSV for Google Sheets ----
    const legsCsvPath = path_1.default.join(process.cwd(), "prizepicks-legs.csv");
    writeLegsCsv(sortedLegs, legsCsvPath, runTimestamp);
    console.log(`Wrote ${sortedLegs.length} legs to ${legsCsvPath}`);
    // ---- Log top EV legs for quick sanity check ----
    const topLegs = sortedLegs.slice(0, 10); // Already sorted by legEv descending
    console.log("Top EV legs after filtering:");
    for (const leg of topLegs) {
        console.log(` player=${leg.player}, stat=${leg.stat}, line=${leg.line}, ` +
            `trueProb=${Number.isFinite(leg.trueProb) ? leg.trueProb.toFixed(3) : leg.trueProb}, ` +
            `edge=${Number.isFinite(leg.edge) ? leg.edge.toFixed(3) : leg.edge}, ` +
            `legEv=${Number.isFinite(leg.legEv) ? leg.legEv.toFixed(3) : leg.legEv}, ` +
            `overOdds=${leg.overOdds}, underOdds=${leg.underOdds}, book=${leg.book}, team=${leg.team}, opponent=${leg.opponent}`);
    }
    // ---- Card construction uses filtered legs (EV-based) ----
    // All PrizePicks slip types: 2P-6P (Power), 3F-6F (Flex)
    console.log(`\n🔄 Starting card EV evaluation, total legs=${filtered.length}`);
    const SLIP_BUILD_SPEC = [
        { size: 2, flexType: "2P" },
        { size: 3, flexType: "3P" },
        { size: 4, flexType: "4P" },
        { size: 5, flexType: "5P" },
        { size: 6, flexType: "6P" },
        { size: 3, flexType: "3F" },
        { size: 4, flexType: "4F" },
        { size: 5, flexType: "5F" },
        { size: 6, flexType: "6F" },
    ];
    // ---- PREFILTER: Check which structures can meet thresholds ----
    const maxLegEv = filtered.length > 0 ? Math.max(...filtered.map(l => l.legEv)) : 0;
    console.log(`📊 Max leg EV in this slate: ${maxLegEv >= 0 ? '+' : ''}${(maxLegEv * 100).toFixed(2)}%`);
    // Minimum leg EV requirements relaxed for better slate coverage
    // Per-leg math: 2P needs 2×legEV ≥ 3.5% → legEV ≥ 1.75%, 3P needs 3×legEV ≥ 3.5% → legEV ≥ 1.17%
    // Still maintains quality while allowing more cards on thin slates
    const MIN_LEG_EV_REQUIREMENTS = {
        '2P': 0.020, // +2.0% leg EV needed for 2P cards (down from 3.0%)
        '3P': 0.017, // +1.7% leg EV needed for 3P cards (down from 2.5%)
        '3F': 0.017, // +1.7% leg EV needed for 3F cards (down from 2.5%)
        '4P': 0.015, // +1.5% leg EV needed for 4P cards (down from 2.0%)
        '4F': 0.015, // +1.5% leg EV needed for 4F cards (down from 2.0%)
        '5P': 0.013, // +1.3% leg EV needed for 5P cards (down from 1.8%)
        '5F': 0.013, // +1.3% leg EV needed for 5F cards (down from 1.8%)
        '6P': 0.012, // +1.2% leg EV needed for 6P cards (down from 1.5%)
        '6F': 0.012, // +1.2% leg EV needed for 6F cards (down from 1.5%)
    };
    // TEMPORARILY DISABLED: Filter out structures that cannot meet thresholds
    // This check is too aggressive and preventing any cards from being generated
    const viableStructures = SLIP_BUILD_SPEC.slice(0, 1); // ONLY TEST 2P FOR DEBUGGING
    /*
    const viableStructures = SLIP_BUILD_SPEC; // Allow all structures for now
    const viableStructures = SLIP_BUILD_SPEC.filter(({ flexType }: { flexType: FlexType }) => {
      const requiredLegEv = MIN_LEG_EV_REQUIREMENTS[flexType];
      if (maxLegEv < requiredLegEv) {
        console.log(`⚠️  Skipping structure ${flexType}: max leg EV = ${(maxLegEv * 100).toFixed(2)}% < required ${(requiredLegEv * 100).toFixed(2)}%`);
        return false;
      }
      return true;
    });
    */
    if (viableStructures.length === 0) {
        console.log(`❌ No viable structures for this slate - all structures require higher leg EV than available`);
        console.log(`   Max leg EV: ${(maxLegEv * 100).toFixed(2)}%`);
        console.log(`   Best requirement: ${Math.min(...Object.values(MIN_LEG_EV_REQUIREMENTS)) * 100}%`);
        return; // Exit early - no point generating cards
    }
    console.log(`✅ Viable structures: [${viableStructures.map((s) => s.flexType).join(', ')}]`);
    console.log(`   Skipped structures: [${SLIP_BUILD_SPEC.filter((s) => !viableStructures.includes(s)).map(s => s.flexType).join(', ')}]`);
    const sortedByEdge = [...filtered].sort((a, b) => b.edge - a.edge);
    // ---- Precompute Flex Feasibility Data ----
    // This data is used to prune unlikely flex cards before expensive EV evaluation
    const feasibilityData = precomputeFlexFeasibilityData(filtered);
    const cardsBeforeEvFilter = [];
    for (const { size, flexType } of viableStructures) {
        // ABORT: Check if EV engine is degraded before starting each structure
        if ((0, engine_interface_1.isEvEngineDegraded)()) {
            console.log(`🚨 EV engine degraded, skipping remaining structures (${flexType} and beyond)`);
            break;
        }
        console.log(`🔄 Building cards for ${flexType} (${size}-leg)...`);
        const cards = await buildCardsForSize(sortedByEdge, size, flexType, feasibilityData);
        console.log(`✅ ${flexType}: ${cards.length} +EV cards found`);
        cardsBeforeEvFilter.push(...cards);
    }
    console.log(`Cards before EV filter: ${cardsBeforeEvFilter.length} (from ${filtered.length} legs)`);
    // ---- Apply per-slip-type EV floors and sort cards ----
    // Filter cards using minimum EV thresholds for each slip type
    // This ensures only cards meeting the quality standard for their type are exported
    const filteredCards = cardsBeforeEvFilter.filter((card) => card.cardEv >= getMinEvForFlexType(card.flexType));
    console.log(`Cards after EV filter (per-type min): ${filteredCards.length} of ${cardsBeforeEvFilter.length}`);
    // Sort filtered cards by EV with WinProbCash as secondary tie-breaker
    // Primary: cardEv descending (highest expected profit per unit staked)
    // Secondary: winProbCash descending (higher win probability for equal EV)
    // Tertiary: deterministic ID-based ordering for consistency
    const sortedCards = [...filteredCards].sort((a, b) => {
        // Primary sort: cardEv descending
        if (b.cardEv !== a.cardEv) {
            return b.cardEv - a.cardEv;
        }
        // Secondary sort: winProbCash descending (higher win probability first)
        if (b.winProbCash !== a.winProbCash) {
            return b.winProbCash - a.winProbCash;
        }
        // Tertiary sort: deterministic ordering for consistent results
        // Create a stable key from leg IDs for tie-breaking
        const aKey = a.legs.map(l => l.pick.id).sort().join('|');
        const bKey = b.legs.map(l => l.pick.id).sort().join('|');
        return aKey.localeCompare(bKey);
    });
    // ---- Export filtered and sorted cards ----
    const cardsOutPath = path_1.default.join(process.cwd(), "prizepicks-cards.json");
    fs_1.default.writeFileSync(cardsOutPath, JSON.stringify({ runTimestamp, cards: sortedCards }, null, 2), "utf8");
    console.log(`Wrote ${sortedCards.length} cards to ${cardsOutPath}`);
    // ---- Also write cards CSV for Google Sheets ----
    const cardsCsvPath = path_1.default.join(process.cwd(), "prizepicks-cards.csv");
    writeCardsCsv(sortedCards, cardsCsvPath, runTimestamp);
    console.log(`Wrote ${sortedCards.length} cards to ${cardsCsvPath}`);
    // ---- Finalize any pending EV requests ----
    await (0, engine_interface_1.finalizePendingEVRequests)();
    // ---- Log performance metrics ----
    (0, engine_interface_1.logPerformanceMetrics)();
    // ---- Card volume diagnostics ----
    logCardVolumeDiagnostics(sortedCards);
    // ---- Fantasy analyzer (NBA + NFL fantasy_score props) ----
    const fantasyRows = await (0, fantasy_analyzer_1.runFantasyAnalyzer)();
    console.log("Fantasy analyzer total rows:", fantasyRows.length);
    console.log("Top 25 fantasy edges (implied - line):");
    console.table(fantasyRows.slice(0, 25).map((r) => ({
        league: r.league,
        player: r.player,
        fantasyLine: r.fantasyLine,
        impliedFantasy: Number(r.impliedFantasy.toFixed(2)),
        diff: Number(r.diff.toFixed(2)), // positive = over lean
    })));
}
run().catch((err) => {
    console.error("run_optimizer failed:", err);
    process.exit(1);
});
