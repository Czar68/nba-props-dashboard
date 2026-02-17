"use strict";
// src/kelly_stake_sizing.ts
// Kelly-based stake sizing and bankroll management for production betting
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_BANKROLL_CONFIG = void 0;
exports.computeStake = computeStake;
exports.computePortfolioAllocation = computePortfolioAllocation;
exports.updateBankrollConfig = updateBankrollConfig;
exports.validateStakeInput = validateStakeInput;
exports.getRiskAssessmentSummary = getRiskAssessmentSummary;
exports.exportStakeData = exportStakeData;
// Default configuration for $500-$1000 bankroll
exports.DEFAULT_BANKROLL_CONFIG = {
    currentBankroll: 750,
    maxDailyRisk: 0.10, // 10% daily risk cap
    maxKellyMultiplier: 0.5, // 50% of Kelly globally
    sportWeights: {
        'NBA': 1.0, // Full Kelly for NBA (most familiar)
        'NFL': 0.8, // 80% Kelly for NFL (higher variance)
        'MLB': 0.7, // 70% Kelly for MLB (long season)
        'NHL': 0.5, // 50% Kelly for NHL (less familiar)
        'NCAAB': 0.6, // 60% Kelly for college basketball
        'NCAAF': 0.6, // 60% Kelly for college football
    },
    structureWeights: {
        '2P': 0.25, // Very conservative for 2-leg parlays
        '3P': 0.5, // Conservative for 3-leg parlays
        '4P': 0.75, // Moderate for 4-leg parlays
        '5P': 0.9, // Near-full for 5-leg parlays
        '3F': 0.5, // Conservative for 3-leg flex
        '4F': 0.75, // Moderate for 4-leg flex
        '5F': 1.0, // Full Kelly for main flex structures
        '6F': 1.0, // Full Kelly for main flex structures
        '6P': 0.9, // Near-full for 6-leg parlays
        '7P': 0.5, // Conservative for 7-leg parlays (UD only)
        '7F': 0.8, // Moderate for 7-leg flex (UD only)
        '8P': 0.4, // Very conservative for 8-leg parlays (UD only)
        '8F': 0.7, // Moderate for 8-leg flex (UD only)
    },
    minStake: 5.0, // $5 minimum stake
    maxStake: 100.0, // $100 maximum stake
};
/**
 * Compute Kelly-based stake sizing for a single card or bet
 */
function computeStake(input) {
    const { cardEv, winProb, kellyFraction, bankroll, maxKellyMultiplier, sport = 'NBA', structure = '5F' } = input;
    // Get sport and structure weights
    const sportWeight = exports.DEFAULT_BANKROLL_CONFIG.sportWeights[sport] || 1.0;
    const structureWeight = exports.DEFAULT_BANKROLL_CONFIG.structureWeights[structure] || 1.0;
    // Calculate effective Kelly multiplier
    const effectiveKellyMultiplier = maxKellyMultiplier * sportWeight * structureWeight;
    // Calculate full Kelly stake
    const fullKellyStake = bankroll * kellyFraction;
    // Apply multiplier
    let recommendedStake = fullKellyStake * effectiveKellyMultiplier;
    // Apply min/max stake limits
    recommendedStake = Math.max(exports.DEFAULT_BANKROLL_CONFIG.minStake, recommendedStake);
    recommendedStake = Math.min(exports.DEFAULT_BANKROLL_CONFIG.maxStake, recommendedStake);
    // Calculate expected profit (not potential win - that was the bug)
    const expectedProfit = recommendedStake * cardEv;
    // Calculate max potential win using actual payout structure
    // For now, we'll use a simple approximation since this function is deprecated
    // The new Kelly calculation provides accurate maxPotentialWin
    const maxPotentialWin = recommendedStake * 20; // Rough 20× max payout assumption
    // Determine risk adjustment level
    let riskAdjustment;
    let riskLevel;
    if (effectiveKellyMultiplier >= 0.9) {
        riskAdjustment = 'FULL_KELLY';
        riskLevel = cardEv > 0.10 ? 'HIGH' : 'MEDIUM';
    }
    else if (effectiveKellyMultiplier >= 0.5) {
        riskAdjustment = 'HALF_KELLY';
        riskLevel = 'MEDIUM';
    }
    else if (effectiveKellyMultiplier >= 0.25) {
        riskAdjustment = 'QUARTER_KELLY';
        riskLevel = 'LOW';
    }
    else {
        riskAdjustment = 'CONSERVATIVE';
        riskLevel = 'LOW';
    }
    // Adjust risk level based on EV
    if (cardEv > 0.15) {
        riskLevel = 'VERY_HIGH';
    }
    else if (cardEv > 0.10 && riskLevel === 'MEDIUM') {
        riskLevel = 'HIGH';
    }
    return {
        fullKellyStake,
        recommendedStake,
        expectedProfit, // Fixed: was potentialWin (using EV as payout was wrong)
        maxPotentialWin, // New: actual max possible win
        riskAdjustment,
        kellyPercentage: (recommendedStake / bankroll) * 100,
        riskLevel,
    };
}
/**
 * Compute portfolio allocation across multiple cards/bets
 */
