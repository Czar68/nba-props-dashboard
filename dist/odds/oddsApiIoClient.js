"use strict";
// src/odds/oddsApiIoClient.ts
// TEMPORARY: Odds-API.io backup feed for NBA player props while SGO credits are exhausted.
// Do not treat this as a permanent replacement for SGO.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchNbaPlayerPropsAllBooks = fetchNbaPlayerPropsAllBooks;
require("dotenv/config");
const node_fetch_1 = __importDefault(require("node-fetch"));
// Debug logging control
const DEBUG = process.env.DEBUG_ODDS_API_IO === "1";
function debugLog(message, ...args) {
    if (DEBUG) {
        console.log(`[Odds-API.io DEBUG] ${message}`, ...args);
    }
}
let lastFetchDay = null;
let dailyRequestCount = 0;
let cache = null;
const CACHE_TTL_MS = 60000;
// All NBA player prop markets including alternates
const NBA_PLAYER_PROP_MARKETS = [
    // Primary markets
    'player_points',
    'player_assists',
    'player_rebounds',
    'player_threes',
    'player_blocks',
    'player_steals',
    'player_turnovers',
    // Combination props
    'player_points_rebounds',
    'player_points_assists',
    'player_rebounds_assists',
    'player_points_rebounds_assists',
    'player_points_threes',
    'player_assists_threes',
    // Alternate lines (these will be expanded based on API response)
    'player_points_alt',
    'player_assists_alt',
    'player_rebounds_alt',
    'player_threes_alt',
    'player_blocks_alt',
    'player_steals_alt',
    'player_turnovers_alt'
];
function parseSide(raw) {
    const s = String(raw ?? "").trim().toLowerCase();
    if (s === "over" || s === "o")
        return "over";
    if (s === "under" || s === "u")
        return "under";
    if (s.includes("over"))
        return "over";
    if (s.includes("under"))
        return "under";
    return null;
}
function parseNumber(raw) {
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? n : null;
}
function normalizeBookKey(book) {
    return String(book ?? "").trim().toLowerCase();
}
function parsePlayer(raw) {
    return String(raw ?? "").replace(/\s+/g, " ").trim();
}
async function fetchNbaPlayerPropsAllBooks() {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
        debugLog("Using cached data");
        return cache.data;
    }
    const today = new Date().toISOString().slice(0, 10);
    if (lastFetchDay !== today) {
        dailyRequestCount = 0;
        lastFetchDay = today;
    }
    if (dailyRequestCount >= 100) {
        console.warn("fetchNbaPlayerPropsAllBooks: Odds-API.io daily request limit reached; returning cache or []");
        return cache?.data ?? [];
    }
    // Check authentication environment variables
    const API_KEY = process.env.ODDS_API_IO_KEY;
    const API_HOST = process.env.ODDS_API_IO_HOST || "api.the-odds-api.com";
    const RAPID_KEY = process.env.RAPIDAPI_KEY;
    const RAPID_HOST = process.env.RAPIDAPI_HOST_ODDS_API_IO;
    debugLog("Auth environment variables check:");
    debugLog("  ODDS_API_IO_KEY:", !!API_KEY);
    debugLog("  ODDS_API_IO_HOST:", !!process.env.ODDS_API_IO_HOST);
    debugLog("  RAPIDAPI_KEY:", !!RAPID_KEY);
    debugLog("  RAPIDAPI_HOST_ODDS_API_IO:", !!RAPID_HOST);
    // Determine which auth scheme to use
    let url;
    let headers;
    let authMethod;
    if (API_KEY) {
        // Using direct Odds-API.io (preferred method)
        authMethod = "Direct Odds-API.io";
        debugLog("Using direct Odds-API.io");
        url = new URL(`https://${API_HOST}/v4/sports/basketball_nba/odds`);
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        };
        // Add API key as URL parameter (correct method for Odds-API.io)
        url.searchParams.set("apiKey", API_KEY);
    }
    else if (RAPID_KEY && RAPID_HOST) {
        // Fallback to RapidAPI proxy (if available)
        authMethod = "RapidAPI Proxy";
        debugLog("Using RapidAPI proxy (fallback)");
        url = new URL(`https://${RAPID_HOST}/nba/player-props`);
        headers = {
            "X-RapidAPI-Key": RAPID_KEY,
            "X-RapidAPI-Host": RAPID_HOST,
        };
    }
    else {
        console.error("fetchNbaPlayerPropsAllBooks: Missing authentication. Set either:");
        console.error("  ODDS_API_IO_KEY (preferred - direct API)");
        console.error("  OR RAPIDAPI_KEY + RAPIDAPI_HOST_ODDS_API_IO (RapidAPI proxy)");
        throw new Error("Missing authentication for Odds-API.io");
    }
    // Set common query parameters
    url.searchParams.set("sport", "basketball_nba");
    url.searchParams.set("region", "us");
    url.searchParams.set("markets", NBA_PLAYER_PROP_MARKETS.join(","));
    debugLog("Request URL:", url.toString());
    debugLog("Request headers:", Object.keys(headers));
    const fetchedAt = new Date().toISOString();
    try {
        const res = await (0, node_fetch_1.default)(url.toString(), {
            method: "GET",
            headers,
        });
        debugLog("Response status:", res.status, res.statusText);
        if (!res.ok) {
            const bodyText = await res.text();
            debugLog("[Odds-API.io] HTTP", res.status, res.statusText);
            debugLog("Response body (first 300 chars):", bodyText.slice(0, 300));
            const error = new Error(`Odds-API.io HTTP ${res.status}: ${res.statusText}`);
            error.status = res.status;
            error.statusText = res.statusText;
            error.body = bodyText;
            throw error;
        }
        const json = await res.json();
        debugLog("JSON parsed successfully");
        // Log structure counts
        const events = Array.isArray(json)
            ? json
            : Array.isArray(json?.data)
                ? json.data
                : Array.isArray(json?.events)
                    ? json.events
                    : [];
        debugLog("Structure analysis:");
        debugLog("  Top-level array:", Array.isArray(json));
        debugLog("  json.data array:", Array.isArray(json?.data));
        debugLog("  json.events array:", Array.isArray(json?.events));
        debugLog("  Number of events:", events.length);
        if (events.length > 0) {
            const firstEvent = events[0];
            const bookmakers = Array.isArray(firstEvent?.bookmakers)
                ? firstEvent.bookmakers
                : Array.isArray(firstEvent?.sportsbooks)
                    ? firstEvent.sportsbooks
                    : [];
            debugLog("  First event bookmakers:", bookmakers.length);
            if (bookmakers.length > 0) {
                const firstBookmaker = bookmakers[0];
                const markets = Array.isArray(firstBookmaker?.markets)
                    ? firstBookmaker.markets
                    : Array.isArray(firstBookmaker?.props)
                        ? firstBookmaker.props
                        : [];
                debugLog("  First bookmaker markets:", markets.length);
                debugLog("  First bookmaker market keys:", markets.map((m) => m?.key || m?.market || m?.name).slice(0, 10));
            }
        }
        const rows = [];
        for (const ev of events) {
            const eventId = String(ev?.id ?? ev?.eventId ?? ev?.event_id ?? "");
            const eventTime = String(ev?.commence_time ?? ev?.eventTime ?? ev?.start_time ?? ev?.date ?? "");
            const bookmakers = Array.isArray(ev?.bookmakers)
                ? ev.bookmakers
                : Array.isArray(ev?.sportsbooks)
                    ? ev.sportsbooks
                    : [];
            for (const bm of bookmakers) {
                const book = normalizeBookKey(bm?.key ?? bm?.bookmaker ?? bm?.name ?? bm?.title);
                if (!book)
                    continue;
                const markets = Array.isArray(bm?.markets)
                    ? bm.markets
                    : Array.isArray(bm?.props)
                        ? bm.props
                        : [];
                for (const mkt of markets) {
                    const market = String(mkt?.key ?? mkt?.market ?? mkt?.name ?? "").trim();
                    if (!market)
                        continue;
                    if (!market.startsWith("player_"))
                        continue;
                    const outcomes = Array.isArray(mkt?.outcomes)
                        ? mkt.outcomes
                        : Array.isArray(mkt?.offers)
                            ? mkt.offers
                            : [];
                    for (const out of outcomes) {
                        const side = parseSide(out?.side ?? out?.name ?? out?.label ?? out?.type);
                        if (!side)
                            continue;
                        const player = parsePlayer(out?.description ?? out?.player ?? out?.participant ?? out?.name);
                        if (!player)
                            continue;
                        const line = parseNumber(out?.point ?? out?.line ?? out?.handicap ?? out?.value) ??
                            parseNumber(out?.total);
                        if (line === null)
                            continue;
                        const price = parseNumber(out?.price ?? out?.odds ?? out?.american) ??
                            parseNumber(out?.a);
                        if (price === null)
                            continue;
                        rows.push({
                            book,
                            sport: "NBA",
                            league: "NBA",
                            eventId,
                            eventTime,
                            player,
                            market,
                            line,
                            side,
                            price,
                            source: "odds-api-io",
                            fetchedAt,
                        });
                    }
                }
            }
        }
        debugLog("Final parsed rows:", rows.length);
        debugLog("Unique books seen:", [...new Set(rows.map(r => r.book))]);
        dailyRequestCount += 1;
        cache = { data: rows, fetchedAt: Date.now() };
        return rows;
    }
    catch (error) {
        debugLog("Fetch error:", error);
        if (error instanceof Error) {
            // Re-throw HTTP errors with full context
            if (error.status) {
                throw error;
            }
            // Log other errors but don't crash the optimizer
            console.error("fetchNbaPlayerPropsAllBooks: Unexpected error:", error.message);
            return cache?.data ?? [];
        }
        throw error;
    }
}
