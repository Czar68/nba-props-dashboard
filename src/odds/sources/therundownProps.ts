// src/odds/sources/therundownProps.ts
// TheRundown v2 API adapter for multi-sport player props as backup odds source

import "dotenv/config";
import fetch from "node-fetch";
import { americanToProb } from "../../odds_math";
import { SgoPlayerPropOdds, StatCategory, Sport } from "../../types";

// Debug logging control
const DEBUG = process.env.DEBUG_THERUNDOWN === "1";

function debugLog(message: string, ...args: any[]): void {
  if (DEBUG) {
    console.log(`[TheRundown DEBUG] ${message}`, ...args);
  }
}

// TheRundown API configuration
const API_BASE = "https://therundown.io/api/v2";

// Sport IDs from TheRundown API documentation
const SPORT_IDS: Record<Sport, number> = {
  'NBA': 4,
  'NFL': 1,
  'MLB': 2,
  'NHL': 6,
  'NCAAF': 3,
  'NCAAB': 5
};

// Book weights for consensus calculation (same as existing)
const BOOK_WEIGHTS: Record<string, number> = {
  "fanduel": 1.0,
  "pinnacle": 0.7,
  "circa": 0.7,
  // All other books get 0.3 weight
};

function getBookWeight(book: string): number {
  return BOOK_WEIGHTS[book.toLowerCase()] || 0.3;
}

// Sport-specific stat mappings from TheRundown market names to our internal stat categories
const SPORT_STAT_MAPPINGS: Record<Sport, Record<string, StatCategory>> = {
  NBA: {
    "Player Points": "points",
    "Player Rebounds": "rebounds",
    "Player Assists": "assists",
    "Player Threes": "threes",
    "Player Blocks": "blocks",
    "Player Steals": "steals",
    "Player Turnovers": "turnovers",
    "Player Points + Rebounds": "pr",
    "Player Points + Assists": "pa",
    "Player Rebounds + Assists": "ra",
    "Player Points + Rebounds + Assists": "pra",
  },
  NHL: {
    "Player Goals": "goals",
    "Player Assists": "assists",
    "Player Points": "points",
    "Player Shots on Goal": "shots_on_goal",
    "Player Saves": "saves",
    "Player Plus/Minus": "plus_minus",
    "Player Penalty Minutes": "penalty_minutes",
    "Player Time on Ice": "time_on_ice",
  },
  NFL: {
    "Player Pass Yards": "pass_yards",
    "Player Pass TDs": "pass_tds",
    "Player Rush Yards": "rush_yards",
    "Player Rec Yards": "rec_yards",
    "Player Receptions": "receptions",
  },
  MLB: {
    // Baseball stats would go here
  },
  NCAAB: {
    "Player Points": "points",
    "Player Rebounds": "rebounds",
    "Player Assists": "assists",
    "Player Threes": "threes",
  },
  NCAAF: {
    // College football stats would go here
  }
};

// Statistical utilities (same as existing consensus logic)
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function mad(values: number[]): number {
  const med = median(values);
  return median(values.map(v => Math.abs(v - med)));
}

// Interface for TheRundown API responses
interface TheRundownEvent {
  event_id: string;
  sport_id: number;
  event_name: string;
  start_date: string;
}

interface TheRundownOdds {
  market_name: string;
  line: number;
  odds: number;
  bookmaker_key: string;
}

interface TheRundownPlayerOdds {
  player_name: string;
  odds: TheRundownOdds[];
}

interface TheRundownResponse {
  events: TheRundownEvent[];
  odds: TheRundownPlayerOdds[];
}

// Main function to fetch player props from TheRundown for multiple sports
export async function getPlayerPropsFromTheRundown(sports: Sport[] = ['NBA']): Promise<SgoPlayerPropOdds[]> {
  const apiKey = process.env.THERUNDOWN_API_KEY;
  
  if (!apiKey) {
    console.warn("getPlayerPropsFromTheRundown: missing THERUNDOWN_API_KEY, returning []");
    return [];
  }

  const allResults: SgoPlayerPropOdds[] = [];

  for (const sport of sports) {
    const sportId = SPORT_IDS[sport];
    if (!sportId) {
      debugLog(`No sport_id mapping for ${sport}, skipping`);
      continue;
    }

    debugLog(`Fetching ${sport} player props (sport_id: ${sportId})`);
    
    try {
      const sportResults = await fetchSportPlayerProps(sport, sportId, apiKey);
      allResults.push(...sportResults);
    } catch (error) {
      debugLog(`Error fetching ${sport} props:`, error);
      console.error(`getPlayerPropsFromTheRundown: Error fetching ${sport} props:`, error);
    }
  }

  debugLog(`Total combined results: ${allResults.length} player prop markets`);
  return allResults;
}

