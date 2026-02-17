// src/merge_odds.ts

import {
  RawPick,
  MergedPick,
  SgoPlayerPropOdds,
  StatCategory,
  Sport,
} from "./types";
import { americanToProb, devigTwoWay, probToAmerican } from "./odds_math";
import { fetchSgoPlayerPropOdds } from "./fetch_sgo_odds";
import { getPlayerPropsFromTheRundown } from "./odds/sources/therundownProps";
import { oddsCache, OddsFetchConfig, OddsCache } from "./odds_cache";
import { cliArgs } from "./cli_args";

// Interface for odds source metadata
export interface OddsSourceMetadata {
  isFromCache: boolean;
  providerUsed: "SGO" | "TheRundown" | "none";
  fetchedAt?: string; // ISO timestamp if fresh
  originalProvider?: string; // For cached odds, shows original provider
}

// NOTE: Fantasy support modules (fantasy.ts, fantasy_analyzer.ts) are already
// implemented and can be re‑enabled for EV/fantasy workflows once you have
// independent projections / historical data wired in. For now, fantasy props
// are explicitly excluded from the EV legs/cards flow.

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

// Convert SGO player IDs like "KEVIN_DURANT_1_NBA" -> "kevin durant"
function normalizeSgoPlayerId(id: string): string {
  const parts = id.split("_");
  if (parts.length <= 2) {
    return normalizeName(id);
  }
  // Drop number + league suffix
  const nameParts = parts.slice(0, -2);
  return normalizeName(nameParts.join(" "));
}

// Max allowed difference between SGO line and PrizePicks/UD line
const MAX_LINE_DIFF = 3; // points/yards/etc.

// Max allowed absolute juice magnitude (ignore prices worse than -250)
const MAX_JUICE = 150;

function isJuiceTooExtreme(american: number): boolean {
  // american is negative for favorites, positive for dogs.
  // We only care about steep negative favorites here.
  return american <= -MAX_JUICE;
}

function findBestMatchForPick(
  pick: RawPick,
  sgoMarkets: SgoPlayerPropOdds[]
): SgoPlayerPropOdds | null {
  const targetName = normalizeName(pick.player);

  const candidates = sgoMarkets.filter((o) => {
    const sgoName = normalizeSgoPlayerId(o.player);
    return (
      sgoName === targetName &&
      o.stat === pick.stat &&
      o.sport === pick.sport && // Ensure sport matches
      o.league.toUpperCase() === pick.league.toUpperCase()
    );
  });

  if (!candidates.length) return null;

  let best = candidates[0];
  let bestDiff = Math.abs(best.line - pick.line);

  for (const c of candidates.slice(1)) {
    const diff = Math.abs(c.line - pick.line);
    if (diff < bestDiff) {
      best = c;
      bestDiff = diff;
    }
  }

  // Reject if book line and PP line are too far apart
  if (bestDiff > MAX_LINE_DIFF) return null;

  // Reject if juice is extreme on either side
  if (typeof best.overOdds === "number" && isJuiceTooExtreme(best.overOdds)) {
    return null;
  }
  if (typeof best.underOdds === "number" && isJuiceTooExtreme(best.underOdds)) {
    return null;
  }

  return best;
}

export async function mergeOddsWithProps(
  rawPicks: RawPick[]
): Promise<MergedPick[]> {
  const result = await mergeOddsWithPropsWithMetadata(rawPicks);
  return result.odds;
}

