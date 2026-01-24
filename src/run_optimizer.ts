// src/run_optimizer.ts

import fs from "fs";
import path from "path";

import { fetchPrizePicksRawProps } from "./fetch_props";
import { mergeOddsWithProps } from "./merge_odds";
import { calculateEvForMergedPicks } from "./calculate_ev";
import { evaluateFlexCard } from "./card_ev";
import { CardEvResult, EvPick, FlexType } from "./types";

// Simple knobs for filtering / composition
const MIN_EDGE = 0.01; // Require at least 1% edge
const MAX_LEGS_PER_PLAYER = 1; // At most 1 leg per player overall

function buildSlidingWindows(legs: EvPick[], size: number): EvPick[][] {
  const windows: EvPick[][] = [];
  for (let i = 0; i + size <= legs.length; i++) {
    windows.push(legs.slice(i, i + size));
  }
  return windows;
}

// (Optional) correlation helpers you can wire in later if desired:
//
// // Correlation caps per card
// const MAX_LEGS_PER_TEAM_PER_CARD = 3;
// const MAX_LEGS_PER_GAME_PER_CARD = 4;
//
// function getGameKey(leg: EvPick): string {
//   const t = (leg.team ?? "").toString();
//   const o = (leg.opponent ?? "").toString();
//   return [t, o].sort().join("_vs_");
// }
//
// function isCardWithinCorrelationLimits(window: EvPick[]): boolean {
//   const teamCounts = new Map<string, number>();
//   const gameCounts = new Map<string, number>();
//
//   for (const leg of window) {
//     const team = (leg.team ?? "").toString();
//     const gameKey = getGameKey(leg);
//
//     if (team) {
//       const c = teamCounts.get(team) ?? 0;
//       if (c + 1 > MAX_LEGS_PER_TEAM_PER_CARD) return false;
//       teamCounts.set(team, c + 1);
//     }
//
//     if (gameKey) {
//       const g = gameCounts.get(gameKey) ?? 0;
//       if (g + 1 > MAX_LEGS_PER_GAME_PER_CARD) return false;
//       gameCounts.set(gameKey, g + 1);
//     }
//   }
//
//   return true;
// }

function buildCardsForSize(
  legs: EvPick[],
  size: number,
  flexType: FlexType
): CardEvResult[] {
  const windows = buildSlidingWindows(legs, size);
  const cards: CardEvResult[] = [];

  for (const window of windows) {
    // If you want to enforce correlation caps later, you can re‑enable:
    // if (!isCardWithinCorrelationLimits(window)) continue;

    // evaluateFlexCard consumes legs as { pick, side }
    const cardLegs = window.map((pick) => ({
      pick,
      side: "over" as const,
    }));

    // Cast to the expected leg type for evaluateFlexCard
    const result = evaluateFlexCard(flexType, cardLegs as any, 1);
    cards.push(result);
  }

  return cards;
}

function writeLegsCsv(legs: EvPick[], outPath: string): void {
  const headers = [
    "id",
    "player",
    "team",
    "opponent",
    "stat",
    "line",
    "league",
    "book",
    "overOdds",
    "underOdds",
    "trueProb",
    "edge",
    "legEv",
  ];
  const lines = [headers.join(",")];

  for (const leg of legs) {
    const row = [
      leg.id,
      leg.player,
      leg.team ?? "",
      leg.opponent ?? "",
      leg.stat,
      leg.line,
      leg.league ?? "",
      leg.book ?? "",
      leg.overOdds ?? "",
      leg.underOdds ?? "",
      leg.trueProb,
      leg.edge,
      leg.legEv,
    ].map((v) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return s.includes(",") ? `"${s.replace(/"/g, '""')}"` : s;
    });

    lines.push(row.join(","));
  }

  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
}

