"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/run_underdog_optimizer.ts
// Underdog optimizer models only Standard and Flex entries — the two modes
// exposed in the Underdog Pick'em UI.  There is no separate "Insured" mode;
// the insurance-like behaviour is the reduced-payout tiers within Flex ladders.
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const merge_odds_1 = require("./merge_odds");
const calculate_ev_1 = require("./calculate_ev");
const underdog_card_ev_1 = require("./underdog_card_ev");
const fetch_underdog_props_1 = require("./fetch_underdog_props");
const load_underdog_props_1 = require("./load_underdog_props");
const kelly_staking_1 = require("./kelly_staking");
const bankroll_tracker_1 = require("./bankroll_tracker");
const underdog_structures_1 = require("./config/underdog_structures");
// ---- CLI parsing for --sports flag ----
function parseSportsFlag(raw) {
    if (!raw || raw.trim() === '') {
        return ['NBA'];
    }
    return raw
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter((s) => ['NBA', 'NFL', 'MLB', 'NHL', 'NCAAB', 'NCAAF'].includes(s));
}
// Parse CLI arguments
const args = process.argv.slice(2);
let sportsArg = undefined;
for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--sports=')) {
        sportsArg = arg.substring(9);
    }
    else if (arg === '--sports' && i + 1 < args.length) {
        sportsArg = args[i + 1];
        i++; // Skip the next argument
    }
}
const sports = parseSportsFlag(sportsArg);
console.log(`[UD] CLI sports: [${sports.join(',')}]${sportsArg ? ` (from --sports ${sportsArg})` : ' (default NBA)'}`);
// Enhanced Underdog props fetch with priority order: scraped → API → manual
// Expected return shape: RawPick[] with fields for site, league, player, team, opponent, 
// stat, line, projectionId, gameId, startTime, and promo flags
async function fetchUnderdogRawPropsWithLogging(sports) {
    const scrapedFilePath = path_1.default.join(process.cwd(), "underdog_props_scraped.json");
    const manualFilePath = path_1.default.join(process.cwd(), "underdog_manual_props.json");
    // Priority 1: Try scraped file first
    console.log('[UD] Checking for scraped props file...');
    const scrapedProps = await (0, load_underdog_props_1.loadUnderdogPropsFromFile)(scrapedFilePath, "scraped");
    if (scrapedProps.length > 0) {
        console.log(`[UD] Using ${scrapedProps.length} props from scraped file`);
        return scrapedProps;
    }
    // Priority 2: Try API
    console.log('[UD] No scraped file found, trying Underdog API...');
    try {
        const apiProps = await (0, fetch_underdog_props_1.fetchUnderdogRawProps)(sports);
        // Count props by league for logging
        const leagueCounts = apiProps.reduce((acc, pick) => {
            acc[pick.league] = (acc[pick.league] || 0) + 1;
            return acc;
        }, {});
        const leagueSummary = Object.entries(leagueCounts)
            .map(([league, count]) => `${league}: ${count}`)
            .join(', ');
        if (apiProps.length > 0) {
            console.log(`[UD] Loaded ${apiProps.length} props from Underdog API (${leagueSummary})`);
            return apiProps;
        }
        else {
            console.log('[UD] API returned 0 props, falling back to manual file...');
        }
    }
    catch (error) {
        console.error('[UD] ERROR: Failed to fetch Underdog props from API:', error);
        console.log('[UD] Falling back to manual props file...');
    }
    // Priority 3: Fall back to manual file
    const manualProps = await (0, load_underdog_props_1.loadUnderdogPropsFromFile)(manualFilePath, "manual");
    if (manualProps.length > 0) {
        console.log(`[UD] Using ${manualProps.length} props from manual file`);
        return manualProps;
    }
    // All sources failed
    console.log('[UD] WARNING: No props available from any source (scraped, API, or manual)');
    console.log('[UD] WARNING: Using empty props list; optimizer will produce 0 legs/cards');
    return [];
}
// Legacy constants - replaced by Underdog-specific thresholds
const MAX_LEGS_PER_PLAYER = 1;
/**
 * Adapter: Map Underdog structure IDs to PrizePicks-compatible FlexType codes
 *
 * This adapter exists solely for CSV/Sheets compatibility with the existing
 * PrizePicks schema. Underdog has two modes — Standard and Flex — which map
 * cleanly to the PrizePicks "XP" (power) and "XF" (flex) naming convention.
 *
 * Mapping:
 *   UD_XP_STD  → "XP" (Standard = all-or-nothing, like PP power)
 *   UD_XF_FLX  → "XF" (Flex = tiered ladder, like PP flex)
 */
