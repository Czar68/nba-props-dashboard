"use strict";
// src/calculate_ev.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateEvForMergedPick = calculateEvForMergedPick;
exports.calculateEvForMergedPicks = calculateEvForMergedPicks;
// PrizePicks legs are binary with fixed payout table.
// For now we treat EV as (trueProb - 0.5) just for ranking.
function calculateEvForMergedPick(pick) {
    const trueProb = pick.trueProb;
    const fairOdds = trueProb > 0 && trueProb < 1 ? 1 / trueProb - 1 : Number.NaN;
    const edge = trueProb - 0.5;
    const legEv = edge; // per-unit; used only for ranking and card construction
    const id = `${pick.site}-${pick.projectionId}-${pick.stat}-${pick.line}`;
    return {
        id,
        site: pick.site,
        league: pick.league,
        player: pick.player,
        team: pick.team,
        opponent: pick.opponent,
        stat: pick.stat,
        line: pick.line,
        projectionId: pick.projectionId,
        gameId: pick.gameId,
        startTime: pick.startTime,
        outcome: "over",
        trueProb,
        fairOdds,
        edge,
        book: pick.book,
        overOdds: pick.overOdds,
        underOdds: pick.underOdds,
        legEv,
    };
}
function calculateEvForMergedPicks(merged) {
    return merged.map(calculateEvForMergedPick);
}
