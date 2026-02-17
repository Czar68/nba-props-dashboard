"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/debug_underdog_fetch.ts
const fetch_underdog_props_1 = require("./fetch_underdog_props");
async function main() {
    const picks = await (0, fetch_underdog_props_1.fetchUnderdogRawProps)(['NBA']); // Default to NBA for debug
    console.log("Underdog picks count:", picks.length);
    console.log(JSON.stringify(picks.slice(0, 5), null, 2));
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
