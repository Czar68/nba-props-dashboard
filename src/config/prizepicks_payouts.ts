// src/config/prizepicks_payouts.ts
// Single source of truth for PrizePicks payout structures

export interface FlexPayout {
  hits: number;
  multiplier: number;
}

// PrizePicks payout structures (official as of Feb 2026)
export const PRIZEPICKS_PAYOUTS: Record<string, FlexPayout[]> = {
  // Power plays (all-or-nothing)
  '2P': [{ hits: 2, multiplier: 3 }],
  '3P': [{ hits: 3, multiplier: 6 }],
  '4P': [{ hits: 4, multiplier: 10 }],
  '5P': [{ hits: 5, multiplier: 20 }],
  '6P': [{ hits: 6, multiplier: 37.5 }],
  
  // Flex plays (tiered payouts)
  '3F': [
    { hits: 3, multiplier: 3 },    // 3× entry fee
    { hits: 2, multiplier: 1 },     // 1× entry fee (break even)
  ],
  '4F': [
    { hits: 4, multiplier: 6 },     // 6× entry fee
    { hits: 3, multiplier: 1.5 },   // 1.5× entry fee
  ],
  '5F': [
    { hits: 5, multiplier: 10 },    // 10× entry fee
    { hits: 4, multiplier: 2 },     // 2× entry fee
    { hits: 3, multiplier: 0.4 },    // 0.4× entry fee
  ],
  '6F': [
    { hits: 6, multiplier: 25 },    // 25× entry fee
    { hits: 5, multiplier: 2 },     // 2× entry fee
    { hits: 4, multiplier: 0.4 },    // 0.4× entry fee
  ],
};

// Helper: Convert to simple record for engine calculations
export function getPayoutsAsRecord(flexType: string): Record<number, number> {
  const payouts = PRIZEPICKS_PAYOUTS[flexType] || [];
  const record: Record<number, number> = {};
  for (const p of payouts) {
    record[p.hits] = p.multiplier;
  }
  return record;
}

// Helper: Get max payout multiplier for a structure
export function getMaxPayoutMultiplier(flexType: string): number {
  const payouts = PRIZEPICKS_PAYOUTS[flexType] || [];
  if (payouts.length === 0) return 0;
  return Math.max(...payouts.map(p => p.multiplier));
}

// Helper: Check if structure is Power vs Flex
export function isPowerStructure(flexType: string): boolean {
  return flexType.includes('P');
}

// Helper: Get all supported structure types
export function getSupportedStructures(): string[] {
  return Object.keys(PRIZEPICKS_PAYOUTS);
}