function computePortfolioAllocation(stakes, config = exports.DEFAULT_BANKROLL_CONFIG) {
    const totalRecommendedStake = stakes.reduce((sum, s) => sum + s.stake, 0);
    const totalKellyAllocation = stakes.reduce((sum, s) => sum + s.kellyFraction, 0);
    const bankrollAtRisk = totalRecommendedStake;
    const riskPercentage = bankrollAtRisk / config.currentBankroll;
    let scalingApplied = false;
    const scaledStakes = {};
    const droppedCards = [];
    // Check if we exceed daily risk cap
    if (riskPercentage > config.maxDailyRisk) {
        scalingApplied = true;
        console.log(`⚠️  Risk cap exceeded: ${(riskPercentage * 100).toFixed(1)}% > ${(config.maxDailyRisk * 100).toFixed(1)}%`);
        // Scale back proportionally
        const scalingFactor = config.maxDailyRisk / riskPercentage;
        for (const stake of stakes) {
            const scaledStake = stake.stake * scalingFactor;
            // Drop cards that would be below minimum stake after scaling
            if (scaledStake < config.minStake) {
                droppedCards.push(stake.id);
                scaledStakes[stake.id] = 0;
            }
            else {
                scaledStakes[stake.id] = scaledStake;
            }
        }
        console.log(`🔧 Applied scaling factor: ${scalingFactor.toFixed(3)}`);
        console.log(`📉 Dropped ${droppedCards.length} cards below minimum stake`);
    }
    else {
        // No scaling needed
        for (const stake of stakes) {
            scaledStakes[stake.id] = stake.stake;
        }
    }
    const finalTotalStake = Object.values(scaledStakes).reduce((sum, s) => sum + s, 0);
    const finalRiskPercentage = finalTotalStake / config.currentBankroll;
    return {
        totalRecommendedStake: finalTotalStake,
        totalKellyAllocation,
        bankrollAtRisk: finalTotalStake,
        riskPercentage: finalRiskPercentage,
        scalingApplied,
        scaledStakes,
        droppedCards,
    };
}
/**
 * Update bankroll configuration
 */
function updateBankrollConfig(newBankroll) {
    return {
        ...exports.DEFAULT_BANKROLL_CONFIG,
        currentBankroll: newBankroll,
    };
}
/**
 * Validate stake sizing parameters
 */
function validateStakeInput(input) {
    const errors = [];
    if (input.cardEv <= 0) {
        errors.push('Card EV must be positive');
    }
    if (input.winProb <= 0 || input.winProb > 1) {
        errors.push('Win probability must be between 0 and 1');
    }
    if (input.kellyFraction <= 0) {
        errors.push('Kelly fraction must be positive');
    }
    if (input.bankroll <= 0) {
        errors.push('Bankroll must be positive');
    }
    if (input.maxKellyMultiplier <= 0 || input.maxKellyMultiplier > 1) {
        errors.push('Max Kelly multiplier must be between 0 and 1');
    }
    return errors;
}
/**
 * Get risk assessment summary
 */
function getRiskAssessmentSummary(portfolio, config) {
    const riskLevel = portfolio.riskPercentage;
    let assessment = '';
    if (riskLevel > 0.15) {
        assessment = '🔴 VERY HIGH RISK - Consider reducing position sizes';
    }
    else if (riskLevel > 0.10) {
        assessment = '🟡 HIGH RISK - Monitor closely';
    }
    else if (riskLevel > 0.05) {
        assessment = '🟢 MODERATE RISK - Within acceptable range';
    }
    else {
        assessment = '🟢 LOW RISK - Conservative allocation';
    }
    if (portfolio.scalingApplied) {
        assessment += ' | ⚠️  Scaled to meet risk cap';
    }
    if (portfolio.droppedCards.length > 0) {
        assessment += ` | 📉 Dropped ${portfolio.droppedCards.length} low-stake positions`;
    }
    return assessment;
}
/**
 * Export stake sizing data for dashboard
 */
function exportStakeData(cards, // Would be EvCard[] with stake data
singles // Would be SingleBetEVResult[] with stake data
) {
    const totalStake = cards.reduce((sum, card) => sum + (card.recommendedStake || 0), 0) +
        singles.reduce((sum, single) => sum + (single.recommendedStake || 0), 0);
    return {
        timestamp: new Date().toISOString(),
        bankroll: exports.DEFAULT_BANKROLL_CONFIG.currentBankroll,
        totalStake,
        riskPercentage: totalStake / exports.DEFAULT_BANKROLL_CONFIG.currentBankroll,
        cards: cards.map(card => ({
            id: card.id,
            site: card.site,
            sport: card.sport,
            structure: card.flexType,
            ev: card.cardEv,
            recommendedStake: card.recommendedStake,
            riskAdjustment: card.riskAdjustment,
            kellyPercentage: card.kellyPercentage,
        })),
        singles: singles.map(single => ({
            id: single.marketId,
            sport: single.sport,
            book: single.book,
            market: single.marketId,
            side: single.side,
            edge: single.edgePct,
            recommendedStake: single.recommendedStake,
            riskAdjustment: single.riskAdjustment,
            kellyPercentage: single.kellyPercentage,
        })),
    };
}
