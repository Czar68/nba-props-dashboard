// src/fetch_props.ts

import fetch from "node-fetch";
import fs from "fs";
import path from "path";

import { RawPick, StatCategory } from "./types";

const PRIZEPICKS_NBA_LEAGUE_ID = 7;

const PRIZEPICKS_PROJECTIONS_URL =
  "https://api.prizepicks.com/projections" +
  `?league_id=${PRIZEPICKS_NBA_LEAGUE_ID}` +
  "&per_page=250&single_stat=true&game_mode=pickem";

interface PrizePicksProjectionAttributes {
  line_score: string;
  stat_type: string;
  projection_type: string;
  description: string | null;
  league_id: number;
  created_at: string;
  updated_at: string;
  start_time: string | null;
  game_id: string | null;

  // Actual promo / oddstype fields in your JSON
  odds_type?: string | null; // "goblin", "demon", "standard"
  is_promo?: boolean;

  // Keep older names too, in case PrizePicks uses both
  oddstype?: string | null;
  ispromo?: boolean;

  promotion_id?: number | null;
  promotion_type?: string | null;

  [key: string]: unknown;
}

interface PrizePicksProjection {
  id: string;
  type: "projection";
  attributes: PrizePicksProjectionAttributes;
  relationships: {
    new_player?: {
      data: { id: string; type: "new_player" } | null;
    };
    league?: {
      data: { id: string; type: "league" } | null;
    };
    game?: {
      data: { id: string; type: "game" } | null;
    };
  };
}

interface PrizePicksIncludedItemAttributes {
  name?: string;
  first_name?: string;
  last_name?: string;
  league_id?: number;
  team?: string | null;
  opponent?: string | null;
  home_team?: string | null;
  away_team?: string | null;
  [key: string]: unknown;
}

interface PrizePicksIncludedItem {
  id: string;
  type: "new_player" | "league" | "game";
  attributes: PrizePicksIncludedItemAttributes;
}

interface PrizePicksProjectionsResponse {
  data: PrizePicksProjection[];
  included: PrizePicksIncludedItem[];
}

function mapStatType(statTypeRaw: string): StatCategory | null {
  const s = statTypeRaw.toLowerCase();

  if (s === "points" || s === "pts") return "points";
  if (s === "rebounds" || s === "rebs") return "rebounds";
  if (s === "assists" || s === "asts") return "assists";
  if (s === "threes" || s === "three_pointers_made" || s === "3pt_made")
    return "threes";
  if (s === "blocks" || s === "blk") return "blocks";
  if (s === "steals" || s === "stl") return "steals";
  if (s === "turnovers") return "turnovers";
  if (s === "fantasy_score" || s === "fantasy") return "fantasy_score";
  if (s === "pts_rebs_asts" || s === "pra" || s === "points_rebounds_assists")
    return "pra";
  if (s === "pts_rebs" || s === "pr" || s === "points_rebounds")
    return "points_rebounds";
  if (s === "pts_asts" || s === "pa" || s === "points_assists")
    return "points_assists";
  if (s === "rebs_asts" || s === "ra" || s === "rebounds_assists")
    return "rebounds_assists";
  if (s === "stocks") return "stocks";

  return null;
}

function buildPlayerMaps(
  json: PrizePicksProjectionsResponse
): {
  playerMap: Map<string, { name: string; team: string | null; opponent: string | null }>;
  leagueMap: Map<string, string>;
  gameMap: Map<string, { home_team: string | null; away_team: string | null }>;
} {
  const playerMap = new Map<
    string,
    { name: string; team: string | null; opponent: string | null }
  >();
  const leagueMap = new Map<string, string>();
  const gameMap = new Map<
    string,
    { home_team: string | null; away_team: string | null }
  >();

  for (const item of json.included || []) {
    if (item.type === "new_player") {
      const first = (item.attributes.first_name || "").toString().trim();
      const last = (item.attributes.last_name || "").toString().trim();
      const nameAttr = (item.attributes.name || "").toString().trim();
      const name =
        nameAttr || [first, last].filter((x) => x.length > 0).join(" ");

      const team =
        (item.attributes.team as string | null | undefined) ?? null;
      const opponent =
        (item.attributes.opponent as string | null | undefined) ?? null;

      playerMap.set(item.id, { name, team, opponent });
    } else if (item.type === "league") {
      const leagueName = (item.attributes.name || "").toString().trim();
      leagueMap.set(item.id, leagueName);
    } else if (item.type === "game") {
      const home_team =
        (item.attributes.home_team as string | null | undefined) ?? null;
      const away_team =
        (item.attributes.away_team as string | null | undefined) ?? null;
      gameMap.set(item.id, { home_team, away_team });
    }
  }

  return { playerMap, leagueMap, gameMap };
}