function writeCardsCsv(cards: CardEvResult[], outPath: string): void {
  const headers = ["flexType", "cardEv", "winProbCash", "winProbAny", "legsSummary"];
  const lines = [headers.join(",")];

  for (const card of cards) {
    const legsSummary = card.legs
      .map(
        (leg) =>
          `${leg.pick.player} ${leg.pick.stat} ${leg.pick.line} ${leg.side}`
      )
      .join(" | ");

    const row = [
      card.flexType,
      card.cardEv,
      card.winProbCash,
      card.winProbAny,
      legsSummary,
    ].map((v) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return s.includes(",") ? `"${s.replace(/"/g, '""')}"` : s;
    });

    lines.push(row.join(","));
  }

  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
}

async function run(): Promise<void> {
  const raw = await fetchPrizePicksRawProps();
  // eslint-disable-next-line no-console
  console.log("Raw PrizePicks props:", raw.length);

  const merged = await mergeOddsWithProps(raw);
  // eslint-disable-next-line no-console
  console.log("Merged picks:", merged.length);

  const withEv = calculateEvForMergedPicks(merged);
  // eslint-disable-next-line no-console
  console.log("Ev picks:", withEv.length);

  // ---- EV-based filtering ----
  // 1) Filter by minimum edge
  let filtered: EvPick[] = withEv.filter((leg) => leg.edge >= MIN_EDGE);

  // 2) Enforce max legs per player (global across all cards)
  const counts = new Map<string, number>();
  filtered = filtered.filter((leg) => {
    const key = leg.player;
    const count = counts.get(key) ?? 0;
    if (count >= MAX_LEGS_PER_PLAYER) {
      return false;
    }
    counts.set(key, count + 1);
    return true;
  });

  // eslint-disable-next-line no-console
  console.log(
    `Filtered legs: ${filtered.length} (from ${withEv.length}) with edge >= ${MIN_EDGE}`
  );

  // ---- Persist filtered legs to JSON ----
  const legsOutPath = path.join(process.cwd(), "prizepicks-legs.json");
  fs.writeFileSync(legsOutPath, JSON.stringify(filtered, null, 2), "utf8");
  // eslint-disable-next-line no-console
  console.log(`Wrote ${filtered.length} legs to ${legsOutPath}`);

  // ---- Also write CSV for Google Sheets ----
  const legsCsvPath = path.join(process.cwd(), "prizepicks-legs.csv");
  writeLegsCsv(filtered, legsCsvPath);
  // eslint-disable-next-line no-console
  console.log(`Wrote ${filtered.length} legs to ${legsCsvPath}`);

  // ---- Log top EV legs for quick sanity check ----
  const topLegs = [...filtered].sort((a, b) => b.edge - a.edge).slice(0, 10);
  // eslint-disable-next-line no-console
  console.log("Top EV legs (after filtering):");
  for (const leg of topLegs) {
    // eslint-disable-next-line no-console
    console.log({
      player: leg.player,
      stat: leg.stat,
      line: leg.line,
      trueProb: Number.isFinite(leg.trueProb)
        ? leg.trueProb.toFixed(3)
        : leg.trueProb,
      edge: Number.isFinite(leg.edge) ? leg.edge.toFixed(3) : leg.edge,
      overOdds: leg.overOdds,
      underOdds: leg.underOdds,
      book: leg.book,
      team: leg.team,
      opponent: leg.opponent,
    });
  }

  // ---- Card construction uses filtered legs ----
  const sortedByEdge = [...filtered].sort((a, b) => b.edge - a.edge);
  const cards5 = buildCardsForSize(sortedByEdge, 5, "flex5");
  const cards6 = buildCardsForSize(sortedByEdge, 6, "flex6");
  const allCards = [...cards5, ...cards6];

  const cardsOutPath = path.join(process.cwd(), "prizepicks-cards.json");
  fs.writeFileSync(cardsOutPath, JSON.stringify(allCards, null, 2), "utf8");
  // eslint-disable-next-line no-console
  console.log(`Wrote ${allCards.length} cards to ${cardsOutPath}`);

  // ---- Also write cards CSV for Google Sheets ----
  const cardsCsvPath = path.join(process.cwd(), "prizepicks-cards.csv");
  writeCardsCsv(allCards, cardsCsvPath);
  // eslint-disable-next-line no-console
  console.log(`Wrote ${allCards.length} cards to ${cardsCsvPath}`);
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("run_optimizer failed", err);
  process.exit(1);
});