export async function mergeOddsWithPropsWithMetadata(
  rawPicks: RawPick[]
): Promise<{ odds: MergedPick[]; metadata: OddsSourceMetadata }> {
  // Extract unique sports from rawPicks
  const uniqueSports = [...new Set(rawPicks.map(pick => pick.sport))];
  console.log(`mergeOddsWithProps: processing sports [${uniqueSports.join(', ')}] from ${rawPicks.length} raw picks`);
  
  // Debug: show per-sport counts
  const debug = process.env.DEBUG_MERGE === "1";
  if (debug) {
    const sportCounts = uniqueSports.reduce((acc, sport) => {
      acc[sport] = rawPicks.filter(pick => pick.sport === sport).length;
      return acc;
    }, {} as Record<Sport, number>);
    
    console.log(`mergeOddsWithProps: per-sport raw pick counts:`, 
      Object.entries(sportCounts).map(([sport, count]) => `${sport}=${count}`).join(', ')
    );
  }
  
  // Build fetch configuration from CLI args
  const config: OddsFetchConfig = {
    noFetch: cliArgs.noFetchOdds,
    forceRefresh: cliArgs.forceRefreshOdds,
    refreshIntervalMinutes: cliArgs.refreshIntervalMinutes,
  };

  // Get odds (from cache or fresh fetch)
  let sgoMarkets: SgoPlayerPropOdds[] = [];
  let metadata: OddsSourceMetadata = {
    isFromCache: false,
    providerUsed: "none"
  };
  
  // Check cache first (unless force refresh)
  if (!config.forceRefresh) {
    const cachedEntry = oddsCache.getCachedOddsEntry(config);
    if (cachedEntry) {
      console.log(`mergeOddsWithProps: Using ${cachedEntry.data.length} cached odds`);
      metadata = {
        isFromCache: true,
        providerUsed: cachedEntry.data.length > 0 ? "SGO" : "none", // Assume cached odds came from SGO
        fetchedAt: cachedEntry.fetchedAt,
        originalProvider: cachedEntry.source
      };
      // Convert cached MergedPick back to SgoPlayerPropOdds for matching
      sgoMarkets = cachedEntry.data.map(m => ({
        sport: "NBA",
        player: m.player,
        team: m.team,
        opponent: m.opponent,
        league: m.league,
        stat: m.stat,
        line: m.line,
        overOdds: m.overOdds,
        underOdds: m.underOdds,
        book: m.book,
        eventId: m.gameId,
        marketId: null,
        selectionIdOver: null,
        selectionIdUnder: null,
      }));
    }
  }

  // If no-fetch mode and no valid cache, exit early
  if (config.noFetch && sgoMarkets.length === 0) {
    console.log("mergeOddsWithProps: --no-fetch-odds specified and no valid cache available");
    return { odds: [], metadata };
  }

  // Fetch fresh odds if needed
  if (sgoMarkets.length === 0) {
    console.log("mergeOddsWithProps: Fetching fresh odds from APIs...");
    const freshResult = await fetchFreshOdds(uniqueSports);
    
    if (freshResult.odds.length === 0) {
      console.log("mergeOddsWithProps: No fresh odds available, returning empty result");
      return { odds: [], metadata };
    }

    // Update metadata for fresh odds
    metadata = {
      isFromCache: false,
      providerUsed: freshResult.providerUsed,
      fetchedAt: new Date().toISOString()
    };

    // Convert fresh MergedPick back to SgoPlayerPropOdds for matching
    sgoMarkets = freshResult.odds.map(m => ({
      sport: "NBA",
      player: m.player,
      team: m.team,
      opponent: m.opponent,
      league: m.league,
      stat: m.stat,
      line: m.line,
      overOdds: m.overOdds,
      underOdds: m.underOdds,
      book: m.book,
      eventId: m.gameId,
      marketId: null,
      selectionIdOver: null,
      selectionIdUnder: null,
    }));
  }

  // Now perform the actual merging of raw picks with odds
  console.log(`mergeOddsWithProps: Merging ${rawPicks.length} raw picks with ${sgoMarkets.length} markets`);
  
  const merged: MergedPick[] = [];

  for (const pick of rawPicks) {
    // Promo guard – harmless until you add more nuanced behavior
    const anyPick = pick as any;
    if (anyPick.isDemon || anyPick.isGoblin || anyPick.isPromo) {
      continue;
    }

    // Explicitly exclude fantasy props from EV legs/cards for now.
    if (pick.stat === "fantasy_score") {
      continue;
    }

    const match = findBestMatchForPick(pick, sgoMarkets);
    if (!match) continue;

    const overProbVigged = americanToProb(match.overOdds);
    const underProbVigged = americanToProb(match.underOdds);
    const [trueOverProb, trueUnderProb] = devigTwoWay(
      overProbVigged,
      underProbVigged
    );

    const fairOverOdds = probToAmerican(trueOverProb);
    const fairUnderOdds = probToAmerican(trueUnderProb);

    merged.push({
      ...pick,
      book: match.book,
      overOdds: match.overOdds,
      underOdds: match.underOdds,
      trueProb: trueOverProb,
      fairOverOdds,
      fairUnderOdds,
    });
  }

  console.log(`mergeOddsWithProps: Produced ${merged.length} merged picks`);
  
  // Debug: show per-sport merged counts
  if (debug && merged.length > 0) {
    const mergedSportCounts = merged.reduce((acc, pick) => {
      acc[pick.sport] = (acc[pick.sport] || 0) + 1;
      return acc;
    }, {} as Record<Sport, number>);
    
    console.log(`mergeOddsWithProps: per-sport merged pick counts:`, 
      Object.entries(mergedSportCounts).map(([sport, count]) => `${sport}=${count}`).join(', ')
    );
  }
  
  return { odds: merged, metadata };
}