function mapJsonToRawPicks(json: PrizePicksProjectionsResponse): RawPick[] {
  const picks: RawPick[] = [];

  const { playerMap, leagueMap, gameMap } = buildPlayerMaps(json);

  for (const proj of json.data) {
    const attr = proj.attributes;

    const stat = mapStatType(attr.stat_type);
    if (!stat) continue;

    const line = parseFloat(attr.line_score);
    if (!Number.isFinite(line)) continue;

    let league = "NBA";
    const leagueRel = proj.relationships.league?.data;
    if (leagueRel && leagueMap.has(leagueRel.id)) {
      league = leagueMap.get(leagueRel.id)!;
    }

    let player = "Unknown Player";
    let team: string | null = null;
    let opponent: string | null = null;

    const playerRel = proj.relationships.new_player?.data;
    if (playerRel && playerMap.has(playerRel.id)) {
      const p = playerMap.get(playerRel.id)!;
      player = p.name || player;
      team = p.team;
      opponent = p.opponent;
    }

    let gameId: string | null = null;
    let startTime: string | null = null;

    const gameRel = proj.relationships.game?.data;
    if (gameRel && gameMap.has(gameRel.id)) {
      gameId = gameRel.id;
    }
    if (attr.start_time) {
      startTime = attr.start_time;
    }

    // Use real odds_type field, fall back to oddstype if present
    const oddsTypeRaw =
      (attr.odds_type ?? attr.oddstype ?? "").toString().toLowerCase();
    const isGoblin = oddsTypeRaw === "goblin";
    const isDemon = oddsTypeRaw === "demon";

    const hasExplicitPromoFlag =
      attr.is_promo === true ||
      attr.ispromo === true ||
      !!attr.promotion_id ||
      (typeof attr.promotion_type === "string" &&
        attr.promotion_type.trim().length > 0);

    const isPromo = hasExplicitPromoFlag || isGoblin || isDemon;

    const pick: RawPick = {
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

function loadFromDiskFallback(): RawPick[] {
  const filePath = path.join(process.cwd(), "pp_projections_sample.json");
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const json = JSON.parse(raw) as PrizePicksProjectionsResponse;

    const picks = mapJsonToRawPicks(json);

    console.log(
      `fetchPrizePicksRawProps: loaded ${picks.length} RawPick rows from pp_projections_sample.json fallback`
    );

    return picks;
  } catch (err) {
    console.error(
      "fetchPrizePicksRawProps: failed to load pp_projections_sample.json fallback",
      err
    );
    return [];
  }
}

export async function fetchPrizePicksRawProps(): Promise<RawPick[]> {
  let json: PrizePicksProjectionsResponse | null = null;

  try {
    const res = await fetch(PRIZEPICKS_PROJECTIONS_URL, {
      headers: {
        accept: "application/json, text/plain, */*",
        origin: "https://www.prizepicks.com",
        referer: "https://www.prizepicks.com/",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    if (!res.ok) {
      console.error(
        `fetchPrizePicksRawProps: HTTP ${res.status} from PrizePicks`
      );
      // On 403 or other error, fall back to local JSON
      return loadFromDiskFallback();
    }

    json = (await res.json()) as PrizePicksProjectionsResponse;

    // Optionally refresh the sample file with the latest live payload
    try {
      fs.writeFileSync(
        "pp_projections_sample.json",
        JSON.stringify(json, null, 2),
        "utf8"
      );
      console.log(
        "fetchPrizePicksRawProps: wrote pp_projections_sample.json to project root"
      );
    } catch (err) {
      console.error(
        "fetchPrizePicksRawProps: failed to write sample JSON",
        err
      );
    }
  } catch (err) {
    console.error("fetchPrizePicksRawProps: error fetching PrizePicks", err);
    return loadFromDiskFallback();
  }

  if (!json || !Array.isArray(json.data) || json.data.length === 0) {
    console.error(
      "fetchPrizePicksRawProps: no data in PrizePicks response; using fallback if available"
    );
    return loadFromDiskFallback();
  }

  const picks = mapJsonToRawPicks(json);

  console.log(
    `fetchPrizePicksRawProps: built ${picks.length} RawPick rows from live PrizePicks`
  );

  return picks;
}
