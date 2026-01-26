// src/payout_math.ts

import { CardHitDistribution } from "./types";
import { FlexPayout, FLEX5_PAYOUTS, FLEX6_PAYOUTS } from "./payouts";

export function getPayoutSchedule(legCount: number): FlexPayout[] {
  if (legCount === 5) return FLEX5_PAYOUTS;
  if (legCount === 6) return FLEX6_PAYOUTS;
  return [];
}

export function computeCardEvFromDistribution(
  stake: number,
  distribution: CardHitDistribution,
  payoutSchedule: FlexPayout[]
): {
  cardEv: number;
  winProbCash: number;
  winProbAny: number;
} {
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
    if (!payout) continue;

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
