"use strict";
// src/test_sgo.ts
Object.defineProperty(exports, "__esModule", { value: true });
const fetch_sgo_props_1 = require("./fetch_sgo_props");
async function main() {
    try {
        const props = await (0, fetch_sgo_props_1.fetchSgoProps)();
        console.log("Got", props.length, "SportsGameOdds props");
        console.log(JSON.stringify(props.slice(0, 10), null, 2));
    }
    catch (err) {
        console.error("fetchSgoProps error:", err);
        process.exit(1);
    }
}
main();
