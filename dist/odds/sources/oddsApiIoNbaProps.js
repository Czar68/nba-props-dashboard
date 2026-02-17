"use strict";
// src/odds/sources/oddsApiIoNbaProps.ts
// TEMPORARY: Odds-API.io backup feed for NBA player props while SGO credits are exhausted.
// Do not treat this as a permanent replacement for SGO.
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNbaPlayerPropsWithSharpsOnly = getNbaPlayerPropsWithSharpsOnly;
exports.getNbaPlayerPropsConsensus = getNbaPlayerPropsConsensus;
const oddsApiIoClient_1 = require("../oddsApiIoClient");
const odds_math_1 = require("../../odds_math");
// Debug logging control
const DEBUG = process.env.DEBUG_ODDS_API_IO === "1";
function debugLog(message, ...args) {
    if (DEBUG) {
        console.log(`[Odds-API.io DEBUG] ${message}`, ...args);
    }
}
// Book weights for consensus calculation
const BOOK_WEIGHTS = {
    "fanduel": 1.0,
    "pinnacle": 0.7,
    "circa": 0.7,
    // All other books get 0.3 weight
};
function getBookWeight(book) {
    const normalized = book.toLowerCase();
    return BOOK_WEIGHTS[normalized] ?? 0.3;
}
// Market mapping from Odds-API.io to our StatCategory
const MARKET_TO_STAT = {
    player_points: "points",
    player_points_alt: "points",
    player_rebounds: "rebounds",
    player_rebounds_alt: "rebounds",
    player_assists: "assists",
    player_assists_alt: "assists",
    player_threes: "threes",
    player_threes_alt: "threes",
    player_blocks: "blocks",
    player_blocks_alt: "blocks",
    player_steals: "steals",
    player_steals_alt: "steals",
    player_turnovers: "turnovers",
    player_turnovers_alt: "turnovers",
    player_points_rebounds: "pr",
    player_points_assists: "pa",
    player_rebounds_assists: "ra",
    player_points_rebounds_assists: "pra",
};
function createPropKey(odds) {
    return `${odds.eventId}|${odds.player}|${odds.market}|${odds.line}`;
}
function groupOddsByProp(odds) {
    const propGroups = new Map();
    for (const odd of odds) {
        const key = createPropKey(odd);
        if (!propGroups.has(key)) {
            propGroups.set(key, {
                key,
                eventId: odd.eventId,
                player: odd.player,
                market: odd.market,
                line: odd.line,
                rows: [],
            });
        }
        propGroups.get(key).rows.push(odd);
    }
    return propGroups;
}
// Statistical utilities
function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
}
function mad(values) {
    const med = median(values);
    const deviations = values.map(v => Math.abs(v - med));
    return median(deviations);
}
function pairOverUnderByBook(rows) {
    const byBook = new Map();
    for (const row of rows) {
        const book = row.book.toLowerCase();
        if (!byBook.has(book)) {
            byBook.set(book, {});
        }
        const entry = byBook.get(book);
        if (row.side === "over") {
            entry.over = row;
        }
        else {
            entry.under = row;
        }
    }
    const pairs = [];
    for (const [book, { over, under }] of byBook.entries()) {
        if (over && under) {
            const overProb = (0, odds_math_1.americanToProb)(over.price);
            const underProb = (0, odds_math_1.americanToProb)(under.price);
            const total = overProb + underProb;
            if (total > 0) {
                pairs.push({
                    book,
                    overOdds: over.price,
                    underOdds: under.price,
                    overProb,
                    underProb,
                    overProbDevig: overProb / total, // Proportional devig
                });
            }
        }
    }
    return pairs;
}
// Robust consensus calculation with outlier removal
function calculateConsensus(pairs) {
    if (pairs.length === 0)
        return null;
    const devigProbs = pairs.map(p => p.overProbDevig);
    // Calculate median and MAD for outlier detection
    const med = median(devigProbs);
    const m = mad(devigProbs);
    debugLog(`Consensus calculation: median=${med.toFixed(4)}, MAD=${m.toFixed(4)}, pairs=${pairs.length}`);
    // Filter outliers (3 * MAD threshold)
    let filteredPairs;
    if (m > 0) {
        filteredPairs = pairs.filter(p => Math.abs(p.overProbDevig - med) <= 3 * m);
        debugLog(`Outlier filtering: ${pairs.length - filteredPairs.length} outliers removed`);
    }
    else {
        filteredPairs = pairs;
    }
    // If filtering leaves <2 books, fall back to all pairs
    if (filteredPairs.length < 2) {
        filteredPairs = pairs;
        debugLog(`Fallback: using all ${pairs.length} pairs (filtered had <2)`);
    }
    // Calculate weighted mean
    const weights = filteredPairs.map(p => getBookWeight(p.book));
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    if (totalWeight === 0)
        return null;
    const weightedMean = filteredPairs.reduce((sum, p, i) => {
        return sum + p.overProbDevig * weights[i];
    }, 0) / totalWeight;
    debugLog(`Weighted consensus: ${weightedMean.toFixed(4)} from ${filteredPairs.length} books`);
    return weightedMean;
}
// Convert consensus probability back to American odds
function probToAmerican(prob) {
    if (prob <= 0)
        return 0;
    if (prob >= 1)
        return 0;
    if (prob >= 0.5) {
        return -(prob / (1 - prob)) * 100;
    }
    return ((1 - prob) / prob) * 100;
}
async function getNbaPlayerPropsWithSharpsOnly() {
    const rawRows = await (0, oddsApiIoClient_1.fetchNbaPlayerPropsAllBooks)();
    debugLog(`Raw items fetched from Odds-API.io: ${rawRows.length}`);
    if (!rawRows.length)
        return [];
    // Track book keys for diagnostics
    const bookKeysSeen = new Set();
    // Filter to supported markets only
    const supportedRows = rawRows.filter(row => {
        const stat = MARKET_TO_STAT[row.market];
        if (stat === null) {
            debugLog(`Unsupported market: ${row.market}`);
            return false;
        }
        bookKeysSeen.add(row.book);
        return true;
    });
    debugLog(`Rows mapped to supported markets: ${supportedRows.length}`);
    // Group by prop
    const groups = groupOddsByProp(supportedRows);
    debugLog(`Prop groups created: ${groups.size}`);
    const finalOdds = [];
    let pairedProps = 0;
    let consensusProps = 0;
    for (const group of groups.values()) {
        // Pair over/under by book
        const pairs = pairOverUnderByBook(group.rows);
        if (pairs.length < 2) {
            debugLog(`Skipping ${group.key}: insufficient paired books (${pairs.length})`);
            continue;
        }
        pairedProps++;
        // Calculate consensus probability
        const consensusProb = calculateConsensus(pairs);
        if (consensusProb === null) {
            debugLog(`Skipping ${group.key}: no consensus calculated`);
            continue;
        }
        consensusProps++;
        // Convert consensus back to American odds
        const consensusOverOdds = probToAmerican(consensusProb);
        const consensusUnderOdds = probToAmerican(1 - consensusProb);
        // Create synthetic odds entries for the consensus
        // Use the first book as the "book" identifier for compatibility
        const representativeBook = pairs[0].book;
        finalOdds.push({
            book: representativeBook,
            sport: "NBA",
            league: "NBA",
            eventId: group.eventId,
            eventTime: group.rows[0].eventTime,
            player: group.player,
            market: group.market,
            line: group.line,
            side: "over",
            price: consensusOverOdds,
            source: "odds-api-io",
            fetchedAt: new Date().toISOString(),
        });
        finalOdds.push({
            book: representativeBook,
            sport: "NBA",
            league: "NBA",
            eventId: group.eventId,
            eventTime: group.rows[0].eventTime,
            player: group.player,
            market: group.market,
            line: group.line,
            side: "under",
            price: consensusUnderOdds,
            source: "odds-api-io",
            fetchedAt: new Date().toISOString(),
        });
    }
    debugLog(`Props with paired quotes: ${pairedProps}`);
    debugLog(`Props with consensus: ${consensusProps}`);
    debugLog(`Final odds returned: ${finalOdds.length}`);
    // Log sample of book keys seen (top 20)
    if (DEBUG && bookKeysSeen.size > 0) {
        const sampleBooks = Array.from(bookKeysSeen).slice(0, 20);
        debugLog(`Sample book keys seen (${bookKeysSeen.size} total):`, sampleBooks);
    }
    return finalOdds;
}
// Export function to get SgoPlayerPropOdds-compatible format for merge_odds.ts
async function getNbaPlayerPropsConsensus() {
    const consensusOdds = await getNbaPlayerPropsWithSharpsOnly();
    // Convert to SgoPlayerPropOdds format
    const byKey = new Map();
    for (const odds of consensusOdds) {
        const stat = MARKET_TO_STAT[odds.market];
        if (!stat)
            continue;
        const key = `${odds.player.toLowerCase()}::${stat}::${odds.line}`;
        const existing = byKey.get(key) ?? {
            sport: "NBA",
            player: odds.player,
            team: null,
            opponent: null,
            league: "NBA",
            stat,
            line: odds.line,
            overOdds: Number.NaN,
            underOdds: Number.NaN,
            book: odds.book,
            eventId: odds.eventId,
            marketId: null,
            selectionIdOver: null,
            selectionIdUnder: null,
        };
        if (odds.side === "over") {
            existing.overOdds = odds.price;
        }
        else {
            existing.underOdds = odds.price;
        }
        byKey.set(key, existing);
    }
    // Return only complete pairs with valid odds
    return Array.from(byKey.values()).filter((p) => Number.isFinite(p.line) &&
        Number.isFinite(p.overOdds) &&
        Number.isFinite(p.underOdds));
}