function mapUnderdogStructureToFlexType(structureId) {
    if (structureId.includes('F_FLX')) {
        // Flex structures → XF codes
        const size = structureId.match(/(\d)F/)?.[1];
        return `${size}F`;
    }
    else {
        // Standard structures → XP codes
        const size = structureId.match(/(\d)P/)?.[1];
        return `${size}P`;
    }
}
function filterEvPicks(evPicks) {
    // 1) Exclude non-standard (varied-multiplier) legs — they don't fit the fixed ladder model
    const includeNonStandard = process.env.UD_INCLUDE_NON_STANDARD_ODDS === 'true';
    const standardOnly = evPicks.filter((p) => {
        if (p.isNonStandardOdds && !includeNonStandard)
            return false;
        return true;
    });
    const nonStdCount = evPicks.length - standardOnly.length;
    if (nonStdCount > 0) {
        console.log(`[UD] Filtered out ${nonStdCount} non-standard (varied-multiplier) legs`);
    }
    // 2) Filter by Underdog global leg EV floor instead of hardcoded MIN_EDGE
    const filteredByEdge = standardOnly.filter((p) => (0, underdog_structures_1.meetsUnderdogLegEvFloor)(p.legEv));
    // 3) Max 1 leg per player per stat
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
        sport: p.sport,
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
    const flex = ["3F", "4F", "5F", "6F", "7F", "8F"];
    if (size >= 3 && size <= 8)
        return flex[size - 3];
    throw new Error(`Unsupported UD flex size: ${size}`);
}
function makeCardResultFromUd(legs, mode, size, structureId) {
    const cardLegInputs = buildCardLegInputs(legs);
    const evalResult = mode === "power"
        ? (0, underdog_card_ev_1.evaluateUdStandardCard)(cardLegInputs, structureId)
        : (0, underdog_card_ev_1.evaluateUdFlexCard)(cardLegInputs, structureId);
    const flexType = mode === "power"
        ? `${size}P`
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
        avgProb: legs.reduce((sum, leg) => sum + leg.trueProb, 0) / legs.length,
        avgEdgePct: legs.reduce((sum, leg) => sum + (leg.trueProb - 0.5), 0) / legs.length * 100,
        hitDistribution,
    };
}
function writeCsv(filePath, rows) {
    const csv = rows.map((r) => r.join(",")).join("\n");
    fs_1.default.writeFileSync(filePath, csv, "utf8");
}
/**
 * Format a Date as Eastern-time ISO string: "YYYY-MM-DDTHH:MM:SS ET"
 * Matches the format used by PrizePicks optimizer for unified Sheets display.
 */
