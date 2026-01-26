"use strict";
// src/normalize_stats.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeStatType = normalizeStatType;
/**
 * Maps a raw market/stat key from an external source (PrizePicks, OddsAPI, other books)
 * to a normalized StatType used internally by the optimizer.
 *
 * Examples:
 * - "points" -> "points"
 * - "pts" -> "points"
 * - "player_points" -> "points"
 * - "rebounds" / "rebs" / "player_rebounds" -> "rebounds"
 */
function normalizeStatType(raw) {
    const key = raw.toLowerCase();
    if (["points", "pts", "player_points"].includes(key)) {
        return "points";
    }
    if (["rebounds", "rebs", "player_rebounds"].includes(key)) {
        return "rebounds";
    }
    if (["assists", "asts", "player_assists"].includes(key)) {
        return "assists";
    }
    if (["pra", "points_rebounds_assists", "player_pra"].includes(key)) {
        return "pra";
    }
    if (["threes", "3pt_made", "3pm", "player_threes"].includes(key)) {
        return "threes";
    }
    if (["blocks", "blk", "player_blocks"].includes(key)) {
        return "blocks";
    }
    if (["steals", "stl", "player_steals"].includes(key)) {
        return "steals";
    }
    if (["fantasy", "fantasy_points", "fpts"].includes(key)) {
        return "fantasy";
    }
    // Fallback: return the raw key if no mapping exists yet.
    return raw;
}
