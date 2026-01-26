// src/fetch_underdog_props.ts
import fetch from "node-fetch";
import { RawPick, StatCategory } from "./types";

const UD_PICKEM_URL =
  "https://api.underdogfantasy.com/beta/v5/over_under_lines";

const UD_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.google.com/",
  Accept: "application/json",
};

interface UnderdogApiResponse {
  over_under_lines: UnderdogLine[];
}

interface UnderdogLine {
  id: number | string;
  over_under: {
    id: number | string;
    stat_type: string;
    picked_player: {
      id: number | string;
      name: string;
      team?: string | null;
      opponent?: string | null;
    };
    line: number;
    game: {
      id: number | string;
      sport: string;
      start_time: string;
      home_team?: string | null;
      away_team?: string | null;
    };
  };
}

// Map Underdog's stat_type strings into your StatCategory union
function mapStatType(statType: string): StatCategory {
  const key = statType.toLowerCase();

  if (key === "points" || key === "pts") return "points";
  if (key === "rebounds" || key === "rebs") return "rebounds";
  if (key === "assists" || key === "asts") return "assists";

  if (key === "points_rebounds_assists" || key === "pra") return "pra";
  if (key === "points_rebounds" || key === "pr") return "points_rebounds";
  if (key === "points_assists" || key === "pa") return "points_assists";
  if (key === "rebounds_assists" || key === "ra") return "rebounds_assists";

  if (
    key === "three_pointers_made" ||
    key === "three_pointers" ||
    key === "threes"
  )
    return "threes";

  if (key === "blocks") return "blocks";
  if (key === "steals") return "steals";
  if (key === "blocks_steals" || key === "stocks") return "stocks";

  if (key === "turnovers") return "turnovers";

  if (key === "fantasy" || key === "fantasy_score") return "fantasy_score";

  // Fallback: treat unknown stat types as points so we don't break the pipeline.
  return "points";
}

export async function fetchUnderdogRawProps(): Promise<RawPick[]> {
  const res = await fetch(UD_PICKEM_URL, {
    method: "GET",
    headers: UD_HEADERS,
  });

  if (!res.ok) {
    throw new Error(`Underdog API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as UnderdogApiResponse;

  const picks: RawPick[] = [];

  for (const line of data.over_under_lines || []) {
    const ou = line.over_under;
    if (!ou || !ou.game || !ou.picked_player) continue;

    const leagueKey = ou.game.sport?.toLowerCase();
    if (leagueKey !== "nba") continue;

    const playerName = ou.picked_player.name?.trim();
    if (!playerName) continue;

    const stat: StatCategory = mapStatType(ou.stat_type);
    const lineValue = ou.line;

    const league = "NBA";
    const team = ou.game.home_team || ou.picked_player.team || "";
    const opponent = ou.game.away_team || ou.picked_player.opponent || "";
    const startTime = ou.game.start_time;

    const rawPick: RawPick = {
      site: "underdog",
      league,
      player: playerName,
      team,
      opponent,
      stat,
      line: lineValue,
      projectionId: String(ou.id),
      gameId: String(ou.game.id),
      startTime,
      isDemon: false,
      isGoblin: false,
      isPromo: false,
    };

    picks.push(rawPick);
  }

  return picks;
}