function toEasternIsoString(date) {
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
        .reduce((acc, p) => {
        if (p.type !== "literal")
            acc[p.type] = p.value;
        return acc;
    }, {});
    return `${parts.year ?? "0000"}-${parts.month ?? "01"}-${parts.day ?? "01"}T${parts.hour ?? "00"}:${parts.minute ?? "00"}:${parts.second ?? "00"} ET`;
}
async function main() {
    const runTimestamp = toEasternIsoString(new Date());
    // 1) Fetch and merge Underdog props with real API
    const rawProps = await fetchUnderdogRawPropsWithLogging(sports);
    const result = await (0, merge_odds_1.mergeOddsWithPropsWithMetadata)(rawProps);
    const merged = result.odds;
    const evPicks = (0, calculate_ev_1.calculateEvForMergedPicks)(merged);
    // Store metadata for later use in bankroll logging
    const oddsProvider = result.metadata.providerUsed;
    // Display odds source information
    if (result.metadata.isFromCache) {
        const fetchedAt = result.metadata.fetchedAt ? new Date(result.metadata.fetchedAt).toLocaleString() : "unknown";
        console.log(`Odds source: cache (from ${result.metadata.originalProvider || "unknown"}, fetched at ${fetchedAt})`);
    }
    else {
        const provider = result.metadata.providerUsed;
        const timestamp = result.metadata.fetchedAt ? new Date(result.metadata.fetchedAt).toLocaleString() : new Date().toLocaleString();
        if (provider === "SGO") {
            console.log(`Odds source: SGO (fresh), fetched at ${timestamp}`);
        }
        else if (provider === "TheRundown") {
            console.log(`Odds source: TheRundown (fresh, SGO skipped/unavailable), fetched at ${timestamp}`);
        }
        else {
            console.log(`Odds source: none (no odds available)`);
        }
    }
    const filteredEv = filterEvPicks(evPicks).filter((p) => p.site === "underdog");
    // Write underdog-legs.json / .csv
    const legsJsonPath = path_1.default.join(process.cwd(), "underdog-legs.json");
    fs_1.default.writeFileSync(legsJsonPath, JSON.stringify(filteredEv.map((p) => ({ ...p, runTimestamp })), null, 2), "utf8");
    const legsCsvPath = path_1.default.join(process.cwd(), "underdog-legs.csv");
    // Match PrizePicks Legs sheet schema: Sport,id,player,team,stat,line,league,book,overOdds,underOdds,trueProb,edge,legEv,runTimestamp,gameTime,IsWithin24h,IsNonStandardOdds
    const legsHeader = [
        "Sport",
        "id",
        "player",
        "team",
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
        "gameTime",
        "IsWithin24h",
        "IsNonStandardOdds",
    ];
    const legsRows = [
        legsHeader,
        ...filteredEv.map((p) => {
            // Determine if game is within 24h
            let isWithin24h = "TRUE";
            if (p.startTime) {
                try {
                    const gameDate = new Date(p.startTime);
                    const now = new Date();
                    const diffMs = gameDate.getTime() - now.getTime();
                    isWithin24h = (diffMs >= 0 && diffMs <= 24 * 60 * 60 * 1000) ? "TRUE" : "FALSE";
                }
                catch {
                    isWithin24h = "TRUE";
                }
            }
            return [
                p.sport, // Sport
                p.id, // id (underdog-{projId}-{stat}-{line})
                p.player, // player
                p.team ?? "", // team
                p.stat, // stat
                p.line.toString(), // line
                p.league, // league
                p.book ?? "", // book
                p.overOdds?.toString() ?? "", // overOdds
                p.underOdds?.toString() ?? "", // underOdds
                p.trueProb.toString(), // trueProb
                p.edge.toString(), // edge
                p.legEv.toString(), // legEv
                runTimestamp, // runTimestamp
                p.startTime ?? "", // gameTime
                isWithin24h, // IsWithin24h
                p.isNonStandardOdds ? "TRUE" : "FALSE", // IsNonStandardOdds
            ];
        }),
    ];
    writeCsv(legsCsvPath, legsRows);
    // 2) Build UD cards from filteredEv using structure thresholds and attempt budgeting
    const sortedEv = [...filteredEv].sort((a, b) => b.legEv - a.legEv);
    // Define all Standard structures (all-or-nothing)
    const standardStructureIds = ['UD_2P_STD', 'UD_3P_STD', 'UD_4P_STD', 'UD_5P_STD', 'UD_6P_STD'];
    // Define all Flex structures (tiered payout ladders — 1-loss for 3–5, 2-loss for 6–8)
    const flexStructureIds = ['UD_3F_FLX', 'UD_4F_FLX', 'UD_5F_FLX', 'UD_6F_FLX', 'UD_7F_FLX', 'UD_8F_FLX'];
    const allCards = [];
    const structureMetricsMap = new Map();
    // Global attempt budget for Underdog
    const GLOBAL_MAX_ATTEMPTS = 10000; // Conservative global budget
    // Build Standard structures (all-or-nothing)
    for (const structureId of standardStructureIds) {
        const structure = (0, underdog_structures_1.getUnderdogStructureById)(structureId);
        if (!structure) {
            console.warn(`[UD] No structure found for ${structureId}`);
            continue;
        }
        const metrics = (0, underdog_structures_1.createUnderdogStructureMetrics)(structureId);
        structureMetricsMap.set(structureId, metrics);
        const viableLegs = sortedEv.filter(leg => (0, underdog_structures_1.meetsUnderdogLegEvFloor)(leg.legEv));
        const legEvs = viableLegs.map(leg => leg.legEv);
        if (!(0, underdog_structures_1.canLegsMeetStructureThreshold)(structureId, legEvs, structure)) {
            console.log(`[UD] Skipping ${structureId} — legs cannot meet threshold`);
            (0, underdog_structures_1.logUnderdogStructureMetrics)(metrics);
            continue;
        }
        const targetAcceptedCards = underdog_structures_1.UNDERDOG_TARGET_ACCEPTED_CARDS.standard;
        const maxAttempts = (0, underdog_structures_1.getUnderdogMaxAttemptsForStructure)({
            structure,
            viableLegCount: viableLegs.length,
            targetAcceptedCards,
            globalMaxAttempts: GLOBAL_MAX_ATTEMPTS,
        });
        metrics.attemptsAllocated = maxAttempts;
        if (maxAttempts === 0) {
            console.log(`[UD] ${structureId}: 0 attempts allocated (insufficient viable legs)`);
            (0, underdog_structures_1.logUnderdogStructureMetrics)(metrics);
            continue;
        }
        const windows = buildSlidingWindows(viableLegs, structure.size);
        let attemptsUsed = 0;
        for (const legs of windows) {
            if (attemptsUsed >= maxAttempts)
                break;
            attemptsUsed++;
            metrics.attemptsUsed++;
            metrics.evCallsMade++;
            const card = makeCardResultFromUd(legs, "power", structure.size, structureId);
            if (!(0, underdog_structures_1.meetsUnderdogStructureThreshold)(structureId, card.cardEv)) {
                continue;
            }
            metrics.cardsAccepted++;
            allCards.push({ format: structureId, card });
        }
        (0, underdog_structures_1.logUnderdogStructureMetrics)(metrics);
    }
    // Build Flex structures (tiered payout ladders)
    for (const structureId of flexStructureIds) {
        const structure = (0, underdog_structures_1.getUnderdogStructureById)(structureId);
        if (!structure) {
            console.warn(`[UD] No structure found for ${structureId}`);
            continue;
        }
        const metrics = (0, underdog_structures_1.createUnderdogStructureMetrics)(structureId);
        structureMetricsMap.set(structureId, metrics);
        const viableLegs = sortedEv.filter(leg => (0, underdog_structures_1.meetsUnderdogLegEvFloor)(leg.legEv));
        const legEvs = viableLegs.map(leg => leg.legEv);
        if (!(0, underdog_structures_1.canLegsMeetStructureThreshold)(structureId, legEvs, structure)) {
            console.log(`[UD] Skipping ${structureId} — legs cannot meet threshold`);
            (0, underdog_structures_1.logUnderdogStructureMetrics)(metrics);
            continue;
        }
        // Extra scrutiny for large 2-loss ladders (7–8 picks)
        if (structure.size >= 7) {
            // Future: add getBestCaseUdEvUpperBound pruning here
        }
        const targetAcceptedCards = underdog_structures_1.UNDERDOG_TARGET_ACCEPTED_CARDS.flex;
        const maxAttempts = (0, underdog_structures_1.getUnderdogMaxAttemptsForStructure)({
            structure,
            viableLegCount: viableLegs.length,
            targetAcceptedCards,
            globalMaxAttempts: GLOBAL_MAX_ATTEMPTS,
        });
        metrics.attemptsAllocated = maxAttempts;
        if (maxAttempts === 0) {
            console.log(`[UD] ${structureId}: 0 attempts allocated (insufficient viable legs)`);
            (0, underdog_structures_1.logUnderdogStructureMetrics)(metrics);
            continue;
        }
        const windows = buildSlidingWindows(viableLegs, structure.size);
        let attemptsUsed = 0;
        for (const legs of windows) {
            if (attemptsUsed >= maxAttempts)
                break;
            attemptsUsed++;
            metrics.attemptsUsed++;
            metrics.evCallsMade++;
            const card = makeCardResultFromUd(legs, "flex", structure.size, structureId);
            if (!(0, underdog_structures_1.meetsUnderdogStructureThreshold)(structureId, card.cardEv)) {
                continue;
            }
            metrics.cardsAccepted++;
            allCards.push({ format: structureId, card });
        }
        (0, underdog_structures_1.logUnderdogStructureMetrics)(metrics);
    }
    // Sort by card EV descending
    allCards.sort((a, b) => b.card.cardEv - a.card.cardEv);
    // Write Underdog cards using unified schema (compatible with PrizePicks)
    writeUnderdogCardsToFile(allCards, runTimestamp, oddsProvider);
}
/**
 * Write Underdog cards to file using unified schema compatible with PrizePicks
 * This allows sheets_push_cards.py to be extended to handle both platforms
 */
