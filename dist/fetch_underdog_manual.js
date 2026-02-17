"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchUnderdogManualProps = fetchUnderdogManualProps;
// src/fetch_underdog_manual.ts
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// Map manual stat types to StatCategory union
function mapStatType(statType) {
    const key = statType.toLowerCase();
    if (key === "points" || key === "pts")
        return "points";
    if (key === "rebounds" || key === "rebs")
        return "rebounds";
    if (key === "assists" || key === "asts")
        return "assists";
    if (key === "points_rebounds_assists" || key === "pra")
        return "pra";
    if (key === "points_rebounds" || key === "pr")
        return "points_rebounds";
    if (key === "points_assists" || key === "pa")
        return "points_assists";
    if (key === "rebounds_assists" || key === "ra")
        return "rebounds_assists";
    if (key === "three_pointers_made" ||
        key === "three_pointers" ||
        key === "threes")
        return "threes";
    if (key === "blocks")
        return "blocks";
    if (key === "steals")
        return "steals";
    if (key === "blocks_steals" || key === "stocks")
        return "stocks";
    if (key === "turnovers")
        return "turnovers";
    if (key === "fantasy" || key === "fantasy_score")
        return "fantasy_score";
    // NHL stats
    if (key === "goals" || key === "goal")
        return "goals";
    if (key === "assists" || key === "ast")
        return "assists";
    if (key === "points" || key === "pts")
        return "points";
    if (key === "shots_on_goal" || key === "shots" || key === "sog")
        return "shots_on_goal";
    if (key === "saves" || key === "save")
        return "saves";
    if (key === "goals_against" || key === "ga")
        return "goals_against";
    if (key === "plus_minus" || key === "plusminus" || key === "+/-")
        return "plus_minus";
    if (key === "penalty_minutes" || key === "pim")
        return "penalty_minutes";
    if (key === "power_play_goals" || key === "ppg")
        return "power_play_goals";
    if (key === "short_handed_goals" || key === "shg")
        return "short_handed_goals";
    if (key === "time_on_ice" || key === "toi")
        return "time_on_ice";
    // Fallback: treat unknown stat types as points so we don't break the pipeline.
    return "points";
}
// Map sport string to Sport type
function mapSportToType(sport) {
    const sportUpper = sport.toUpperCase();
    if (sportUpper === 'NBA' || sportUpper.includes('BASKETBALL')) {
        return 'NBA';
    }
    if (sportUpper === 'NFL' || sportUpper.includes('FOOTBALL')) {
        return 'NFL';
    }
    if (sportUpper === 'MLB' || sportUpper.includes('BASEBALL')) {
        return 'MLB';
    }
    if (sportUpper === 'NHL' || sportUpper.includes('HOCKEY')) {
        return 'NHL';
    }
    if (sportUpper === 'NCAAB' || sportUpper.includes('COLLEGE BASKETBALL')) {
        return 'NCAAB';
    }
    if (sportUpper === 'NCAAF' || sportUpper.includes('COLLEGE FOOTBALL')) {
        return 'NCAAF';
    }
    return 'NBA'; // Default fallback
}
async function fetchUnderdogManualProps() {
    const manualDataPath = path_1.default.join(process.cwd(), "underdog_manual_props.json");
    try {
        if (!fs_1.default.existsSync(manualDataPath)) {
            console.log('[UD] Manual props file not found, creating template...');
            // Create template file if it doesn't exist
            const template = {
                props: [
                    {
                        player: "Sample Player",
                        team: "TEAM",
                        opponent: "OPP",
                        sport: "NBA", // Add sport field to template
                        stat: "points",
                        line: 25.5,
                        overOdds: -110,
                        underOdds: -110
                    }
                ]
            };
            fs_1.default.writeFileSync(manualDataPath, JSON.stringify(template, null, 2));
            console.log('[UD] Template created. Please edit underdog_manual_props.json with real data.');
            return [];
        }
        const fileContent = fs_1.default.readFileSync(manualDataPath, "utf8");
        const data = JSON.parse(fileContent);
        const picks = [];
        for (const prop of data.props || []) {
            const stat = mapStatType(prop.stat);
            const sport = mapSportToType(prop.sport || "NBA"); // Default to NBA if not specified
            const rawPick = {
                sport: sport,
                site: "underdog",
                league: sport, // Use sport as league for consistency
                player: prop.player?.trim() || "",
                team: prop.team || null,
                opponent: prop.opponent || null,
                stat,
                line: prop.line,
                projectionId: `manual_${prop.player.replace(/\s+/g, '_')}_${prop.stat}`,
                gameId: `manual_game_${prop.team}_vs_${prop.opponent}`,
                startTime: new Date().toISOString(), // Current time as placeholder
                isDemon: false,
                isGoblin: false,
                isPromo: false,
                isNonStandardOdds: false,
            };
            picks.push(rawPick);
        }
        console.log(`[UD] Loaded ${picks.length} manual Underdog props from JSON file`);
        return picks;
    }
    catch (error) {
        console.error('[UD] Error loading manual props:', error);
        console.log('[UD] WARNING: Using empty props list; optimizer will produce 0 legs/cards');
        return [];
    }
}
