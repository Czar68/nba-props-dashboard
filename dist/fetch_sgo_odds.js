"use strict";
// src/fetch_sgo_odds.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchSgoPlayerPointsOdds = fetchSgoPlayerPointsOdds;
require("dotenv/config");
const sports_odds_api_1 = __importDefault(require("sports-odds-api"));
const PREFERRED_BOOKS = [
    "fanduel",
    "draftkings",
    "caesars",
    "betmgm",
    "espn_bet",
    "pointsbet",
];
function pickBestBookmaker(byBookmaker) {
    if (!byBookmaker)
        return null;
    // Prefer a known sharp book first
    for (const book of PREFERRED_BOOKS) {
        const data = byBookmaker[book];
        if (data && data.available !== false && data.odds != null) {
            return { bookmakerID: book, data };
        }
    }
    // Fallback: choose the available book with best (highest) American odds
    let best = null;
    let bestVal = -Infinity;
    for (const [bookmakerID, data] of Object.entries(byBookmaker)) {
        if (!data || data.available === false || data.odds == null)
            continue;
        const val = Number(data.odds);
        if (Number.isNaN(val))
            continue;
        if (val > bestVal) {
            bestVal = val;
            best = { bookmakerID, data };
        }
    }
    return best;
}
async function fetchSgoPlayerPointsOdds() {
    const apiKey = process.env.SGO_API_KEY ?? process.env.SGOAPIKEY;
    if (!apiKey) {
        // eslint-disable-next-line no-console
        console.warn("fetchSgoPlayerPointsOdds: missing SGOAPIKEY, returning []");
        return [];
    }
    const client = new sports_odds_api_1.default({ apiKeyParam: apiKey });
    const results = [];
    // ---- NBA PLAYER POINTS ----
    try {
        const pageNba = await client.events.get({
            leagueID: "NBA",
            finalized: false,
            oddsAvailable: true,
            limit: 50,
        });
        const eventsNba = pageNba.data ?? [];
        // eslint-disable-next-line no-console
        console.log("fetchSgoPlayerPointsOdds: NBA events length", eventsNba.length);
        const byPlayerNba = new Map();
        for (const event of eventsNba) {
            const odds = event.odds;
            if (!odds)
                continue;
            const league = event.leagueID ?? "NBA";
            const eventId = event.eventID ?? null;
            const homeTeam = event.homeTeamID ?? null;
            const awayTeam = event.awayTeamID ?? null;
            for (const odd of Object.values(odds)) {
                if (!odd)
                    continue;
                const statEntityID = odd.statEntityID;
                if (!statEntityID)
                    continue;
                // Skip team-level odds, not player props
                if (statEntityID === "all" ||
                    statEntityID === "home" ||
                    statEntityID === "away") {
                    continue;
                }
                const statID = odd.statID;
                const betTypeID = odd.betTypeID;
                const periodID = odd.periodID;
                const sideID = odd.sideID;
                // Only full-game player POINTS over/under
                if (statID !== "points")
                    continue;
                if (betTypeID !== "ou")
                    continue;
                if (periodID !== "game")
                    continue;
                if (sideID !== "over" && sideID !== "under")
                    continue;
                const best = pickBestBookmaker(odd.byBookmaker);
                if (!best)
                    continue;
                const { bookmakerID, data } = best;
                const lineRaw = data.overUnder;
                const oddsRaw = data.odds;
                const line = Number(lineRaw);
                const price = Number(oddsRaw);
                if (!Number.isFinite(line) || !Number.isFinite(price))
                    continue;
                let existing = byPlayerNba.get(statEntityID);
                if (!existing) {
                    existing = {
                        player: statEntityID, // raw ID; mapped later in merge step
                        team: null,
                        opponent: null,
                        league,
                        stat: "points",
                        line,
                        overOdds: Number.NaN,
                        underOdds: Number.NaN,
                        book: bookmakerID,
                        eventId,
                        marketId: null,
                        selectionIdOver: null,
                        selectionIdUnder: null,
                    };
                    byPlayerNba.set(statEntityID, existing);
                }
                // At this point existing is definitely set
                if (!Number.isFinite(existing.line)) {
                    existing.line = line;
                }
                if (sideID === "over") {
                    existing.overOdds = price;
                }
                else if (sideID === "under") {
                    existing.underOdds = price;
                }
                // Optionally fill team/opponent from event using homeTeam/awayTeam
                if (!existing.team && homeTeam && awayTeam) {
                    // Leave as IDs; merge step normalizes names by player ID
                    existing.team = homeTeam;
                    existing.opponent = awayTeam;
                }
            }
        }
        const resultNba = Array.from(byPlayerNba.values()).filter((p) => Number.isFinite(p.line) &&
            Number.isFinite(p.overOdds) &&
            Number.isFinite(p.underOdds));
        results.push(...resultNba);
        // eslint-disable-next-line no-console
        console.log("fetchSgoPlayerPointsOdds: returning", resultNba.length, "NBA player points markets from SGO");
    }
    catch (err) {
        // eslint-disable-next-line no-console
        console.warn("fetchSgoPlayerPointsOdds: error calling SGO SDK for NBA", err);
    }
    // ---- NFL PLAYER POINTS ----
    try {
        const pageNfl = await client.events.get({
            leagueID: "NFL",
            finalized: false,
            oddsAvailable: true,
            limit: 50,
        });
        const eventsNfl = pageNfl.data ?? [];
        // eslint-disable-next-line no-console
        console.log("fetchSgoPlayerPointsOdds: NFL events length", eventsNfl.length);
        const byPlayerNfl = new Map();
        for (const event of eventsNfl) {
            const odds = event.odds;
            if (!odds)
                continue;
            const league = event.leagueID ?? "NFL";
            const eventId = event.eventID ?? null;
            const homeTeam = event.homeTeamID ?? null;
            const awayTeam = event.awayTeamID ?? null;
            for (const odd of Object.values(odds)) {
                if (!odd)
                    continue;
                const statEntityID = odd.statEntityID;
                if (!statEntityID)
                    continue;
                // Skip team-level odds, not player props
                if (statEntityID === "all" ||
                    statEntityID === "home" ||
                    statEntityID === "away") {
                    continue;
                }
                const statID = odd.statID;
                const betTypeID = odd.betTypeID;
                const periodID = odd.periodID;
                const sideID = odd.sideID;
                // For now, mirror NBA behavior: only player POINTS over/under.
                // Once you know SGO's NFL statIDs for pass_yards/rec_yards/etc.,
                // you can branch here and set stat accordingly.
                if (statID !== "points")
                    continue;
                if (betTypeID !== "ou")
                    continue;
                if (periodID !== "game")
                    continue;
                if (sideID !== "over" && sideID !== "under")
                    continue;
                const best = pickBestBookmaker(odd.byBookmaker);
                if (!best)
                    continue;
                const { bookmakerID, data } = best;
                const lineRaw = data.overUnder;
                const oddsRaw = data.odds;
                const line = Number(lineRaw);
                const price = Number(oddsRaw);
                if (!Number.isFinite(line) || !Number.isFinite(price))
                    continue;
                let existing = byPlayerNfl.get(statEntityID);
                if (!existing) {
                    existing = {
                        player: statEntityID, // raw ID; mapped later
                        team: null,
                        opponent: null,
                        league,
                        stat: "points",
                        line,
                        overOdds: Number.NaN,
                        underOdds: Number.NaN,
                        book: bookmakerID,
                        eventId,
                        marketId: null,
                        selectionIdOver: null,
                        selectionIdUnder: null,
                    };
                    byPlayerNfl.set(statEntityID, existing);
                }
                if (!Number.isFinite(existing.line)) {
                    existing.line = line;
                }
                if (sideID === "over") {
                    existing.overOdds = price;
                }
                else if (sideID === "under") {
                    existing.underOdds = price;
                }
                if (!existing.team && homeTeam && awayTeam) {
                    existing.team = homeTeam;
                    existing.opponent = awayTeam;
                }
            }
        }
        const resultNfl = Array.from(byPlayerNfl.values()).filter((p) => Number.isFinite(p.line) &&
            Number.isFinite(p.overOdds) &&
            Number.isFinite(p.underOdds));
        results.push(...resultNfl);
        // eslint-disable-next-line no-console
        console.log("fetchSgoPlayerPointsOdds: returning", resultNfl.length, "NFL player points markets from SGO");
    }
    catch (err) {
        // eslint-disable-next-line no-console
        console.warn("fetchSgoPlayerPointsOdds: error calling SGO SDK for NFL", err);
    }
    // eslint-disable-next-line no-console
    console.log("fetchSgoPlayerPointsOdds: total player points markets from SGO", results.length);
    return results;
}
