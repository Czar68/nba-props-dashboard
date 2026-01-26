// src/fetch_sgo_odds.ts

import "dotenv/config";

import SportsGameOdds from "sports-odds-api";

import { SgoPlayerPointsOdds } from "./types";

const PREFERRED_BOOKS = [
  "fanduel",
  "draftkings",
  "caesars",
  "betmgm",
  "espn_bet",
  "pointsbet",
];

type BookmakerRecord = Record<string, any> | undefined;

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

export async function fetchSgoPlayerPointsOdds(): Promise<SgoPlayerPointsOdds[]> {
  const apiKey = process.env.SGO_API_KEY ?? process.env.SGOAPIKEY;
  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.warn("fetchSgoPlayerPointsOdds: missing SGOAPIKEY, returning []");
    return [];
  }

  const client = new SportsGameOdds({ apiKeyParam: apiKey });

  const results: SgoPlayerPointsOdds[] = [];

  // ---- NBA PLAYER POINTS ----
  try {
    const pageNba = await client.events.get({
      leagueID: "NBA",
      finalized: false,
      oddsAvailable: true,
      limit: 50,
    });

    const eventsNba = (pageNba as any).data ?? [];
    // eslint-disable-next-line no-console
    console.log("fetchSgoPlayerPointsOdds: NBA events length", eventsNba.length);

    type Acc = Map<string, SgoPlayerPointsOdds>;
    const byPlayerNba: Acc = new Map();

    for (const event of eventsNba) {
      const odds = (event as any).odds as Record<string, any> | undefined;
      if (!odds) continue;

      const league: string = (event as any).leagueID ?? "NBA";
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

        // Only full-game player POINTS over/under
        if (statID !== "points") continue;
        if (betTypeID !== "ou") continue;
        if (periodID !== "game") continue;
        if (sideID !== "over" && sideID !== "under") continue;

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
        } else if (sideID === "under") {
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

    const resultNba: SgoPlayerPointsOdds[] = Array.from(
      byPlayerNba.values()
    ).filter(
      (p) =>
        Number.isFinite(p.line) &&
        Number.isFinite(p.overOdds) &&
        Number.isFinite(p.underOdds)
    );

    results.push(...resultNba);

    // eslint-disable-next-line no-console
    console.log(
      "fetchSgoPlayerPointsOdds: returning",
      resultNba.length,
      "NBA player points markets from SGO"
    );
  } catch (err) {
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

    const eventsNfl = (pageNfl as any).data ?? [];
    // eslint-disable-next-line no-console
    console.log("fetchSgoPlayerPointsOdds: NFL events length", eventsNfl.length);

    type Acc = Map<string, SgoPlayerPointsOdds>;
    const byPlayerNfl: Acc = new Map();

    for (const event of eventsNfl) {
      const odds = (event as any).odds as Record<string, any> | undefined;
      if (!odds) continue;

      const league: string = (event as any).leagueID ?? "NFL";
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

        // For now, mirror NBA behavior: only player POINTS over/under.
        // Once you know SGO's NFL statIDs for pass_yards/rec_yards/etc.,
        // you can branch here and set stat accordingly.
        if (statID !== "points") continue;
        if (betTypeID !== "ou") continue;
        if (periodID !== "game") continue;
        if (sideID !== "over" && sideID !== "under") continue;

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
        } else if (sideID === "under") {
          existing.underOdds = price;
        }

        if (!existing.team && homeTeam && awayTeam) {
          existing.team = homeTeam;
          existing.opponent = awayTeam;
        }
      }
    }

    const resultNfl: SgoPlayerPointsOdds[] = Array.from(
      byPlayerNfl.values()
    ).filter(
      (p) =>
        Number.isFinite(p.line) &&
        Number.isFinite(p.overOdds) &&
        Number.isFinite(p.underOdds)
    );

    results.push(...resultNfl);

    // eslint-disable-next-line no-console
    console.log(
      "fetchSgoPlayerPointsOdds: returning",
      resultNfl.length,
      "NFL player points markets from SGO"
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("fetchSgoPlayerPointsOdds: error calling SGO SDK for NFL", err);
  }

  // eslint-disable-next-line no-console
  console.log(
    "fetchSgoPlayerPointsOdds: total player points markets from SGO",
    results.length
  );

  return results;
}