async function fetchSportPlayerProps(sport: Sport, sportId: number, apiKey: string): Promise<SgoPlayerPropOdds[]> {
  // Fetch events for the sport
  const eventsUrl = `${API_BASE}/sports/${sportId}/events`;
  console.log(`[TheRundown] Calling: ${eventsUrl}`);
  const eventsResponse = await fetch(eventsUrl, {
    headers: {
      "x-api-key": apiKey,
    },
  });

  if (!eventsResponse.ok) {
    if (eventsResponse.status === 404) {
      console.log(`[TheRundown] 404 = No events for ${sport} (sport_id=${sportId}) - may be no games scheduled`);
    }
    throw new Error(`Events API failed: ${eventsResponse.status} ${eventsResponse.statusText}`);
  }

  const eventsData = await eventsResponse.json() as TheRundownEvent[];
  debugLog(`Found ${eventsData.length} ${sport} events`);

  if (eventsData.length === 0) {
    return [];
  }

  // Fetch odds for all events
  const eventIds = eventsData.map((e: TheRundownEvent) => e.event_id).join(',');
  const oddsUrl = `${API_BASE}/events/${eventIds}/odds`;
  const oddsResponse = await fetch(oddsUrl, {
    headers: {
      "x-api-key": apiKey,
    },
  });

  if (!oddsResponse.ok) {
    throw new Error(`Odds API failed: ${oddsResponse.status} ${oddsResponse.statusText}`);
  }

  const oddsData = await oddsResponse.json() as TheRundownResponse;
  debugLog(`Found ${oddsData.odds.length} ${sport} player odds entries`);

  return processTheRundownOdds(sport, eventsData, oddsData.odds);
}

function processTheRundownOdds(
  sport: Sport, 
  events: TheRundownEvent[], 
  odds: TheRundownPlayerOdds[]
): SgoPlayerPropOdds[] {
  const statMapping = SPORT_STAT_MAPPINGS[sport];
  if (!statMapping) {
    debugLog(`No stat mapping for ${sport}, skipping processing`);
    return [];
  }

  // Create event lookup
  const eventMap = new Map(events.map(e => [e.event_id, e]));

  const results: SgoPlayerPropOdds[] = [];

  for (const playerOdds of odds) {
    // Group odds by market and line for consensus calculation
    const marketGroups = new Map<string, TheRundownOdds[]>();
    
    for (const odd of playerOdds.odds) {
      const mappedStat = statMapping[odd.market_name];
      if (!mappedStat) {
        debugLog(`Unknown market: ${odd.market_name} for ${sport}`);
        continue;
      }

      const key = `${mappedStat}_${odd.line}`;
      if (!marketGroups.has(key)) {
        marketGroups.set(key, []);
      }
      marketGroups.get(key)!.push(odd);
    }

    // Process each market group to create consensus odds
    for (const [marketKey, marketOdds] of marketGroups) {
      if (marketOdds.length < 2) {
        debugLog(`Skipping ${marketKey}: only ${marketOdds.length} book(s)`);
        continue;
      }

      const [statType, lineStr] = marketKey.split('_');
      const line = parseFloat(lineStr);
      const stat = statType as StatCategory;

      // Calculate consensus using median and MAD
      const overOdds = marketOdds.map(o => o.odds);
      const underOdds = marketOdds.map(o => -o.odds); // Convert to under odds

      const medianOver = median(overOdds);
      const medianUnder = median(underOdds);
      const madOver = mad(overOdds);
      const madUnder = mad(underOdds);

      // Filter outliers using MAD (same as existing logic)
      const filteredOver = marketOdds.filter(o => Math.abs(o.odds - medianOver) <= 2 * madOver);
      const filteredUnder = marketOdds.filter(o => Math.abs(-o.odds - medianUnder) <= 2 * madUnder);

      // Calculate weighted averages
      let finalOverOdds = 0;
      let finalUnderOdds = 0;
      let totalWeight = 0;

      for (const odd of marketOdds) {
        const weight = getBookWeight(odd.bookmaker_key);
        finalOverOdds += odd.odds * weight;
        finalUnderOdds += -odd.odds * weight;
        totalWeight += weight;
      }

      if (totalWeight > 0) {
        finalOverOdds /= totalWeight;
        finalUnderOdds /= totalWeight;
      }

      // Find the event for this player (use first event as fallback)
      const event = events[0]; // Simplified - in full implementation would match player to specific event

      const result: SgoPlayerPropOdds = {
        sport,
        player: playerOdds.player_name,
        team: null, // TheRundown doesn't provide team in this endpoint
        opponent: null,
        league: sport,
        stat,
        line,
        overOdds: Math.round(finalOverOdds),
        underOdds: Math.round(finalUnderOdds),
        book: "consensus",
        eventId: event?.event_id || null,
        marketId: null,
        selectionIdOver: null,
        selectionIdUnder: null,
      };

      results.push(result);
      debugLog(`Created consensus for ${playerOdds.player_name} ${stat} ${line}: ${finalOverOdds}/${finalUnderOdds}`);
    }
  }

  debugLog(`Processed ${results.length} ${sport} player prop markets`);
  return results;
}

// Backward compatibility function for NBA
export async function getNbaPlayerPropsFromTheRundown(): Promise<SgoPlayerPropOdds[]> {
  return getPlayerPropsFromTheRundown(['NBA']);
}