/**
 * Fetch fresh odds from APIs with logging and SGO primary/backup logic
 */
async function fetchFreshOdds(sports: Sport[]): Promise<{ odds: MergedPick[]; providerUsed: "SGO" | "TheRundown" | "none" }> {
  const apiCalls: Array<{ endpoint: string; timestamp: string; reason: "scheduled" | "force-refresh" | "cache-stale" | "sgo-failed" | "sgo-skipped" | "rundown-failed" }> = [];
  const providerConfig = oddsCache.getProviderUsageConfig();
  
  // Try SGO first (primary source)
  let sgoMarketsLive: SgoPlayerPropOdds[] = [];
  let sgoFailed = false;
  let sgoSkipped = false;
  
  // Check SGO rate limits before calling
  const sgoCheck = oddsCache.canCallSgo(providerConfig);
  let sgoForced = false;
  
  if (!sgoCheck.canCall && !cliArgs.forceSgo) {
    console.log(`mergeOddsWithProps: Skipping SGO: ${sgoCheck.reason}`);
    sgoSkipped = true;
    sgoFailed = true; // Treat as failure to trigger fallback
  } else {
    if (!sgoCheck.canCall && cliArgs.forceSgo) {
      console.log(`[SGO] Daily limit exceeded but proceeding due to --force-sgo (${sgoCheck.reason})`);
      sgoForced = true;
    }
    
    try {
      const reason = cliArgs.forceSgo ? "force-refresh" : (cliArgs.forceRefreshOdds ? "force-refresh" : "scheduled");
      OddsCache.logApiCall("SGO", reason);
      sgoMarketsLive = await fetchSgoPlayerPropOdds(sports);
      
      // Record the SGO call (always record usage, even when forced)
      oddsCache.recordSgoCall();
      
      apiCalls.push({
        endpoint: "SGO",
        timestamp: new Date().toISOString(),
        reason
      });
    } catch (error) {
      sgoFailed = true;
      console.error("mergeOddsWithProps: SGO fetch failed:", error);
      apiCalls.push({
        endpoint: "SGO",
        timestamp: new Date().toISOString(),
        reason: "sgo-failed"
      });
    }
  }

  // If SGO succeeded and has data, use it
  if (!sgoFailed && sgoMarketsLive.length > 0) {
    console.log(`mergeOddsWithProps: Using ${sgoMarketsLive.length} markets from SGO (primary source)`);
    
    // Convert SGO odds to MergedPick format
    const merged: MergedPick[] = [];
    
    for (const market of sgoMarketsLive) {
      // Create a synthetic RawPick for conversion
      const syntheticPick: RawPick = {
        sport: "NBA",
        site: "prizepicks", // Default site for compatibility
        league: market.league,
        player: market.player,
        team: market.team,
        opponent: market.opponent,
        stat: market.stat,
        line: market.line,
        projectionId: "",
        gameId: market.eventId,
        startTime: null, // SGO doesn't provide start time in this format
        isPromo: false,
        isDemon: false,
        isGoblin: false,
        isNonStandardOdds: false,
      };

      const overProbVigged = americanToProb(market.overOdds);
      const underProbVigged = americanToProb(market.underOdds);
      const [trueOverProb, trueUnderProb] = devigTwoWay(
        overProbVigged,
        underProbVigged
      );

      const fairOverOdds = probToAmerican(trueOverProb);
      const fairUnderOdds = probToAmerican(trueUnderProb);

      merged.push({
        ...syntheticPick,
        book: market.book,
        overOdds: market.overOdds,
        underOdds: market.underOdds,
        trueProb: trueOverProb,
        fairOverOdds,
        fairUnderOdds,
      });
    }
    
    // Cache the results
    oddsCache.cacheOdds(merged, "SGO", "fresh", apiCalls);
    
    return { odds: merged, providerUsed: "SGO" };
  }

  // SGO failed or returned empty - use TheRundown backup
  const fallbackReason = sgoSkipped ? "sgo-skipped" : (sgoFailed ? "sgo-failed" : "cache-stale");
  console.log(`mergeOddsWithProps: SGO unavailable or empty, falling back to TheRundown backup (${fallbackReason})`);
  
  // Check TheRundown rate limits
  const estimatedDataPoints = 500; // Conservative estimate
  const rundownCheck = oddsCache.canCallTheRundown(providerConfig, estimatedDataPoints);
  
  if (!rundownCheck.canCall && !cliArgs.forceRundown) {
    console.log(`mergeOddsWithProps: Skipping TheRundown: ${rundownCheck.reason}`);
    console.log("mergeOddsWithProps: Both SGO and TheRundown unavailable, returning empty odds");
    return { odds: [], providerUsed: "none" };
  }
  
  let rundownForced = false;
  if (!rundownCheck.canCall && cliArgs.forceRundown) {
    console.log(`[TheRundown] Daily limit exceeded but proceeding due to --force-rundown (${rundownCheck.reason})`);
    rundownForced = true;
  }
  
  try {
    OddsCache.logApiCall("TheRundown", fallbackReason);
    const backupRows = await getPlayerPropsFromTheRundown(sports);
    
    // Record TheRundown usage (always record usage, even when forced)
    oddsCache.recordTheRundownUsage(estimatedDataPoints);
    
    apiCalls.push({
      endpoint: "TheRundown",
      timestamp: new Date().toISOString(),
      reason: fallbackReason
    });

    if (backupRows.length === 0) {
      console.log("mergeOddsWithProps: TheRundown backup also returned no data");
      return { odds: [], providerUsed: "none" };
    }

    // Convert SgoPlayerPropOdds to MergedPick format
    const merged: MergedPick[] = [];
    
    for (const market of backupRows) {
      // Create a synthetic RawPick for conversion
      const syntheticPick: RawPick = {
        sport: "NBA",
        site: "prizepicks", // Default site for compatibility
        league: market.league,
        player: market.player,
        team: market.team,
        opponent: market.opponent,
        stat: market.stat,
        line: market.line,
        projectionId: "",
        gameId: market.eventId,
        startTime: null, // TheRundown doesn't provide start time in this format
        isPromo: false,
        isDemon: false,
        isGoblin: false,
        isNonStandardOdds: false,
      };

      const overProbVigged = americanToProb(market.overOdds);
      const underProbVigged = americanToProb(market.underOdds);
      const [trueOverProb, trueUnderProb] = devigTwoWay(
        overProbVigged,
        underProbVigged
      );

      const fairOverOdds = probToAmerican(trueOverProb);
      const fairUnderOdds = probToAmerican(trueUnderProb);

      merged.push({
        ...syntheticPick,
        book: market.book,
        overOdds: market.overOdds,
        underOdds: market.underOdds,
        trueProb: trueOverProb,
        fairOverOdds,
        fairUnderOdds,
      });
    }
    
    console.log(`mergeOddsWithProps: Using ${merged.length} markets from TheRundown backup`);
    
    // Update cache with API call metadata
    oddsCache.cacheOdds(merged, "TheRundown", "fresh", apiCalls);
    
    return { odds: merged, providerUsed: "TheRundown" };
  } catch (error) {
    console.error("mergeOddsWithProps: TheRundown backup fetch failed:", error);
    apiCalls.push({
      endpoint: "TheRundown",
      timestamp: new Date().toISOString(),
      reason: "rundown-failed"
    });
    return { odds: [], providerUsed: "none" };
  }
}


  
