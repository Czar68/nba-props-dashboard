// src/calculate_ev.ts

import { EvPick, MergedPick } from "./types";

// PrizePicks legs are binary with fixed payout table.
// For now we treat EV as (trueProb - 0.5) just for ranking.
export function calculateEvForMergedPick(pick: MergedPick): EvPick {
  const trueProb = pick.trueProb;
  const fairOdds =
    trueProb > 0 && trueProb < 1 ? 1 / trueProb - 1 : Number.NaN;

  const edge = trueProb - 0.5;
  const legEv = edge; // per-unit; used only for ranking and card construction

  const id = `${pick.site}-${pick.projectionId}-${pick.stat}-${pick.line}`;

  return {
    id,
    sport: pick.sport,
    site: pick.site,
    league: pick.league,
    player: pick.player,
    team: pick.team,
    opponent: pick.opponent,
    stat: pick.stat,
    line: pick.line,
    projectionId: pick.projectionId,
    gameId: pick.gameId,
    startTime: pick.startTime,
    outcome: "over",
    trueProb,
    fairOdds,
    edge,
    book: pick.book,
    overOdds: pick.overOdds,
    underOdds: pick.underOdds,
    legEv,
    isNonStandardOdds: pick.isNonStandardOdds ?? false,
  };
}

export function calculateEvForMergedPicks(
  merged: MergedPick[]
): EvPick[] {
  return merged.map(calculateEvForMergedPick);
}
