"use strict";
// src/odds_cache.ts
// Disk-based odds cache with configurable TTL to respect API rate limits
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.oddsCache = exports.OddsCache = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const DEFAULT_CACHE_DIR = path_1.default.join(process.cwd(), ".cache");
const DEFAULT_TTL_MINUTES = 15; // 15 minutes default cache TTL
const PROVIDER_USAGE_FILE = "provider-usage.json";
class OddsCache {
    constructor(options = {}) {
        this.cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;
        this.defaultTtlMs = (options.defaultTtlMinutes ?? DEFAULT_TTL_MINUTES) * 60 * 1000;
        // Ensure cache directory exists
        if (!fs_1.default.existsSync(this.cacheDir)) {
            fs_1.default.mkdirSync(this.cacheDir, { recursive: true });
        }
    }
    getCachePath() {
        return path_1.default.join(this.cacheDir, "odds-cache.json");
    }
    readCache() {
        try {
            const cachePath = this.getCachePath();
            if (!fs_1.default.existsSync(cachePath)) {
                return null;
            }
            const raw = fs_1.default.readFileSync(cachePath, "utf8");
            const entry = JSON.parse(raw);
            // Validate cache entry structure
            if (!entry || !Array.isArray(entry.data) || !entry.fetchedAt) {
                console.warn("[OddsCache] Invalid cache entry format, ignoring");
                return null;
            }
            return entry;
        }
        catch (error) {
            console.warn("[OddsCache] Failed to read cache:", error);
            return null;
        }
    }
    writeCache(entry) {
        try {
            const cachePath = this.getCachePath();
            fs_1.default.writeFileSync(cachePath, JSON.stringify(entry, null, 2), "utf8");
        }
        catch (error) {
            console.error("[OddsCache] Failed to write cache:", error);
        }
    }
    /**
     * Check if cached data is still valid based on TTL
     */
    isCacheValid(entry, ttlMs) {
        const fetchedAt = new Date(entry.fetchedAt).getTime();
        const now = Date.now();
        return (now - fetchedAt) < ttlMs;
    }
    /**
     * Get cached odds if valid (returns full entry for metadata)
     */
    getCachedOddsEntry(config) {
        if (config.forceRefresh) {
            console.log("[OddsCache] Force refresh requested, ignoring cache");
            return null;
        }
        const entry = this.readCache();
        if (!entry) {
            console.log("[OddsCache] No cached data available");
            return null;
        }
        const ttlMs = config.refreshIntervalMinutes * 60 * 1000;
        if (!this.isCacheValid(entry, ttlMs)) {
            const ageMinutes = (Date.now() - new Date(entry.fetchedAt).getTime()) / (60 * 1000);
            console.log(`[OddsCache] Cache expired (${ageMinutes.toFixed(1)} minutes old, TTL=${config.refreshIntervalMinutes}m)`);
            return null;
        }
        console.log(`[OddsCache] Using cached odds from ${entry.fetchedAt} (${entry.data.length} picks, source: ${entry.source})`);
        // Log recent API calls for transparency
        if (entry.apiCalls.length > 0) {
            const recentCalls = entry.apiCalls.slice(-3); // Show last 3 calls
            console.log("[OddsCache] Recent API calls:");
            recentCalls.forEach(call => {
                console.log(`  - ${call.timestamp} ${call.endpoint} (${call.reason})`);
            });
        }
        return entry;
    }
    /**
     * Get cached odds if valid (legacy method - returns just data)
     */
    getCachedOdds(config) {
        const entry = this.getCachedOddsEntry(config);
        return entry ? entry.data : null;
    }
    /**
     * Cache new odds data with API call metadata
     */
    cacheOdds(data, source, sourceType, apiCalls) {
        const entry = {
            data,
            fetchedAt: new Date().toISOString(),
            source,
            sourceType,
            apiCalls
        };
        this.writeCache(entry);
        console.log(`[OddsCache] Cached ${data.length} odds from ${source} (${sourceType}) at ${entry.fetchedAt}`);
    }
    /**
     * Log an API call for audit trail
     */
    static logApiCall(endpoint, reason) {
        const timestamp = new Date().toISOString();
        console.log(`[API] ${timestamp} ${endpoint} (${reason})`);
    }
    /**
     * Clear cache manually (useful for debugging)
     */
    clearCache() {
        try {
            const cachePath = this.getCachePath();
            if (fs_1.default.existsSync(cachePath)) {
                fs_1.default.unlinkSync(cachePath);
                console.log("[OddsCache] Cache cleared");
            }
        }
        catch (error) {
            console.error("[OddsCache] Failed to clear cache:", error);
        }
    }
    /**
     * Get cache statistics for debugging
     */
    getCacheStats() {
        const entry = this.readCache();
        if (!entry) {
            return { exists: false, ageMinutes: null, size: 0 };
        }
        const ageMinutes = (Date.now() - new Date(entry.fetchedAt).getTime()) / (60 * 1000);
        return {
            exists: true,
            ageMinutes,
            size: entry.data.length
        };
    }
    /**
     * Get provider usage tracking file path
     */
    getProviderUsagePath() {
        return path_1.default.join(this.cacheDir, PROVIDER_USAGE_FILE);
    }
    /**
     * Load provider usage data from disk
     */
    loadProviderUsage() {
        try {
            const usagePath = this.getProviderUsagePath();
            if (fs_1.default.existsSync(usagePath)) {
                const data = fs_1.default.readFileSync(usagePath, "utf8");
                return JSON.parse(data);
            }
        }
        catch (error) {
            console.error("[OddsCache] Failed to load provider usage:", error);
        }
        // Return default usage for today
        return {
            date: new Date().toISOString().slice(0, 10),
            sgoCallCount: 0,
            rundownDataPointsUsed: 0,
        };
    }
    /**
     * Save provider usage data to disk
     */
    saveProviderUsage(usage) {
        try {
            const usagePath = this.getProviderUsagePath();
            fs_1.default.writeFileSync(usagePath, JSON.stringify(usage, null, 2));
        }
        catch (error) {
            console.error("[OddsCache] Failed to save provider usage:", error);
        }
    }
    /**
     * Check if SGO can be called based on daily limits
     */
    canCallSgo(config) {
        const usage = this.loadProviderUsage();
        const today = new Date().toISOString().slice(0, 10);
        // Reset if new day
        if (usage.date !== today) {
            usage.date = today;
            usage.sgoCallCount = 0;
            usage.rundownDataPointsUsed = 0;
        }
        if (usage.sgoCallCount >= config.sgoMaxCallsPerDay) {
            return {
                canCall: false,
                reason: `SGO daily call limit reached (${usage.sgoCallCount}/${config.sgoMaxCallsPerDay})`
            };
        }
        return { canCall: true, reason: "Within limits" };
    }
    /**
     * Check if TheRundown can be called based on daily limits
     */
    canCallTheRundown(config, estimatedDataPoints) {
        const usage = this.loadProviderUsage();
        const today = new Date().toISOString().slice(0, 10);
        // Reset if new day
        if (usage.date !== today) {
            usage.date = today;
            usage.sgoCallCount = 0;
            usage.rundownDataPointsUsed = 0;
        }
        if (usage.rundownDataPointsUsed + estimatedDataPoints > config.rundownMaxDataPointsPerDay) {
            return {
                canCall: false,
                reason: `TheRundown daily data point limit would be exceeded (${usage.rundownDataPointsUsed} + ${estimatedDataPoints} > ${config.rundownMaxDataPointsPerDay})`
            };
        }
        return { canCall: true, reason: "Within limits" };
    }
    /**
     * Record an SGO API call
     */
    recordSgoCall() {
        const usage = this.loadProviderUsage();
        const today = new Date().toISOString().slice(0, 10);
        // Reset if new day
        if (usage.date !== today) {
            usage.date = today;
            usage.sgoCallCount = 0;
            usage.rundownDataPointsUsed = 0;
        }
        usage.sgoCallCount++;
        this.saveProviderUsage(usage);
        console.log(`[OddsCache] SGO call recorded: ${usage.sgoCallCount}/${process.env.SGO_MAX_CALLS_PER_DAY || 8} today`);
    }
    /**
     * Record TheRundown data point usage
     */
    recordTheRundownUsage(dataPoints) {
        const usage = this.loadProviderUsage();
        const today = new Date().toISOString().slice(0, 10);
        // Reset if new day
        if (usage.date !== today) {
            usage.date = today;
            usage.sgoCallCount = 0;
            usage.rundownDataPointsUsed = 0;
        }
        usage.rundownDataPointsUsed += dataPoints;
        this.saveProviderUsage(usage);
        console.log(`[OddsCache] TheRundown usage recorded: ${usage.rundownDataPointsUsed}/1000 data points today`);
    }
    /**
     * Get current provider usage statistics
     */
    getProviderUsageStats() {
        const usage = this.loadProviderUsage();
        const config = this.getProviderUsageConfig();
        return {
            ...usage,
            sgoLimit: config.sgoMaxCallsPerDay,
            rundownLimit: config.rundownMaxDataPointsPerDay,
        };
    }
    /**
     * Get provider usage configuration from environment variables
     */
    getProviderUsageConfig() {
        return {
            sgoMaxCallsPerDay: parseInt(process.env.SGO_MAX_CALLS_PER_DAY || "8", 10),
            rundownMaxDataPointsPerDay: 1000, // TheRundown free plan limit
        };
    }
}
exports.OddsCache = OddsCache;
// Global cache instance for the application
exports.oddsCache = new OddsCache();
