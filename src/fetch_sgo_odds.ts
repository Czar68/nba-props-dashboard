// src/fetch_sgo_odds.ts

import "dotenv/config";
import SportsGameOdds from "sports-odds-api";
import { SgoPlayerPropOdds, StatCategory, Sport } from "./types";

const PREFERRED_BOOKS = [
  "fanduel",
  "draftkings",
  "caesars",
  "betmgm",
  "espn_bet",
  "pointsbet",
];

type BookmakerRecord = Record<string, any> | undefined;

// Map league IDs to Sport types
function mapLeagueToSport(leagueID: string): Sport {
  const leagueUpper = leagueID.toUpperCase();
  
  // NBA leagues
  if (leagueUpper === 'NBA' || leagueUpper.includes('BASKETBALL')) {
    return 'NBA';
  }
  
  // NFL leagues
  if (leagueUpper === 'NFL' || leagueUpper.includes('FOOTBALL')) {
    return 'NFL';
  }
  
  // MLB leagues
  if (leagueUpper === 'MLB' || leagueUpper.includes('BASEBALL')) {
    return 'MLB';
  }
  
  // NHL leagues
  if (leagueUpper === 'NHL' || leagueUpper.includes('HOCKEY')) {
    return 'NHL';
  }
  
  // College leagues
  if (leagueUpper === 'NCAAB' || leagueUpper.includes('COLLEGE BASKETBALL')) {
    return 'NCAAB';
  }
  
  if (leagueUpper === 'NCAAF' || leagueUpper.includes('COLLEGE FOOTBALL')) {
    return 'NCAAF';
  }
  
  // Default to NBA for unknown leagues
  return 'NBA';
}

function pickBestBookmaker(
  byBookmaker: BookmakerRecord
): { bookmakerID: string; data: any } | null {
  if (!byBookmaker) return null;

  // Prefer a known sharp book first
  for (const book of PREFERRED_BOOKS) {
    const data = (byBookmaker as any)[book];
    if (data && data.available !== false && data.odds != null) {
      return { bookmakerID: book, data };
    }
  }

  // Fallback: choose the available book with best (highest) American odds
  let best: { bookmakerID: string; data: any } | null = null;
  let bestVal = -Infinity;

  for (const [bookmakerID, data] of Object.entries(byBookmaker)) {
    if (!data || (data as any).available === false || (data as any).odds == null)
      continue;
    const val = Number((data as any).odds);
    if (Number.isNaN(val)) continue;
    if (val > bestVal) {
      bestVal = val;
      best = { bookmakerID, data };
    }
  }

  return best;
}

// Map SGO statID → internal StatCategory for NBA + NFL
function mapSgoStatIdToCategory(
  statID: string,
  leagueID: string
): StatCategory | null {
  const key = statID.toLowerCase();
  const league = leagueID.toUpperCase();

  // NBA stats (points etc. per SGO NBA props docs)[web:6]
  if (league === "NBA") {
    if (key === "points") return "points";
    if (key === "rebounds") return "rebounds";
    if (key === "assists") return "assists";
    if (key === "pra" || key === "points_rebounds_assists") return "pra";
    if (key === "points_rebounds" || key === "points+rebounds" || key === "pr") {
      return "points_rebounds";
    }
    if (key === "points_assists" || key === "points+assists" || key === "pa") {
      return "points_assists";
    }
    if (
      key === "rebounds_assists" ||
      key === "rebounds+assists" ||
      key === "ra"
    ) {
      return "rebounds_assists";
    }
    if (
      key === "threepointersmade" ||
      key === "3pt_made" ||
      key === "3pm" ||
      key === "threes"
    ) {
      return "threes";
    }
    if (key === "blocks" || key === "blk") return "blocks";
    if (key === "steals" || key === "stl") return "steals";
    if (key === "stocks" || key === "steals+blocks") return "stocks";
    if (key === "turnovers" || key === "to") return "turnovers";
    if (
      key === "fantasyscore" ||
      key === "fantasy_score" ||
      key === "fantasy_points"
    ) {
      return "fantasy_score";
    }
  }

  // NFL stats (receiving_yards, rushing_attempts, passing_yards, etc.)[web:1]
  if (league === "NFL") {
    if (key === "passing_yards") return "pass_yards";
    if (key === "passing_attempts") return "pass_attempts";
    if (key === "passing_completions") return "pass_completions";
    if (key === "passing_touchdowns") return "pass_tds";
    if (key === "passing_interceptions") return "interceptions";
    if (key === "rushing_yards") return "rush_yards";
    if (key === "rushing_attempts") return "rush_attempts";
    if (key === "rushing+receiving_yards") return "rush_rec_yards";
    if (key === "receiving_yards") return "rec_yards";
    if (key === "receiving_receptions") return "receptions";
  }

  // NHL stats
  if (league === "NHL") {
    if (key === "points") return "points";
    if (key === "goals") return "goals";
    if (key === "assists") return "assists";
    if (key === "shots_on_goal" || key === "shots" || key === "sog") return "shots_on_goal";
    if (key === "saves") return "saves";
    if (key === "goals_against" || key === "goalsagainst") return "goals_against";
    if (key === "blocked_shots" || key === "blocks") return "blocks";
  }

  // MLB stats
  if (league === "MLB") {
    if (key === "hits") return "points";
    if (key === "strikeouts" || key === "pitcher_strikeouts") return "blocks";
    if (key === "total_bases") return "rebounds";
  }

  return null;
}

