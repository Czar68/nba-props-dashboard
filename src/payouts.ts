// src/payouts.ts

export interface FlexPayout {
  hits: number;
  multiplier: number;
}

// PrizePicks NBA flex payout schedules (example)
export const FLEX5_PAYOUTS: FlexPayout[] = [
  { hits: 5, multiplier: 10 },
  { hits: 4, multiplier: 2 },
  { hits: 3, multiplier: 0.4 },
];

export const FLEX6_PAYOUTS: FlexPayout[] = [
  { hits: 6, multiplier: 25 },
  { hits: 5, multiplier: 2.5 },
  { hits: 4, multiplier: 0.5 },
];
