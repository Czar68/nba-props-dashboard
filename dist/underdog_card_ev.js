"use strict";
// src/underdog_card_ev.ts
//
// Underdog card EV evaluation.  Two modes only — Standard and Flex — matching
// the two modes exposed in the Underdog Pick'em UI.
//
// Standard: all-or-nothing (single payout tier).
// Flex:     tiered payout ladder (1-loss for 3–5 picks, 2-loss for 6–8 picks).
//
// Both functions use the exact non-identical hit distribution (DP), not the
// i.i.d. binomial approximation used by the PrizePicks engine.
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateUdInsuredCard = void 0;
exports.evaluateUdStandardCard = evaluateUdStandardCard;
exports.evaluateUdFlexCard = evaluateUdFlexCard;
const underdog_structures_1 = require("./config/underdog_structures");
const kelly_mean_variance_1 = require("./kelly_mean_variance");
// Simple helper to compute card EV from hit distribution and payout structure
function computeCardEvFromPayouts(hitProbs, // index = hits, value = probability
payouts, // hits -> payout multiple
stake) {
    let expectedReturn = 0;
    hitProbs.forEach((prob, hits) => {
        const multiple = payouts[hits] ?? 0;
        expectedReturn += prob * multiple * stake;
    });
    const expectedValue = (expectedReturn - stake) / stake;
    const winProbability = hitProbs.reduce((acc, prob, hits) => {
        const multiple = payouts[hits] ?? 0;
        return acc + (multiple > 0 ? prob : 0);
    }, 0);
    return { expectedReturn, expectedValue, winProbability };
}
// Compute distribution of hits from independent leg probabilities (DP)
function computeHitDistribution(legs) {
    const n = legs.length;
    const dist = new Array(n + 1).fill(0);
    dist[0] = 1;
    for (const leg of legs) {
        const p = leg.trueProb;
        for (let k = n; k >= 0; k--) {
            const prev = dist[k];
            dist[k] = prev * (1 - p) + (k > 0 ? dist[k - 1] * p : 0);
        }
    }
    return dist;
}
// Underdog Standard (all-or-nothing) evaluation
function evaluateUdStandardCard(legs, overrideStructureId) {
    const size = legs.length;
    const stake = 1;
    const structureId = overrideStructureId ?? (0, underdog_structures_1.getUnderdogStructureId)(size, 'standard');
    if (!structureId) {
        throw new Error(`Unsupported UD standard card size: ${size}`);
    }
    const structure = (0, underdog_structures_1.getUnderdogStructureById)(structureId);
    if (!structure) {
        throw new Error(`Structure not found: ${structureId}`);
    }
    const hitProbs = computeHitDistribution(legs);
    const payouts = structure.payouts;
    const { expectedReturn, expectedValue, winProbability } = computeCardEvFromPayouts(hitProbs, payouts, stake);
    // Convert hit distribution array to record format for Kelly calculation
    const hitDistributionRecord = {};
    hitProbs.forEach((prob, hits) => {
        if (prob > 0)
            hitDistributionRecord[hits] = prob;
    });
    // Compute Kelly sizing using mean-variance approximation
    const kellyResult = (0, kelly_mean_variance_1.computeKellyForCard)(expectedValue, hitDistributionRecord, structure.id.replace('UD_', ''), // Remove 'UD_' prefix for consistency
    'underdog', kelly_mean_variance_1.DEFAULT_KELLY_CONFIG);
    return {
        stake,
        totalReturn: expectedReturn,
        expectedValue,
        winProbability,
        hitDistribution: hitProbs,
        structureId: structure.id,
        structureType: structure.type,
        breakEvenLegWinRate: (0, underdog_structures_1.calculateBreakEvenLegWinRate)(structure),
        kellyResult,
    };
}
// Underdog Flex evaluation (tiered payout ladder — 1-loss or 2-loss)
function evaluateUdFlexCard(legs, overrideStructureId) {
    const size = legs.length;
    const stake = 1;
    // Default to 'flex' type lookup when no override provided
    const structureId = overrideStructureId ?? (0, underdog_structures_1.getUnderdogStructureId)(size, 'flex');
    if (!structureId) {
        throw new Error(`Unsupported UD flex card size: ${size}`);
    }
    const structure = (0, underdog_structures_1.getUnderdogStructureById)(structureId);
    if (!structure) {
        throw new Error(`Structure not found: ${structureId}`);
    }
    // Verify this structure has flex-style payouts (multiple hit levels)
    const hitCount = Object.keys(structure.payouts).length;
    if (hitCount <= 1) {
        throw new Error(`Structure ${structureId} does not have flex-style payouts`);
    }
    const hitProbs = computeHitDistribution(legs);
    const payouts = structure.payouts;
    const { expectedReturn, expectedValue, winProbability } = computeCardEvFromPayouts(hitProbs, payouts, stake);
    // Convert hit distribution array to record format for Kelly calculation
    const hitDistributionRecord = {};
    hitProbs.forEach((prob, hits) => {
        if (prob > 0)
            hitDistributionRecord[hits] = prob;
    });
    // Compute Kelly sizing using mean-variance approximation
    const kellyResult = (0, kelly_mean_variance_1.computeKellyForCard)(expectedValue, hitDistributionRecord, structure.id.replace('UD_', ''), // Remove 'UD_' prefix for consistency
    'underdog', kelly_mean_variance_1.DEFAULT_KELLY_CONFIG);
    return {
        stake,
        totalReturn: expectedReturn,
        expectedValue,
        winProbability,
        hitDistribution: hitProbs,
        structureId: structure.id,
        structureType: structure.type,
        breakEvenLegWinRate: (0, underdog_structures_1.calculateBreakEvenLegWinRate)(structure),
        kellyResult,
    };
}
// Backward-compat alias — old code may still reference evaluateUdInsuredCard.
// Flex ladders ARE the insurance-like product; there is no separate Insured mode.
exports.evaluateUdInsuredCard = evaluateUdFlexCard;