function writeUnderdogCardsToFile(cards, runTimestamp, oddsProvider) {
    // Transform Underdog cards to unified schema matching PrizePicks format
    const unifiedCards = cards.map(({ format, card }) => {
        // Calculate average probability and edge percentage (same as PrizePicks)
        const avgProb = card.legs.reduce((sum, leg) => sum + leg.pick.trueProb, 0) / card.legs.length;
        const avgEdgePct = card.legs.reduce((sum, leg) => sum + (leg.pick.edge * 100), 0) / card.legs.length;
        // Extract leg IDs for CSV columns
        const legIds = card.legs.map(leg => leg.pick.id);
        // Use the adapter function for clear, type-safe mapping
        const flexType = mapUnderdogStructureToFlexType(format);
        return {
            site: 'UD', // Platform identifier
            flexType, // Mapped using adapter function
            structureId: format, // Underdog structure ID for reference
            legs: card.legs, // Full leg data
            stake: card.stake || 1, // Default stake if not set
            totalReturn: card.totalReturn || 0,
            expectedValue: card.expectedValue || 0,
            winProbability: card.winProbability || 0,
            cardEv: card.cardEv,
            winProbCash: card.winProbCash,
            winProbAny: card.winProbAny,
            avgProb,
            avgEdgePct,
            hitDistribution: card.hitDistribution || {},
            legIds, // For CSV leg1Id, leg2Id, etc.
        };
    });
    // Write JSON output (unified schema)
    const cardsJsonPath = path_1.default.join(process.cwd(), "underdog-cards.json");
    fs_1.default.writeFileSync(cardsJsonPath, JSON.stringify({ runTimestamp, cards: unifiedCards }, null, 2), "utf8");
    // Write CSV output (exact same column order as PrizePicks + site column)
    const cardsCsvPath = path_1.default.join(process.cwd(), "underdog-cards.csv");
    const headers = [
        "Sport", // Sport (NEW - for unified schema)
        "site", // Platform identifier (NEW - for unified schema)
        "flexType", // Structure type code (same as PrizePicks)
        "cardEv", // Card expected value (same as PrizePicks)
        "winProbCash", // Probability of cashing (same as PrizePicks)
        "winProbAny", // Probability of any positive return (same as PrizePicks)
        "avgProb", // Average leg probability (same as PrizePicks)
        "avgEdgePct", // Average leg edge percentage (same as PrizePicks)
        "leg1Id", // Individual leg IDs (same as PrizePicks)
        "leg2Id",
        "leg3Id",
        "leg4Id",
        "leg5Id",
        "leg6Id",
        "runTimestamp", // Run timestamp (same as PrizePicks)
        "kellyStake", // Kelly stake amount (NEW)
        "kellyFrac", // Kelly fraction used (NEW)
    ];
    const rows = [headers];
    for (const card of unifiedCards) {
        // Derive sport from first leg (cards should be single-sport)
        const sport = card.legs.length > 0 ? card.legs[0].pick.sport : "NBA";
        // Calculate Kelly staking
        const kellyFrac = (0, kelly_staking_1.getKellyFraction)(sport);
        const kellyStake = (0, kelly_staking_1.calculateKellyStake)(card.cardEv, 10000, sport);
        const row = [
            sport, // Sport
            card.site, // site
            card.flexType, // flexType
            card.cardEv.toString(), // cardEv
            card.winProbCash.toString(), // winProbCash
            card.winProbAny.toString(), // winProbAny
            card.avgProb.toString(), // avgProb
            card.avgEdgePct.toString(), // avgEdgePct
            card.legIds[0] ?? "", // leg1Id
            card.legIds[1] ?? "", // leg2Id
            card.legIds[2] ?? "", // leg3Id
            card.legIds[3] ?? "", // leg4Id
            card.legIds[4] ?? "", // leg5Id
            card.legIds[5] ?? "", // leg6Id
            runTimestamp, // runTimestamp
            kellyStake.toString(), // kellyStake (NEW)
            kellyFrac.toString(), // kellyFrac (NEW)
        ].map((v) => {
            if (v === null || v === undefined)
                return "";
            const s = String(v);
            return s.includes(",") ? s.replace(/,/g, " ") : s;
        });
        rows.push(row);
    }
    const csvContent = rows.map(row => row.join(",")).join("\n");
    fs_1.default.writeFileSync(cardsCsvPath, csvContent, "utf8");
    console.log(`[UD] Wrote ${cards.length} cards to unified schema at ${runTimestamp}`);
    console.log(`[UD] JSON: ${cardsJsonPath}`);
    console.log(`[UD] CSV: ${cardsCsvPath}`);
    // Log bankroll usage for production tracking with detected odds provider
    const sportsProcessed = [...new Set(unifiedCards.flatMap(card => card.legs.map((leg) => leg.pick.sport)))];
    // Determine odds provider for production logging
    let provider = 'underdog_optimizer';
    if (oddsProvider === 'SGO') {
        provider = 'sgo_live';
    }
    else if (oddsProvider === 'TheRundown') {
        provider = 'therundown_live';
    }
    (0, bankroll_tracker_1.logProductionRun)(provider, sportsProcessed);
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
