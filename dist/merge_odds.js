"use strict";
// src/merge_odds.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeOddsWithProps = mergeOddsWithProps;
const odds_math_1 = require("./odds_math");
const fetch_sgo_odds_1 = require("./fetch_sgo_odds");
// NOTE: Fantasy support modules (fantasy.ts, fantasy_analyzer.ts) are already
// implemented and can be re‑enabled for EV/fantasy workflows once you have
// independent projections / historical data wired in. For now, fantasy props
// are explicitly excluded from the EV legs/cards flow.
function normalizeName(name) {
    return name.trim().toLowerCase();
}
// Convert SGO player IDs like "KEVIN_DURANT_1_NBA" -> "kevin durant"
function normalizeSgoPlayerId(id) {
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
function isJuiceTooExtreme(american) {
    // american is negative for favorites, positive for dogs.
    // We only care about steep negative favorites here.
    return american <= -MAX_JUICE;
}
function findBestMatchForPick(pick, sgoMarkets) {
    const targetName = normalizeName(pick.player);
    const candidates = sgoMarkets.filter((o) => {
        const sgoName = normalizeSgoPlayerId(o.player);
        return (sgoName === targetName &&
            o.stat === pick.stat &&
            o.league.toUpperCase() === pick.league.toUpperCase());
    });
    if (!candidates.length)
        return null;
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
    if (bestDiff > MAX_LINE_DIFF)
        return null;
    // Reject if juice is extreme on either side
    if (typeof best.overOdds === "number" && isJuiceTooExtreme(best.overOdds)) {
        return null;
    }
    if (typeof best.underOdds === "number" && isJuiceTooExtreme(best.underOdds)) {
        return null;
    }
    return best;
}
async function mergeOddsWithProps(rawPicks) {
    // Live SGO only; no stub odds
    const sgoMarketsLive = await (0, fetch_sgo_odds_1.fetchSgoPlayerPropOdds)();
    if (sgoMarketsLive.length === 0) {
        // eslint-disable-next-line no-console
        console.log("mergeOddsWithProps: no SGO markets available; returning 0 merged picks");
        return [];
    }
    // eslint-disable-next-line no-console
    console.log(`mergeOddsWithProps: using ${sgoMarketsLive.length} live SGO markets`);
    const sgoMarkets = sgoMarketsLive;
    const merged = [];
    for (const pick of rawPicks) {
        // Promo guard – harmless until you add more nuanced behavior
        const anyPick = pick;
        if (anyPick.isDemon || anyPick.isGoblin || anyPick.isPromo) {
            continue;
        }
        // Explicitly exclude fantasy props from EV legs/cards for now.
        if (pick.stat === "fantasy_score") {
            continue;
        }
        const match = findBestMatchForPick(pick, sgoMarkets);
        if (!match)
            continue;
        const overProbVigged = (0, odds_math_1.americanToProb)(match.overOdds);
        const underProbVigged = (0, odds_math_1.americanToProb)(match.underOdds);
        const [trueOverProb, trueUnderProb] = (0, odds_math_1.devigTwoWay)(overProbVigged, underProbVigged);
        const fairOverOdds = (0, odds_math_1.probToAmerican)(trueOverProb);
        const fairUnderOdds = (0, odds_math_1.probToAmerican)(trueUnderProb);
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
    return merged;
}
