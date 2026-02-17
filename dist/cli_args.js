"use strict";
// src/cli_args.ts
// CLI argument parsing for odds fetching control
Object.defineProperty(exports, "__esModule", { value: true });
exports.cliArgs = void 0;
exports.parseArgs = parseArgs;
exports.showHelp = showHelp;
const DEFAULT_REFRESH_INTERVAL_MINUTES = 15;
function parseArgs() {
    const args = process.argv.slice(2);
    const result = {
        noFetchOdds: false,
        forceRefreshOdds: false,
        forceSgo: false,
        forceRundown: false,
        refreshIntervalMinutes: DEFAULT_REFRESH_INTERVAL_MINUTES,
        sports: ['NBA'], // Default to NBA only
        help: false,
    };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case "--no-fetch-odds":
            case "--use-cache-only":
                result.noFetchOdds = true;
                break;
            case "--force-refresh-odds":
                result.forceRefreshOdds = true;
                break;
            case "--force-sgo":
                result.forceSgo = true;
                break;
            case "--force-rundown":
                result.forceRundown = true;
                break;
            case "--sports":
                const sportsArg = args[i + 1];
                if (sportsArg && !sportsArg.startsWith("--")) {
                    const sportsList = sportsArg.split(',').map(s => s.trim().toUpperCase());
                    const validSports = ['NBA', 'NFL', 'MLB', 'NHL', 'NCAAB', 'NCAAF'];
                    const invalidSports = sportsList.filter(s => !validSports.includes(s));
                    if (invalidSports.length > 0) {
                        console.error(`Error: Invalid sports "${invalidSports.join(', ')}". Valid sports: ${validSports.join(', ')}`);
                        process.exit(1);
                    }
                    result.sports = sportsList;
                    i++; // Skip the next argument since we consumed it
                }
                else {
                    console.error('Error: --sports requires a comma-separated list of sports.');
                    process.exit(1);
                }
                break;
            case "--refresh-interval-minutes":
                const intervalArg = args[i + 1];
                if (intervalArg && !intervalArg.startsWith("--")) {
                    const parsed = parseInt(intervalArg, 10);
                    if (!isNaN(parsed) && parsed > 0) {
                        result.refreshIntervalMinutes = parsed;
                        i++; // Skip the next argument since we consumed it
                    }
                    else {
                        console.error(`Error: Invalid refresh interval "${intervalArg}". Must be a positive number.`);
                        process.exit(1);
                    }
                }
                else {
                    console.error('Error: --refresh-interval-minutes requires a numeric value.');
                    process.exit(1);
                }
                break;
            case "--help":
            case "-h":
                result.help = true;
                break;
            default:
                // Ignore unknown args to maintain compatibility with existing scripts
                console.warn(`Warning: Unknown argument "${arg}" ignored`);
                break;
        }
    }
    // Validate conflicting arguments
    if (result.noFetchOdds && (result.forceRefreshOdds || result.forceSgo || result.forceRundown)) {
        console.error("Error: --no-fetch-odds is mutually exclusive with force flags.");
        process.exit(1);
    }
    return result;
}
function showHelp() {
    console.log(`
Multi-Sport Props Optimizer - Odds Fetching Control

USAGE:
  ts-node src/run_optimizer.ts [OPTIONS]
  ts-node src/run_underdog_optimizer.ts [OPTIONS]

SPORT SELECTION:
  --sports <list>
        Comma-separated list of sports to process.
        Default: NBA
        Valid: NBA, NFL, MLB, NHL, NCAAB, NCAAF
        Example: --sports NBA,NHL

ODDS FETCHING OPTIONS:
  --no-fetch-odds, --use-cache-only
        Use only cached odds, never fetch from APIs.
        Fails if no valid cache exists.

  --force-refresh-odds
        Force refresh odds from APIs, ignoring cache TTL.
        Respects daily provider limits.

  --force-sgo
        Force SGO API call, bypassing daily call limit.
        Still records usage for tracking.

  --force-rundown
        Force TheRundown API call, bypassing daily data point limit.
        Still records usage for tracking.

  --refresh-interval-minutes <number>
        Set cache TTL / refresh interval in minutes.
        Default: 15 minutes.
        Must be a positive integer.

  --help, -h
        Show this help message.

EXAMPLES:
  # Normal operation with NBA (default)
  ts-node src/run_optimizer.ts

  # Process NBA and NHL
  ts-node src/run_optimizer.ts --sports NBA,NHL

  # Process only NHL
  ts-node src/run_optimizer.ts --sports NHL

  # Use only cached odds (no API calls)
  ts-node src/run_optimizer.ts --no-fetch-odds

  # Force fresh odds from APIs (respects limits)
  ts-node src/run_optimizer.ts --force-refresh-odds

  # Force SGO call even if daily limit reached
  ts-node src/run_optimizer.ts --force-sgo

  # Force TheRundown call even if daily limit reached
  ts-node src/run_optimizer.ts --force-rundown

  # Force both providers (bypass all daily limits)
  ts-node src/run_optimizer.ts --force-sgo --force-rundown

  # Use 30-minute cache interval
  ts-node src/run_optimizer.ts --refresh-interval-minutes 30

CACHE LOCATION:
  .cache/odds-cache.json (in project root)

RATE LIMIT RESPECT:
  - SGO: Primary source, respects token costs and rate limits
  - Odds-API.io: Backup source, 100 requests/day hard limit
  - Cache reduces API calls and stays within limits
`);
}
// Export parsed args for use in modules
exports.cliArgs = parseArgs();
// Show help if requested
if (exports.cliArgs.help) {
    showHelp();
    process.exit(0);
}
