"use strict";
// src/odds_math.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.americanToProb = americanToProb;
exports.devigTwoWay = devigTwoWay;
exports.probToAmerican = probToAmerican;
// American odds -> implied probability (vigged)
function americanToProb(american) {
    if (american === 0 || !Number.isFinite(american))
        return 0.5;
    if (american > 0) {
        return 100 / (american + 100);
    }
    return -american / (-american + 100);
}
// Two‑way devig using simple proportional scaling.
// Returns [trueProbOver, trueProbUnder].
function devigTwoWay(probOver, probUnder) {
    const total = probOver + probUnder;
    if (total <= 0) {
        return [0.5, 0.5];
    }
    return [probOver / total, probUnder / total];
}
// Implied fair American odds from probability
function probToAmerican(prob) {
    if (prob <= 0)
        return 0;
    if (prob >= 1)
        return 0;
    if (prob >= 0.5) {
        return -(prob / (1 - prob)) * 100;
    }
    return ((1 - prob) / prob) * 100;
}
