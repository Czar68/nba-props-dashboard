"use strict";
// src/logger.ts
// Enhanced logging infrastructure for daily betting operations
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logDebug = exports.logWarn = exports.logError = exports.logInfo = exports.logger = exports.BettingLogger = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class BettingLogger {
    constructor(logDir = 'logs', consoleLog = true) {
        this.logDir = logDir;
        this.consoleLog = consoleLog;
        this.currentSession = this.generateSessionId();
        this.ensureLogDirectory();
    }
    generateSessionId() {
        const now = new Date();
        return now.toISOString().replace(/[:.]/g, '-');
    }
    ensureLogDirectory() {
        if (!fs_1.default.existsSync(this.logDir)) {
            fs_1.default.mkdirSync(this.logDir, { recursive: true });
        }
    }
    formatMessage(level, message) {
        const timestamp = new Date().toISOString();
        return `[${timestamp}] [${level}] ${message}`;
    }
    writeLog(level, message) {
        const formattedMessage = this.formatMessage(level, message);
        const logFile = path_1.default.join(this.logDir, `daily_run_${this.currentSession.split('T')[0]}.log`);
        // Write to file
        fs_1.default.appendFileSync(logFile, formattedMessage + '\n');
        // Console output if enabled
        if (this.consoleLog) {
            console.log(formattedMessage);
        }
    }
    info(message) {
        this.writeLog('INFO', message);
    }
    error(message) {
        this.writeLog('ERROR', message);
    }
    warn(message) {
        this.writeLog('WARN', message);
    }
    debug(message) {
        this.writeLog('DEBUG', message);
    }
    startSession(bankroll, maxKellyFraction, dailyRiskCap) {
        this.info('=== DAILY BETTING RUN STARTED ===');
        this.info(`Bankroll: $${bankroll} | Max Kelly: ${(maxKellyFraction * 100).toFixed(1)}% | Daily Risk Cap: ${(dailyRiskCap * 100).toFixed(1)}%`);
        this.info(`Session ID: ${this.currentSession}`);
    }
    logOptimizerStart(optimizer) {
        this.info(`Starting ${optimizer} optimizer...`);
    }
    logOptimizerComplete(optimizer, metrics) {
        this.info(`${optimizer} completed in ${metrics.runTime.toFixed(2)}s`);
        if ('propsLoaded' in metrics) {
            this.info(`  Props: ${metrics.propsLoaded} loaded → ${metrics.propsMerged} merged → ${metrics.cardsGenerated} cards`);
            // Log structure breakdown
            const structureBreakdown = Object.entries(metrics.cardsByStructure)
                .map(([structure, count]) => `${structure}:${count}`)
                .join(', ');
            this.info(`  Structures: ${structureBreakdown}`);
            // Log EV stats
            this.info(`  Total EV: ${(metrics.totalEvGenerated * 100).toFixed(1)}% | Kelly: ${(metrics.totalKellyAllocation * 100).toFixed(1)}%`);
        }
        else {
            this.info(`  Markets: ${metrics.marketsLoaded} loaded → ${metrics.singlesGenerated} singles`);
            this.info(`  Total Edge: ${(metrics.totalEdgeGenerated * 100).toFixed(1)}% | Kelly: ${(metrics.totalKellyAllocation * 100).toFixed(1)}%`);
        }
    }
    logOptimizerError(optimizer, error) {
        this.error(`${optimizer} failed: ${error}`);
    }
    logCorrelationFilters(metrics) {
        this.info('Correlation filters applied:');
        this.info(`  Same player conflicts: ${metrics.cardsRemovedSamePlayer} cards removed`);
        this.info(`  Team concentration: ${metrics.cardsAdjustedTeamConcentration} cards adjusted`);
        this.info(`  Correlation conflicts: ${metrics.correlationConflicts} pairs flagged`);
        this.info(`  Structure violations: ${metrics.structureViolations} cards removed`);
    }
    logStakeSizing(metrics) {
        this.info('Stake sizing complete:');
        this.info(`  Total recommended stake: $${metrics.totalRecommendedStake.toFixed(2)}`);
        this.info(`  Bankroll at risk: ${(metrics.bankrollPercentageAtRisk * 100).toFixed(1)}%`);
        this.info(`  Risk level: ${metrics.riskLevel}`);
        if (metrics.scalingApplied) {
            this.warn(`  Scaling applied: ${metrics.droppedCards} cards dropped below minimum stake`);
        }
        else {
            this.info(`  No scaling required`);
        }
    }
    logSheetsPush(sheet, success) {
        if (success) {
            this.info(`Pushed to ${sheet} successfully`);
        }
        else {
            this.error(`Failed to push to ${sheet}`);
        }
    }
    logSessionComplete(totalTime, finalMetrics) {
        this.info('=== DAILY RUN COMPLETED SUCCESSFULLY ===');
        this.info(`Total runtime: ${(totalTime / 60).toFixed(2)} minutes`);
        // Summary stats
        const totalCards = finalMetrics.optimizers.prizepicks.cardsGenerated + finalMetrics.optimizers.underdog.cardsGenerated;
        const totalSingles = finalMetrics.optimizers.sportsbook_singles.singlesGenerated;
        const totalStake = finalMetrics.stakeSizing.totalRecommendedStake;
        this.info(`Summary: ${totalCards} cards + ${totalSingles} singles = $${totalStake.toFixed(2)} total stake`);
        this.info(`Risk level: ${finalMetrics.stakeSizing.riskLevel} (${(finalMetrics.stakeSizing.bankrollPercentageAtRisk * 100).toFixed(1)}% of bankroll)`);
        if (finalMetrics.stakeSizing.scalingApplied) {
            this.warn(`Scaling was applied to meet risk caps`);
        }
    }
    saveMetrics(metrics) {
        const metricsFile = path_1.default.join(this.logDir, `metrics_${metrics.date}.json`);
        fs_1.default.writeFileSync(metricsFile, JSON.stringify(metrics, null, 2));
        this.info(`Metrics saved: ${metricsFile}`);
    }
    // Utility method to parse optimizer output and extract metrics
    parseOptimizerOutput(output, optimizer) {
        const lines = output.split('\n');
        const metrics = {
            runTime: 0,
            success: true,
        };
        // Parse common metrics (this would need to be customized based on actual output format)
        for (const line of lines) {
            if (line.includes('props loaded')) {
                const match = line.match(/(\d+)\s+props/);
                if (match)
                    metrics.propsLoaded = parseInt(match[1]);
            }
            if (line.includes('merged')) {
                const match = line.match(/(\d+)\s+merged/);
                if (match)
                    metrics.propsMerged = parseInt(match[1]);
            }
            if (line.includes('cards')) {
                const match = line.match(/(\d+)\s+cards/);
                if (match)
                    metrics.cardsGenerated = parseInt(match[1]);
            }
            if (line.includes('singles')) {
                const match = line.match(/(\d+)\s+singles/);
                if (match)
                    metrics.singlesGenerated = parseInt(match[1]);
            }
        }
        // Set defaults for missing values
        if (optimizer !== 'sportsbook_singles') {
            metrics.propsLoaded = metrics.propsLoaded || 0;
            metrics.propsMerged = metrics.propsMerged || 0;
            metrics.cardsGenerated = metrics.cardsGenerated || 0;
            metrics.cardsByStructure = {};
            metrics.avgEvByStructure = {};
            metrics.totalEvGenerated = 0;
            metrics.totalKellyAllocation = 0;
        }
        else {
            metrics.marketsLoaded = metrics.marketsLoaded || 0;
            metrics.singlesGenerated = metrics.singlesGenerated || 0;
            metrics.totalEdgeGenerated = 0;
            metrics.totalKellyAllocation = 0;
        }
        return metrics;
    }
}
exports.BettingLogger = BettingLogger;
// Global logger instance
exports.logger = new BettingLogger();
// Export convenience functions
const logInfo = (message) => exports.logger.info(message);
exports.logInfo = logInfo;
const logError = (message) => exports.logger.error(message);
exports.logError = logError;
const logWarn = (message) => exports.logger.warn(message);
exports.logWarn = logWarn;
const logDebug = (message) => exports.logger.debug(message);
exports.logDebug = logDebug;
