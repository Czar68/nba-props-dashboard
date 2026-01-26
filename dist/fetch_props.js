"use strict";
// src/fetch_props.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchPrizePicksRawProps = fetchPrizePicksRawProps;
const node_fetch_1 = __importDefault(require("node-fetch"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const PRIZEPICKS_PROJECTIONS_BASE_URL = "https://api.prizepicks.com/projections";
const PRIZEPICKS_COMMON_QUERY = "per_page=250&single_stat=true&in_game=true&state_code=KY&game_mode=prizepools";
// Map PrizePicks attr.stat_type into our StatCategory
function mapStatType(statTypeRaw) {
    const s = statTypeRaw.toLowerCase();
    // NBA stats
    if (s === "points" || s === "pts")
        return "points";
    if (s === "rebounds" || s === "rebs")
        return "rebounds";
    if (s === "assists" || s === "asts")
        return "assists";
    if (s === "threes" || s === "three_pointers_made" || s === "3pt_made")
        return "threes";
    if (s === "blocks" || s === "blk")
        return "blocks";
    if (s === "steals" || s === "stl")
        return "steals";
    if (s === "turnovers")
        return "turnovers";
    if (s === "fantasy_score" || s === "fantasy")
        return "fantasy_score";
    if (s === "pts_rebs_asts" ||
        s === "pra" ||
        s === "points_rebounds_assists")
        return "pra";
    if (s === "pts_rebs" || s === "pr" || s === "points_rebounds")
        return "points_rebounds";
    if (s === "pts_asts" || s === "pa" || s === "points_assists")
        return "points_assists";
    if (s === "rebs_asts" || s === "ra" || s === "rebounds_assists")
        return "rebounds_assists";
    if (s === "stocks")
        return "stocks";
    // NFL stats
    if (s === "passing_yards" || s === "pass_yards" || s === "passing yards")
        return "pass_yards";
    if (s === "pass_attempts" || s === "pass attempts")
        return "pass_attempts";
    if (s === "pass_completions" ||
        s === "completions" ||
        s === "pass completions")
        return "pass_completions";
    if (s === "pass_tds" || s === "passing_tds" || s === "pass tds")
        return "pass_tds";
    if (s === "interceptions" || s === "int" || s === "ints")
        return "interceptions";
    if (s === "rushing_yards" || s === "rush_yards" || s === "rush yards")
        return "rush_yards";
    if (s === "rushing_attempts" ||
        s === "rush_attempts" ||
        s === "rush attempts")
        return "rush_attempts";
    if (s === "rushrec_yds" ||
        s === "rushrec yds" ||
        s === "rush+rec yards" ||
        s === "rush_rec_yards")
        return "rush_rec_yards";
    if (s === "receiving_yards" || s === "rec_yards" || s === "receiving yards")
        return "rec_yards";
    if (s === "receptions" || s === "catches")
        return "receptions";
    if (s === "fantasy score")
        return "fantasy_score";
    return null;
}
function buildPlayerMaps(json) {
    const playerMap = new Map();
    const leagueMap = new Map();
    const gameMap = new Map();
    for (const item of json.included || []) {
        if (item.type === "new_player") {
            const first = (item.attributes.first_name || "").toString().trim();
            const last = (item.attributes.last_name || "").toString().trim();
            const nameAttr = (item.attributes.name || "").toString().trim();
            const name = nameAttr || [first, last].filter((x) => x.length > 0).join(" ");
            const team = item.attributes.team ?? null;
            const opponent = item.attributes.opponent ?? null;
            playerMap.set(item.id, { name, team, opponent });
        }
        else if (item.type === "league") {
            const leagueName = (item.attributes.name || "").toString().trim();
            leagueMap.set(item.id, leagueName);
        }
        else if (item.type === "game") {
            const home_team = item.attributes.home_team ?? null;
            const away_team = item.attributes.away_team ?? null;
            gameMap.set(item.id, { home_team, away_team });
        }
    }
    return { playerMap, leagueMap, gameMap };
}
function mapJsonToRawPicks(json) {
    const picks = [];
    const { playerMap, leagueMap, gameMap } = buildPlayerMaps(json);
    for (const proj of json.data) {
        const attr = proj.attributes;
        const stat = mapStatType(attr.stat_type);
        if (!stat)
            continue;
        const line = parseFloat(attr.line_score);
        if (!Number.isFinite(line))
            continue;
        // League: default to "NBA", but use the league relationship when present
        let league = "NBA";
        const leagueRel = proj.relationships.league?.data;
        if (leagueRel && leagueMap.has(leagueRel.id)) {
            league = leagueMap.get(leagueRel.id); // e.g. "NBA", "NFL"
        }
        let player = "Unknown Player";
        let team = null;
        let opponent = null;
        const playerRel = proj.relationships.new_player?.data;
        if (playerRel && playerMap.has(playerRel.id)) {
            const p = playerMap.get(playerRel.id);
            player = p.name || player;
            team = p.team;
            opponent = p.opponent;
        }
        let gameId = null;
        let startTime = null;
        const gameRel = proj.relationships.game?.data;
        if (gameRel && gameMap.has(gameRel.id)) {
            gameId = gameRel.id;
        }
        if (attr.start_time) {
            startTime = attr.start_time;
        }
        // Use real odds_type field, fall back to oddstype if present
        const oddsTypeRaw = (attr.odds_type ?? attr.oddstype ?? "").toString().toLowerCase();
        const isGoblin = oddsTypeRaw === "goblin";
        const isDemon = oddsTypeRaw === "demon";
        const hasExplicitPromoFlag = attr.is_promo === true ||
            attr.ispromo === true ||
            !!attr.promotion_id ||
            (typeof attr.promotion_type === "string" &&
                attr.promotion_type.trim().length > 0);
        const isPromo = hasExplicitPromoFlag || isGoblin || isDemon;
        const pick = {
            site: "prizepicks",
            league,
            player,
            team,
            opponent,
            stat,
            line,
            projectionId: proj.id,
            gameId,
            startTime,
            isDemon,
            isGoblin,
            isPromo,
        };
        picks.push(pick);
    }
    return picks;
}
function loadFromDiskFallback() {
    const filePath = path_1.default.join(process.cwd(), "pp_projections_sample.json");
    try {
        const raw = fs_1.default.readFileSync(filePath, "utf8");
        const json = JSON.parse(raw);
        const picks = mapJsonToRawPicks(json);
        console.log(`fetchPrizePicksRawProps: loaded ${picks.length} RawPick rows from pp_projections_sample.json fallback`);
        return picks;
    }
    catch (err) {
        console.error("fetchPrizePicksRawProps: failed to load pp_projections_sample.json fallback", err);
        return [];
    }
}
async function fetchLeagueProjections(leagueId) {
    const url = `${PRIZEPICKS_PROJECTIONS_BASE_URL}?league_id=${leagueId}&${PRIZEPICKS_COMMON_QUERY}`;
    try {
        const res = await (0, node_fetch_1.default)(url, {
            headers: {
                accept: "application/json",
                "accept-language": "en-US,en;q=0.9",
                "content-type": "application/json",
                origin: "https://app.prizepicks.com",
                referer: "https://app.prizepicks.com/",
                "sec-ch-ua": '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": '"Windows"',
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-site",
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
                "x-device-id": "fdd10fa5-892f-4c4d-b140-d5e8cead14ba",
                "x-device-info": "anonymousId=,name=,os=windows,osVersion=Windows NT 10.0; Win64; x64,platform=web,appVersion=,gameMode=prizepools,stateCode=KY,fbp=fb.1.1768940483859.648114649408665373",
            },
        });
        if (!res.ok) {
            console.error(`fetchLeagueProjections: HTTP ${res.status} from PrizePicks for league_id=${leagueId}`);
            return null;
        }
        const json = (await res.json());
        return json;
    }
    catch (err) {
        console.error(`fetchLeagueProjections: error fetching PrizePicks for league_id=${leagueId}`, err);
        return null;
    }
}
async function fetchPrizePicksRawProps() {
    // Fetch NBA (7) and NFL (9) separately, then combine.
    const [nbaJson, nflJson] = await Promise.all([
        fetchLeagueProjections(7),
        fetchLeagueProjections(9),
    ]);
    if (!nbaJson && !nflJson) {
        console.error("fetchPrizePicksRawProps: no data for NBA or NFL; using fallback if available");
        return loadFromDiskFallback();
    }
    const nbaPicks = nbaJson ? mapJsonToRawPicks(nbaJson) : [];
    const nflPicks = nflJson ? mapJsonToRawPicks(nflJson) : [];
    console.log(`fetchPrizePicksRawProps: nbaPicks=${nbaPicks.length}, nflPicks=${nflPicks.length}`);
    const picks = [...nbaPicks, ...nflPicks];
    try {
        const samplePayload = nbaJson ?? nflJson;
        if (samplePayload) {
            fs_1.default.writeFileSync("pp_projections_sample.json", JSON.stringify(samplePayload, null, 2), "utf8");
            console.log("fetchPrizePicksRawProps: wrote pp_projections_sample.json to project root");
        }
    }
    catch (err) {
        console.error("fetchPrizePicksRawProps: failed to write sample JSON", err);
    }
    console.log(`fetchPrizePicksRawProps: built ${picks.length} RawPick rows from live PrizePicks (NBA+NFL)`);
    return picks;
}