async function fetchLeaguePlayerProps(
  client: any,
  leagueID: "NBA" | "NFL" | "NHL" | "MLB"
): Promise<SgoPlayerPropOdds[]> {
  const results: SgoPlayerPropOdds[] = [];

  const page = await client.events.get({
    leagueID,
    finalized: false,
    oddsAvailable: true,
    limit: 50,
  });

  const events = (page as any).data ?? [];
  // eslint-disable-next-line no-console
  console.log(
    `fetchSgoPlayerPropOdds: ${leagueID} events length`,
    events.length
  );

  type Acc = Map<
    string,
    SgoPlayerPropOdds & { overOdds: number; underOdds: number }
  >;

  const byPlayerAndStat: Acc = new Map();

  for (const event of events) {
    const odds = (event as any).odds as Record<string, any> | undefined;
    if (!odds) continue;

    const league: string = (event as any).leagueID ?? leagueID;
    const eventId: string | null = (event as any).eventID ?? null;
    const homeTeam: string | null = (event as any).homeTeamID ?? null;
    const awayTeam: string | null = (event as any).awayTeamID ?? null;

    for (const odd of Object.values(odds)) {
      if (!odd) continue;

      const statEntityID: string | undefined = (odd as any).statEntityID;
      if (!statEntityID) continue;

      // Skip team-level odds, not player props
      if (
        statEntityID === "all" ||
        statEntityID === "home" ||
        statEntityID === "away"
      ) {
        continue;
      }

      const statID: string | undefined = (odd as any).statID;
      const betTypeID: string | undefined = (odd as any).betTypeID;
      const periodID: string | undefined = (odd as any).periodID;
      const sideID: string | undefined = (odd as any).sideID;

      // Only full-game player prop over/under
      if (betTypeID !== "ou") continue;
      if (periodID !== "game") continue;
      if (sideID !== "over" && sideID !== "under") continue;

      if (!statID) continue;
      const statCategory = mapSgoStatIdToCategory(statID, league);
      if (!statCategory) continue;

      const best = pickBestBookmaker(
        (odd as any).byBookmaker as Record<string, any> | undefined
      );
      if (!best) continue;
      const { bookmakerID, data } = best;

      const lineRaw = (data as any).overUnder;
      const oddsRaw = (data as any).odds;
      const line = Number(lineRaw);
      const price = Number(oddsRaw);
      if (!Number.isFinite(line) || !Number.isFinite(price)) continue;

      const key = `${statEntityID}::${statCategory}`;
      let existing = byPlayerAndStat.get(key);

      if (!existing) {
        existing = {
          sport: mapLeagueToSport(league),
          player: statEntityID, // raw ID; mapped later in merge step
          team: null,
          opponent: null,
          league,
          stat: statCategory,
          line,
          overOdds: Number.NaN,
          underOdds: Number.NaN,
          book: bookmakerID,
          eventId,
          marketId: null,
          selectionIdOver: null,
          selectionIdUnder: null,
        };
        byPlayerAndStat.set(key, existing);
      }

      if (!Number.isFinite(existing.line)) {
        existing.line = line;
      }

      if (sideID === "over") {
        existing.overOdds = price;
      } else if (sideID === "under") {
        existing.underOdds = price;
      }

      if (!existing.team && homeTeam && awayTeam) {
        existing.team = homeTeam;
        existing.opponent = awayTeam;
      }
    }
  }

  const filtered: SgoPlayerPropOdds[] = Array.from(
    byPlayerAndStat.values()
  ).filter(
    (p) =>
      Number.isFinite(p.line) &&
      Number.isFinite(p.overOdds) &&
      Number.isFinite(p.underOdds)
  );

  results.push(...filtered);

  // eslint-disable-next-line no-console
  console.log(
    `fetchSgoPlayerPropOdds: returning ${filtered.length} ${leagueID} player prop markets from SGO`
  );

  return results;
}

export async function fetchSgoPlayerPropOdds(sports: Sport[] = ['NBA']): Promise<SgoPlayerPropOdds[]> {
  const apiKey = process.env.SGO_API_KEY ?? process.env.SGOAPIKEY;
  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.warn("fetchSgoPlayerPropOdds: missing SGOAPIKEY, returning []");
    return [];
  }

  const client = new SportsGameOdds({ apiKeyParam: apiKey });

  const results: SgoPlayerPropOdds[] = [];

  // Map sports to SGO league IDs
  const sportToLeagueMap: Record<Sport, string> = {
    'NBA': 'NBA',
    'NFL': 'NFL',
    'NHL': 'NHL',
    'MLB': 'MLB',
    'NCAAB': 'NCAAB',
    'NCAAF': 'NCAAF'
  };

  // Filter to supported leagues for the requested sports
  const leagues = sports
    .map(sport => sportToLeagueMap[sport])
    .filter((league): league is "NBA" | "NFL" | "NHL" | "MLB" => 
      ["NBA", "NFL", "NHL", "MLB"].includes(league)
    );

  console.log(`fetchSgoPlayerPropOdds: fetching leagues [${leagues.join(', ')}] for sports [${sports.join(', ')}]`);

  for (const league of leagues) {
    try {
      const leagueResults = await fetchLeaguePlayerProps(client, league);
      results.push(...leagueResults);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`fetchSgoPlayerPropOdds: error calling SGO SDK for ${league}`, err);
    }
  }

  return results;
}
