// src/underdog_card_ev.ts
import { CardLegInput } from "./types";

// Simple helper to compute card EV from hit distribution and payout structure
function computeCardEvFromPayouts(
  hitProbs: number[], // index = hits, value = probability
  payouts: { [hits: number]: number }, // hits -> payout multiple
  stake: number
) {
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

// Compute distribution of hits from independent leg probabilities
function computeHitDistribution(legs: CardLegInput[]): number[] {
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

// Underdog "power" (standard) payouts (current typical structure, adjust if needed)
// 3-pick: 5x
// 4-pick: 9x
// 5-pick: 19x
// 6-pick: 30x
export function evaluateUdStandardCard(legs: CardLegInput[]) {
  const size = legs.length;
  const stake = 1;

  const hitProbs = computeHitDistribution(legs);
  const payouts: { [hits: number]: number } = {};

  if (size === 3) {
    payouts[3] = 5;
  } else if (size === 4) {
    payouts[4] = 9;
  } else if (size === 5) {
    payouts[5] = 19;
  } else if (size === 6) {
    payouts[6] = 30;
  } else {
    throw new Error(`Unsupported UD standard card size: ${size}`);
  }

  const { expectedReturn, expectedValue, winProbability } =
    computeCardEvFromPayouts(hitProbs, payouts, stake);

  return {
    stake,
    totalReturn: expectedReturn,
    expectedValue,
    winProbability,
    hitDistribution: hitProbs,
  };
}

// Underdog flex payouts (current typical structure, adjust if needed)
// 3-flex: 3x on 3/3, 1x on 2/3
// 4-flex: 6x on 4/4, 1.5x on 3/4
// 5-flex: 10x on 5/5, 2.5x on 4/5
export function evaluateUdFlexCard(legs: CardLegInput[]) {
  const size = legs.length;
  const stake = 1;

  const hitProbs = computeHitDistribution(legs);
  const payouts: { [hits: number]: number } = {};

  if (size === 3) {
    payouts[3] = 3;
    payouts[2] = 1;
  } else if (size === 4) {
    payouts[4] = 6;
    payouts[3] = 1.5;
  } else if (size === 5) {
    payouts[5] = 10;
    payouts[4] = 2.5;
  } else {
    throw new Error(`Unsupported UD flex card size: ${size}`);
  }

  const { expectedReturn, expectedValue, winProbability } =
    computeCardEvFromPayouts(hitProbs, payouts, stake);

  return {
    stake,
    totalReturn: expectedReturn,
    expectedValue,
    winProbability,
    hitDistribution: hitProbs,
  };
}
