// src/types.ts

export type Site = "prizepicks" | "underdog" | "sleeper";

export type Sport = 'NBA' | 'NFL' | 'MLB' | 'NHL' | 'NCAAB' | 'NCAAF'; // extensible

export type StatCategory =
  // NBA stats
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
  | "receptions"
  // NHL stats
  | "goals"
  | "assists"
  | "points"
  | "shots_on_goal"
  | "saves"
  | "goals_against"
  | "plus_minus"
  | "penalty_minutes"
  | "power_play_goals"
  | "short_handed_goals"
  | "time_on_ice";

// Narrow stat name alias used by normalize_stats.ts
export type StatType =
  // NBA core
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
  | "fantasy"
  // NFL passing
  | "pass_yards"
  | "pass_attempts"
  | "pass_completions"
  | "pass_tds"
  | "interceptions"
  | "longest_completion"
  | "passer_rating"
  // NFL rushing
  | "rush_yards"
  | "rush_attempts"
  | "rush_tds"
  | "longest_rush"
  // NFL receiving
  | "rec_yards"
  | "receptions"
  | "rec_tds"
  | "longest_reception"
  // NFL combos + TDs + fantasy
  | "pass_rush_yards"
  | "rush_rec_yards"
  | "any_td"
  | "nfl_fantasy"
  // NHL stats
  | "goals"
  | "assists"
  | "points"
  | "shots_on_goal"
  | "saves"
  | "goals_against"
  | "plus_minus"
  | "penalty_minutes"
  | "power_play_goals"
  | "short_handed_goals"
  | "time_on_ice";

// Raw PrizePicks leg at ingest
export interface RawPick {
  sport: Sport;
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

  // Underdog: true if the leg has explicit per-leg multipliers (e.g. 1.03x/0.88x)
  // rather than standard fixed-ladder pricing. These legs don't fit the
  // standard EV model and should be excluded from card building by default.
  isNonStandardOdds: boolean;
}

// Shape returned from SGO fetch_sgo_odds.ts
export interface SgoPlayerPropOdds {
  sport: Sport;
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
  sport: Sport;
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

  // Underdog varied-multiplier flag (carried from RawPick)
  isNonStandardOdds: boolean;
}

// EV / cards inputs and outputs
export type FlexType =
  | "2P"
  | "3P"
  | "4P"
  | "5P"
  | "6P"
  | "7P"
  | "8P"
  | "3F"
  | "4F"
  | "5F"
  | "6F"
  | "7F"
  | "8F";

export interface CardLegInput {
  sport: Sport;
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
  sport: Sport;
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

  // Underdog varied-multiplier flag (carried from RawPick → MergedPick)
  isNonStandardOdds: boolean;
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

  // Card-level diagnostic metrics
  avgProb: number;    // Average of leg true probabilities
  avgEdgePct: number; // Average leg edge in percent (edge * 100)

  // Full hit distribution (k hits → probability)
  hitDistribution: CardHitDistribution;

  // Kelly sizing results (computed after EV)
  kellyResult?: {
    meanReturn: number;
    variance: number;
    rawKellyFraction: number;
    cappedKellyFraction: number;    // After maxRawKellyFraction cap
    safeKellyFraction: number;      // After globalKellyMultiplier  
    finalKellyFraction: number;     // After all caps (what we actually use)
    recommendedStake: number;
    expectedProfit: number;
    maxPotentialWin: number;
    riskAdjustment: string;
    isCapped: boolean;
    capReasons: string[];
  };

  // Portfolio selection results (computed after Kelly)
  selected?: boolean;              // True if card is in optimal portfolio
  portfolioRank?: number;          // 1-based rank in selected cards (undefined if not selected)
  efficiencyScore?: number;        // Efficiency = EV / (cappedKelly + epsilon)
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
