// src/run_optimizer.ts

/* eslint-disable no-console */
import fs from "fs";
import path from "path";
import { fetchPrizePicksRawProps } from "./fetch_props";
import { mergeOddsWithProps } from "./merge_odds";
import { calculateEvForMergedPicks } from "./calculate_ev";
import { evaluateFlexCard } from "./card_ev";
import { CardEvResult, EvPick, FlexType } from "./types";

// --------- Tuning knobs ---------

// Minimum edge per leg (fraction, e.g. 0.02 = +2% edge)
const MIN_EDGE_PER_LEG = 0.02;

// Minimum card EV as a fraction of stake (e.g. 0.04 = +4% ROE).
// NOTE: this is now enforced below when filtering cards.
const MIN_CARD_EV_FRACTION = 0.04;

// At most 1 leg per player overall
const MAX_LEGS_PER_PLAYER = 1;

// ---- Timezone helpers (EST/EDT via America/New_York) ----

function toEasternIsoString(date: Date): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {});

  const year = parts.year ?? "0000";
  const month = parts.month ?? "01";
  const day = parts.day ?? "01";
  const hour = parts.hour ?? "00";
  const minute = parts.minute ?? "00";
  const second = parts.second ?? "00";

  // Example: 2026-01-26T14:05:30 ET
  return `${year}-${month}-${day}T${hour}:${minute}:${second} ET`;
}

// ---- Sliding window helpers for card construction ----

function buildSlidingWindows(legs: EvPick[], size: number): EvPick[][] {
  const windows: EvPick[][] = [];
  for (let i = 0; i + size <= legs.length; i++) {
    windows.push(legs.slice(i, i + size));
  }
  return windows;
}

// Optional correlation helpers you can wire in later if desired

// Correlation caps per card
const MAX_LEGS_PER_TEAM_PER_CARD = 3;
const MAX_LEGS_PER_GAME_PER_CARD = 4;

function getGameKey(leg: EvPick): string {
  const t = leg.team ?? "";
  const o = leg.opponent ?? "";
  return [t, o].sort().join("_vs_");
}

function isCardWithinCorrelationLimits(window: EvPick[]): boolean {
  const teamCounts = new Map<string, number>();
  const gameCounts = new Map<string, number>();

  for (const leg of window) {
    const team = leg.team ?? "";
    const gameKey = getGameKey(leg);

    if (team) {
      const c = teamCounts.get(team) ?? 0;
      if (c + 1 > MAX_LEGS_PER_TEAM_PER_CARD) return false;
      teamCounts.set(team, c + 1);
    }

    if (gameKey) {
      const g = gameCounts.get(gameKey) ?? 0;
      if (g + 1 > MAX_LEGS_PER_GAME_PER_CARD) return false;
      gameCounts.set(gameKey, g + 1);
    }
  }

  return true;
}

function buildCardsForSize(
  legs: EvPick[],
  size: number,
  flexType: FlexType
): CardEvResult[] {
  const windows = buildSlidingWindows(legs, size);
  const cards: CardEvResult[] = [];

  for (const window of windows) {
    // If you want to enforce correlation caps later, re-enable this:
    // if (!isCardWithinCorrelationLimits(window)) continue;

    const cardLegs = window.map((pick) => ({
      pick,
      side: "over" as const,
    }));

    const result = evaluateFlexCard(flexType, cardLegs, 1);
    cards.push(result);
  }

  return cards;
}

// ---- CSV writers ----

function writeLegsCsv(
  legs: EvPick[],
  outPath: string,
  runTimestamp: string
): void {
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
    "runTimestamp",
  ];

  const lines: string[] = [];
  lines.push(headers.join(","));

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
      runTimestamp,
    ].map((v) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return s.includes(",") ? s.replace(/,/g, ";") : s;
    });

    lines.push(row.join(","));
  }

  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
}

function writeCardsCsv(
  cards: CardEvResult[],
  outPath: string,
  runTimestamp: string
): void {
  const headers = [
    "flexType",
    "cardEv",
    "winProbCash",
    "winProbAny",
    "legsSummary",
    "runTimestamp",
  ];

  const lines: string[] = [];
  lines.push(headers.join(","));

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
      runTimestamp,
    ].map((v) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return s.includes(",") ? s.replace(/,/g, ";") : s;
    });

    lines.push(row.join(","));
  }

  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
}

// ---- Main runner ----

