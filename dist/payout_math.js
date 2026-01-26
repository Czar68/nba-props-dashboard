"use strict";
// src/payout_math.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPayoutSchedule = getPayoutSchedule;
exports.computeCardEvFromDistribution = computeCardEvFromDistribution;
const payouts_1 = require("./payouts");
function getPayoutSchedule(legCount) {
    if (legCount === 5)
        return payouts_1.FLEX5_PAYOUTS;
    if (legCount === 6)
        return payouts_1.FLEX6_PAYOUTS;
    return [];
}
function computeCardEvFromDistribution(stake, distribution, payoutSchedule) {
    let ev = 0;
    let winProbCash = 0;
    let winProbAny = 0;
    for (const [hitsStr, prob] of Object.entries(distribution)) {
        const hits = Number(hitsStr);
        const probNum = Number(prob);
        if (!Number.isFinite(hits) || !Number.isFinite(probNum) || probNum <= 0) {
            continue;
        }
        const payout = payoutSchedule.find((p) => p.hits === hits);
        if (!payout)
            continue;
        const returnAmount = payout.multiplier * stake;
        const profit = returnAmount - stake;
        ev += profit * probNum;
        if (profit > 0) {
            winProbCash += probNum;
        }
        if (returnAmount > 0) {
            winProbAny += probNum;
        }
    }
    return {
        cardEv: ev / stake,
        winProbCash,
        winProbAny,
    };
}
