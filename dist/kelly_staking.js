"use strict";
// src/kelly_staking.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.SPORT_KELLY_FRACTIONS = void 0;
exports.calculateKellyStake = calculateKellyStake;
exports.getKellyFraction = getKellyFraction;
exports.SPORT_KELLY_FRACTIONS = {
    NBA: 0.25, // 25% of bankroll max per card
    NHL: 0.20, // 20% of bankroll max per card
    NCAAB: 0.15, // 15% of bankroll max per card (college basketball - more volatile)
    NFL: 0.30, // 30% of bankroll max per card (football - higher confidence)
    MLB: 0.22, // 22% of bankroll max per card (baseball)
    NCAAF: 0.18, // 18% of bankroll max per card (college football)
};
/**
 * Calculate Kelly stake for a given card EV and sport
 *
 * @param cardEv - Expected value of the card (e.g., 0.05 for 5% EV)
 * @param bankroll - Current bankroll (default: 10000)
 * @param sport - Sport for sport-specific fraction
 * @returns Recommended stake amount (rounded to 2 decimal places)
 */
function calculateKellyStake(cardEv, bankroll = 10000, sport) {
    const frac = exports.SPORT_KELLY_FRACTIONS[sport];
    const kellyStake = bankroll * frac * cardEv;
    return Math.max(0, Math.round(kellyStake * 100) / 100);
}
/**
 * Get the Kelly fraction for a sport (for reporting purposes)
 */
function getKellyFraction(sport) {
    return exports.SPORT_KELLY_FRACTIONS[sport];
}