async function run(): Promise<void> {
  const runTimestamp = toEasternIsoString(new Date());

  const raw = await fetchPrizePicksRawProps();
  console.log("Raw PrizePicks props:", raw.length);

  const merged = await mergeOddsWithProps(raw);
  console.log("Merged picks:", merged.length);

  const withEv = await calculateEvForMergedPicks(merged);
  console.log("Ev picks:", withEv.length);

  console.log("---- EV-based filtering ----");

  // 1) Filter by minimum edge per leg
  const legsAfterEdge = withEv.filter((leg) => leg.edge >= MIN_EDGE_PER_LEG);

  // 2) Enforce max legs per player global across all cards
  const counts = new Map<string, number>();
  const filtered: EvPick[] = legsAfterEdge.filter((leg) => {
    const key = leg.player;
    const count = counts.get(key) ?? 0;
    if (count + 1 > MAX_LEGS_PER_PLAYER) return false;
    counts.set(key, count + 1);
    return true;
  });

  console.log(
    `Legs after edge filter (>= ${MIN_EDGE_PER_LEG}): ${legsAfterEdge.length} of ${withEv.length}`
  );
  console.log(
    `Legs after player cap (<= ${MAX_LEGS_PER_PLAYER} per player): ${filtered.length} of ${legsAfterEdge.length}`
  );

  // ---- Persist filtered legs to JSON ----
  const legsOutPath = path.join(process.cwd(), "prizepicks-legs.json");
  fs.writeFileSync(
    legsOutPath,
    JSON.stringify({ runTimestamp, legs: filtered }, null, 2),
    "utf8"
  );
  console.log(`Wrote ${filtered.length} legs to ${legsOutPath}`);

  // ---- Also write CSV for Google Sheets ----
  const legsCsvPath = path.join(process.cwd(), "prizepicks-legs.csv");
  writeLegsCsv(filtered, legsCsvPath, runTimestamp);
  console.log(`Wrote ${filtered.length} legs to ${legsCsvPath}`);

  // ---- Log top EV legs for quick sanity check ----
  const topLegs = [...filtered].sort((a, b) => b.edge - a.edge).slice(0, 10);
  console.log("Top EV legs after filtering:");
  for (const leg of topLegs) {
    console.log(
      `  player=${leg.player}, stat=${leg.stat}, line=${leg.line}, ` +
        `trueProb=${
          Number.isFinite(leg.trueProb) ? leg.trueProb.toFixed(3) : leg.trueProb
        }, ` +
        `edge=${Number.isFinite(leg.edge) ? leg.edge.toFixed(3) : leg.edge}, ` +
        `overOdds=${leg.overOdds}, underOdds=${leg.underOdds}, book=${leg.book}, ` +
        `team=${leg.team}, opponent=${leg.opponent}`
    );
  }

  // ---- Card construction uses filtered legs ----
  const sortedByEdge = [...filtered].sort((a, b) => b.edge - a.edge);

  const cards5 = buildCardsForSize(sortedByEdge, 5, "flex5");
  const cards6 = buildCardsForSize(sortedByEdge, 6, "flex6");

  const cardsBeforeEvFilter: CardEvResult[] = [...cards5, ...cards6];
  console.log(
    `Cards before EV filter: ${cardsBeforeEvFilter.length} (from ${filtered.length} legs)`
  );

  // Enforce a minimum card EV fraction threshold
  const allCards: CardEvResult[] =
    MIN_CARD_EV_FRACTION > 0
      ? cardsBeforeEvFilter.filter((card) => card.cardEv >= MIN_CARD_EV_FRACTION)
      : cardsBeforeEvFilter;

  console.log(
    `Cards after EV filter (cardEv >= ${MIN_CARD_EV_FRACTION}): ${allCards.length} of ${cardsBeforeEvFilter.length}`
  );

  const cardsOutPath = path.join(process.cwd(), "prizepicks-cards.json");
  fs.writeFileSync(
    cardsOutPath,
    JSON.stringify({ runTimestamp, cards: allCards }, null, 2),
    "utf8"
  );
  console.log(`Wrote ${allCards.length} cards to ${cardsOutPath}`);

  // ---- Also write cards CSV for Google Sheets ----
  const cardsCsvPath = path.join(process.cwd(), "prizepicks-cards.csv");
  writeCardsCsv(allCards, cardsCsvPath, runTimestamp);
  console.log(`Wrote ${allCards.length} cards to ${cardsCsvPath}`);
}

run().catch((err) => {
  console.error("run_optimizer failed:", err);
  process.exit(1);
});
