"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/run_underdog_optimizer.ts
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const calculate_ev_1 = require("./calculate_ev");
const merge_odds_1 = require("./merge_odds");
const underdog_card_ev_1 = require("./underdog_card_ev");
// TODO: replace this stub with a real Underdog fetch
async function fetchUnderdogRawProps() {
    console.warn("[UD] fetchUnderdogRawProps is currently stubbed; replace with real Underdog props source.");
    return [];
}
const MIN_EDGE = 0.01;
const MAX_LEGS_PER_PLAYER = 1;
function filterEvPicks(evPicks) {
    const filteredByEdge = evPicks.filter((p) => p.edge >= MIN_EDGE);
    const playerCounts = new Map();
    const result = [];
    for (const p of filteredByEdge) {
        const key = `${p.site}:${p.player}:${p.stat}`;
        const count = playerCounts.get(key) ?? 0;
        if (count >= MAX_LEGS_PER_PLAYER)
            continue;
        playerCounts.set(key, count + 1);
        result.push(p);
    }
    return result;
}
function buildCardLegInputs(legs) {
    return legs.map((p) => ({
        player: p.player,
        team: p.team,
        opponent: p.opponent,
        league: p.league,
        stat: p.stat,
        line: p.line,
        outcome: p.outcome,
        trueProb: p.trueProb,
        projectionId: p.projectionId,
        gameId: p.gameId,
        startTime: p.startTime,
    }));
}
function buildSlidingWindows(arr, size) {
    const result = [];
    for (let i = 0; i + size <= arr.length; i++) {
        result.push(arr.slice(i, i + size));
    }
    return result;
}
function toUdFlexType(size) {
    if (size === 3)
        return "flex5"; // reuse FlexType type; label overridden in CSV
    if (size === 4)
        return "flex5";
    if (size === 5)
        return "flex5";
    throw new Error(`Unsupported UD flex size: ${size}`);
}
function makeCardResultFromUd(legs, mode, size) {
    const cardLegInputs = buildCardLegInputs(legs);
    const evalResult = mode === "power"
        ? (0, underdog_card_ev_1.evaluateUdStandardCard)(cardLegInputs)
        : (0, underdog_card_ev_1.evaluateUdFlexCard)(cardLegInputs);
    const flexType = mode === "power"
        ? ("power" + size)
        : toUdFlexType(size);
    const { expectedValue, winProbability, hitDistribution, stake, totalReturn } = evalResult;
    return {
        flexType,
        legs: legs.map((pick) => ({
            pick,
            side: pick.outcome,
        })),
        stake,
        totalReturn,
        expectedValue,
        winProbability,
        cardEv: expectedValue,
        winProbCash: winProbability,
        winProbAny: winProbability,
        hitDistribution,
    };
}
function writeCsv(filePath, rows) {
    const csv = rows.map((r) => r.join(",")).join("\n");
    fs_1.default.writeFileSync(filePath, csv, "utf8");
}
async function main() {
    const runTimestamp = new Date().toLocaleString("en-US", {
        timeZone: "America/New_York",
    });
    // 1) Fetch and merge Underdog props (stubbed legs for now)
    const rawProps = await fetchUnderdogRawProps();
    const merged = await (0, merge_odds_1.mergeOddsWithProps)(rawProps);
    const evPicks = (0, calculate_ev_1.calculateEvForMergedPicks)(merged);
    const filteredEv = filterEvPicks(evPicks).filter((p) => p.site === "underdog");
    // Write underdog-legs.json / .csv
    const legsJsonPath = path_1.default.join(process.cwd(), "underdog-legs.json");
    fs_1.default.writeFileSync(legsJsonPath, JSON.stringify(filteredEv.map((p) => ({ ...p, runTimestamp })), null, 2), "utf8");
    const legsCsvPath = path_1.default.join(process.cwd(), "underdog-legs.csv");
    const legsHeader = [
        "site",
        "league",
        "player",
        "team",
        "opponent",
        "stat",
        "line",
        "projectionId",
        "gameId",
        "startTime",
        "outcome",
        "trueProb",
        "fairOdds",
        "edge",
        "book",
        "overOdds",
        "underOdds",
        "legEv",
        "runTimestamp",
    ];
    const legsRows = [
        legsHeader,
        ...filteredEv.map((p) => [
            p.site,
            p.league,
            p.player,
            p.team ?? "",
            p.opponent ?? "",
            p.stat,
            p.line.toString(),
            p.projectionId,
            p.gameId ?? "",
            p.startTime ?? "",
            p.outcome,
            p.trueProb.toString(),
            p.fairOdds.toString(),
            p.edge.toString(),
            p.book ?? "",
            p.overOdds?.toString() ?? "",
            p.underOdds?.toString() ?? "",
            p.legEv.toString(),
            runTimestamp,
        ]),
    ];
    writeCsv(legsCsvPath, legsRows);
    // 2) Build UD cards from filteredEv
    const sortedEv = [...filteredEv].sort((a, b) => b.edge - a.edge);
    const cardSizesFlex = [3, 4, 5];
    const cardSizesPower = [3, 4, 5, 6];
    const allCards = [];
    for (const size of cardSizesFlex) {
        const windows = buildSlidingWindows(sortedEv, size);
        for (const legs of windows) {
            const card = makeCardResultFromUd(legs, "flex", size);
            allCards.push({ format: `UD_FLEX${size}`, card });
        }
    }
    for (const size of cardSizesPower) {
        const windows = buildSlidingWindows(sortedEv, size);
        for (const legs of windows) {
            const card = makeCardResultFromUd(legs, "power", size);
            allCards.push({ format: `UD_STD${size}`, card });
        }
    }
    // Sort by card EV descending
    allCards.sort((a, b) => b.card.cardEv - a.card.cardEv);
    // Write underdog-cards.json / .csv
    const cardsJsonPath = path_1.default.join(process.cwd(), "underdog-cards.json");
    fs_1.default.writeFileSync(cardsJsonPath, JSON.stringify(allCards.map(({ format, card }) => ({
        format,
        cardEv: card.cardEv,
        winProbCash: card.winProbCash,
        winProbAny: card.winProbAny,
        legsSummary: card.legs.map((l) => ({
            site: l.pick.site,
            league: l.pick.league,
            player: l.pick.player,
            team: l.pick.team,
            opponent: l.pick.opponent,
            stat: l.pick.stat,
            line: l.pick.line,
            outcome: l.pick.outcome,
            trueProb: l.pick.trueProb,
            edge: l.pick.edge,
        })),
        runTimestamp,
    })), null, 2), "utf8");
    const cardsCsvPath = path_1.default.join(process.cwd(), "underdog-cards.csv");
    const cardsHeader = [
        "format",
        "cardEv",
        "winProbCash",
        "winProbAny",
        "legsSummary",
        "runTimestamp",
    ];
    const cardsRows = [
        cardsHeader,
        ...allCards.map(({ format, card }) => [
            format,
            card.cardEv.toString(),
            card.winProbCash.toString(),
            card.winProbAny.toString(),
            card.legs
                .map((l) => `${l.pick.player} ${l.pick.stat} ${l.pick.line} ${l.pick.outcome} (edge=${l.pick.edge.toFixed(4)})`)
                .join(" | "),
            runTimestamp,
        ]),
    ];
    writeCsv(cardsCsvPath, cardsRows);
    console.log(`[UD] Wrote ${filteredEv.length} legs, ${allCards.length} cards at ${runTimestamp}`);
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
