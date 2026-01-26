// src/types.ts

export type Site = "prizepicks" | "underdog" | "sleeper";

export type StatCategory =
  | "points"
  | "rebounds"
  | "assists"
  | "pra"
  | "pr"
  | "pa"
  | "ra"
  | "threes"
  | "blocks"
  | "steals"
  | "stocks"
  | "turnovers"
  | "fantasy_score"
  | "points_rebounds"
  | "points_assists"
  | "rebounds_assists"
  // NFL stats
  | "pass_yards"
  | "pass_attempts"
  | "pass_completions"
  | "pass_tds"
  | "interceptions"
  | "rush_yards"
  | "rush_attempts"
  | "rush_rec_yards"
  | "rec_yards"
  | "receptions";

// Narrow stat name alias used by normalize_stats.ts
export type StatType =
  | "points"
  | "rebounds"
  | "assists"
  | "pra"
  | "threes"
  | "blocks"
  | "steals"
  | "fantasy";

// Raw PrizePicks leg at ingest
export interface RawPick {
  site: Site;
  league: string;
  player: string;
  team: string | null;
  opponent: string | null;
  stat: StatCategory;
  line: number;
  projectionId: string;
  gameId: string | null;
  startTime: string | null;

  // Promo / special line flags
  isDemon: boolean;
  isGoblin: boolean;
  isPromo: boolean;
}

// Shape returned from SGO fetch_sgo_odds.ts
export interface SgoPlayerPointsOdds {
  player: string;
  team: string | null;
  opponent: string | null;
  league: string;
  stat: StatCategory;
  line: number;
  overOdds: number;
  underOdds: number;
  book: string;
  eventId: string | null;
  marketId: string | null;
  selectionIdOver: string | null;
  selectionIdUnder: string | null;
}

// Merge stage: picks + odds before EV
export interface MergedPick {
  site: Site;
  league: string;
  player: string;
  team: string | null;
  opponent: string | null;
  stat: StatCategory;
  line: number;
  projectionId: string;
  gameId: string | null;
  startTime: string | null;

  // Book/odds fields populated in merge_odds.ts
  book: string;
  overOdds: number;
  underOdds: number;
  trueProb: number;
  fairOverOdds: number;
  fairUnderOdds: number;

  // Promo flags carried forward from RawPick
  isDemon: boolean;
  isGoblin: boolean;
  isPromo: boolean;
}

// EV / cards inputs and outputs
export type FlexType = "flex5" | "flex6" | "power2" | "power3" | "power4";

export interface CardLegInput {
  player: string;
  team: string | null;
  opponent: string | null;
  league: string;
  stat: StatCategory;
  line: number;
  outcome: "over" | "under";
  trueProb: number;
  projectionId: string;
  gameId: string | null;
  startTime: string | null;
}

// Per‑leg EV object after merge_odds + calculate_ev
export interface EvPick {
  id: string;
  site: Site;
  league: string;
  player: string;
  team: string | null;
  opponent: string | null;
  stat: StatCategory;
  line: number;
  projectionId: string;
  gameId: string | null;
  startTime: string | null;
  outcome: "over" | "under";
  trueProb: number;
  fairOdds: number;
  edge: number;
  book: string | null;
  overOdds: number | null;
  underOdds: number | null;

  // Per‑leg EV
  legEv: number;
}

// Distribution of hits → probability for a card
export type CardHitDistribution = Record<number, number>;

// Card EV result used by run_optimizer.ts and card_ev.ts
export interface CardEvResult {
  flexType: FlexType;

  // Legs are { pick, side } as used in run_optimizer.ts
  legs: {
    pick: EvPick;
    side: "over" | "under";
  }[];

  stake: number;
  totalReturn: number;

  // Overall EV (expected profit per 1 unit stake)
  expectedValue: number;

  // Win probability for cashing and any positive return
  winProbability: number;

  // Convenience fields used by run_optimizer writeCardsCsv
  cardEv: number;
  winProbCash: number;
  winProbAny: number;

  // Full hit distribution (k hits → probability)
  hitDistribution: CardHitDistribution;
}

// Card types used by Sheets export
export type CardMode = "flex" | "power";

export type CardSize = 2 | 3 | 4 | 5 | 6;

export interface CardLeg {
  site: Site;
  league: string;
  player: string;
  team: string | null;
  opponent: string | null;
  stat: StatCategory;
  line: number;
  projectionId: string;
  gameId: string | null;
  startTime: string | null;
  outcome: "over" | "under";
  trueProb: number;
}

export interface Card {
  mode: CardMode;
  size: CardSize;
  legs: CardLeg[];
  stake: number;
  stakePerCard: number;
  totalReturn: number;
  expectedValue: number;
  winProbability: number;
}
