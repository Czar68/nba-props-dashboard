// src/merge_odds.ts

/* eslint-disable no-console */

import { RawPick, MergedPick, SgoPlayerPointsOdds } from "./types";
import { americanToProb, devigTwoWay, probToAmerican } from "./odds_math";
import { fetchSgoPlayerPointsOdds } from "./fetch_sgo_odds";

const MAX_LINE_DIFF = 0.75; // max allowed difference between PP line and SGO line
const MAX_JUICE = 200; // skip crazy-juiced SGO lines (|odds| > 200)

// Normalize "KEVIN_DURANT_1_NBA" → "kevin durant"
function normalizeSgoPlayerId(id: string): string {
  const noSuffix = id.replace(/_[0-9]+_NBA$/i, "");
  return noSuffix.replace(/_/g, " ").toLowerCase().trim();
}

// "Kevin Durant" → "kevin durant"
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

// Map SGO stat string to your StatCategory label used on RawPick.stat
function normalizeSgoStat(stat: string): string {
  const s = stat.toLowerCase();
  if (s === "points") return "points";
  if (s === "rebounds") return "rebounds";
  if (s === "assists") return "assists";
  if (s === "threepointersmade") return "threes";
  if (s === "blocks") return "blocks";
  if (s === "steals") return "steals";
  if (s === "turnovers") return "turnovers";
  if (s === "fantasyscore") return "fantasy_score";
  if (s === "points+rebounds+assists") return "pra";
  if (s === "points+rebounds") return "points_rebounds";
  if (s === "points+assists") return "points_assists";
  if (s === "rebounds+assists") return "rebounds_assists";
  if (s === "blocks+steals" || s === "stocks") return "stocks";
  return s;
}

function findBestMatchForPick(
  pick: RawPick,
  sgoOdds: SgoPlayerPointsOdds[]
): SgoPlayerPointsOdds | null {
  const pickNameNorm = normalizeName(pick.player);
  const pickStatNorm = pick.stat; // already normalized StatCategory
  const pickLine = pick.line;

  let best: SgoPlayerPointsOdds | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const o of sgoOdds) {
    const sgoNameNorm = normalizeSgoPlayerId(o.player);
    const sgoStatNorm = normalizeSgoStat(o.stat);

    if (sgoNameNorm !== pickNameNorm) continue;
    if (sgoStatNorm !== pickStatNorm) continue;

    const lineDiff = Math.abs(o.line - pickLine);
    if (!Number.isFinite(lineDiff) || lineDiff > MAX_LINE_DIFF) continue;

    if (
      Math.abs(o.overOdds) > MAX_JUICE ||
      Math.abs(o.underOdds) > MAX_JUICE
    ) {
      continue;
    }

    const score = lineDiff;
    if (score < bestScore) {
      bestScore = score;
      best = o;
    }
  }

  return best;
}

export async function mergeOddsWithProps(
  rawPicks: RawPick[]
): Promise<MergedPick[]> {
  console.log("mergeOddsWithProps: fetching SGO odds...");
  const sgoMarkets = await fetchSgoPlayerPointsOdds();
  console.log(
    `mergeOddsWithProps: using ${sgoMarkets.length} live SGO markets (multi-stat)`
  );

  const merged: MergedPick[] = [];

  for (const pick of rawPicks) {
    // Hard filter: skip demons, goblins, promos everywhere
    if (pick.isDemon || pick.isGoblin || pick.isPromo) {
      continue;
    }

    const match = findBestMatchForPick(pick, sgoMarkets);
    if (!match) continue;

    const overProb = americanToProb(match.overOdds);
    const underProb = americanToProb(match.underOdds);
    const [trueOverProb, trueUnderProb] = devigTwoWay(overProb, underProb);
    const fairOverOdds = probToAmerican(trueOverProb);
    const fairUnderOdds = probToAmerican(trueUnderProb);

    merged.push({
      ...pick,
      book: match.book,
      overOdds: match.overOdds,
      underOdds: match.underOdds,
      trueProb: trueOverProb,
      fairOverOdds,
      fairUnderOdds,
    });
  }

  console.log(
    `mergeOddsWithProps: merged ${merged.length} picks with SGO odds`
  );
  return merged;
}
