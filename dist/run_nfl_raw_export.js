"use strict";
// src/run_nfl_raw_export.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable no-console */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const fetch_props_1 = require("./fetch_props");
function writeNflRawCsv(picks, outPath) {
    const headers = [
        "player",
        "team",
        "opponent",
        "stat",
        "line",
        "league",
        "startTime",
        "isDemon",
        "isGoblin",
        "isPromo",
    ];
    const lines = [];
    lines.push(headers.join(","));
    for (const p of picks) {
        const row = [
            p.player,
            p.team ?? "",
            p.opponent ?? "",
            p.stat,
            p.line,
            p.league,
            p.startTime ?? "",
            p.isDemon,
            p.isGoblin,
            p.isPromo,
        ].map((v) => {
            if (v === null || v === undefined)
                return "";
            const s = String(v);
            return s.includes(",") ? s.replace(/,/g, ";") : s;
        });
        lines.push(row.join(","));
    }
    fs_1.default.writeFileSync(outPath, lines.join("\n"), "utf8");
}
async function run() {
    console.log("run_nfl_raw_export: fetching PrizePicks NBA+NFL props...");
    const allPicks = await (0, fetch_props_1.fetchPrizePicksRawProps)();
    const nflPicks = allPicks.filter((p) => p.league === "NFL");
    console.log(`run_nfl_raw_export: got ${allPicks.length} total picks, ${nflPicks.length} NFL picks`);
    const outPath = path_1.default.join(process.cwd(), "prizepicks-nfl-raw.csv");
    writeNflRawCsv(nflPicks, outPath);
    console.log(`run_nfl_raw_export: wrote ${nflPicks.length} rows to ${outPath}`);
}
run().catch((err) => {
    console.error("run_nfl_raw_export failed:", err);
    process.exit(1);
});
