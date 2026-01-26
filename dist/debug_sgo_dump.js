"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable no-console */
const sports_odds_api_1 = __importDefault(require("sports-odds-api"));
const client = new sports_odds_api_1.default({
    apiKeyHeader: process.env.SPORTS_ODDS_API_KEY_HEADER,
});
async function run() {
    const nbaPage = await client.events.get({
        leagueID: "NBA",
        oddsAvailable: true,
        includeOpposingOdds: true,
        limit: 1,
    });
    console.log(JSON.stringify(nbaPage.data?.map((event) => ({
        eventID: event.eventID,
        teams: event.teams,
        sampleOdds: Object.values(event.odds ?? {}).slice(0, 3),
    })), null, 2));
}
run().catch((err) => {
    console.error(err);
    process.exit(1);
});
