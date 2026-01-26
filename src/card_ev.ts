// src/card_ev.ts

import {
  CardEvResult,
  CardHitDistribution,
  EvPick,
  FlexType,
} from "./types";

import {
  getPayoutSchedule,
  computeCardEvFromDistribution,
} from "./payout_math";

// Simple independent-leg binomial expansion
export function buildHitDistribution(
  legs: { pick: EvPick; side: "over" | "under" }[]
): CardHitDistribution {
  const dist: CardHitDistribution = { 0: 1 };

  for (const leg of legs) {
    const p = leg.pick.trueProb;
    const q = 1 - p;
    const next: CardHitDistribution = {};

    for (const [kStr, prob] of Object.entries(dist)) {
      const k = Number(kStr);
      if (!Number.isFinite(k)) continue;

      const probNum = Number(prob);
      if (!Number.isFinite(probNum) || probNum <= 0) continue;

      // miss
      next[k] = (next[k] ?? 0) + probNum * q;

      // hit
      next[k + 1] = (next[k + 1] ?? 0) + probNum * p;
    }

    Object.assign(dist, next);
  }

  return dist;
}

export function evaluateFlexCard(
  flexType: FlexType,
  legs: { pick: EvPick; side: "over" | "under" }[],
  stake = 1
): CardEvResult {
  const hitDistribution = buildHitDistribution(legs);
  const payoutSchedule = getPayoutSchedule(legs.length);

  const { cardEv, winProbCash, winProbAny } =
    computeCardEvFromDistribution(stake, hitDistribution, payoutSchedule);

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
