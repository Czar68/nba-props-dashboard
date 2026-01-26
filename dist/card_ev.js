"use strict";
// src/card_ev.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildHitDistribution = buildHitDistribution;
exports.evaluateFlexCard = evaluateFlexCard;
const payout_math_1 = require("./payout_math");
// Simple independent-leg binomial expansion
function buildHitDistribution(legs) {
    const dist = { 0: 1 };
    for (const leg of legs) {
        const p = leg.pick.trueProb;
        const q = 1 - p;
        const next = {};
        for (const [kStr, prob] of Object.entries(dist)) {
            const k = Number(kStr);
            if (!Number.isFinite(k))
                continue;
            const probNum = Number(prob);
            if (!Number.isFinite(probNum) || probNum <= 0)
                continue;
            // miss
            next[k] = (next[k] ?? 0) + probNum * q;
            // hit
            next[k + 1] = (next[k + 1] ?? 0) + probNum * p;
        }
        Object.assign(dist, next);
    }
    return dist;
}
function evaluateFlexCard(flexType, legs, stake = 1) {
    const hitDistribution = buildHitDistribution(legs);
    const payoutSchedule = (0, payout_math_1.getPayoutSchedule)(legs.length);
    const { cardEv, winProbCash, winProbAny } = (0, payout_math_1.computeCardEvFromDistribution)(stake, hitDistribution, payoutSchedule);
    const totalReturn = (cardEv + 1) * stake;
    return {
        flexType,
        legs,
        stake,
        totalReturn,
        expectedValue: cardEv,
        winProbability: winProbCash,
        cardEv,
        winProbCash,
        winProbAny,
        hitDistribution,
    };
}
