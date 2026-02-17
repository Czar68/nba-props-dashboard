# sheets_push_cards.py – push card data from PrizePicks and Underdog into unified Cards tab

import argparse
import csv
import os
import time

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

# Retries for transient Sheets API errors
SHEETS_RETRIES = 3
SHEETS_RETRY_BASE_DELAY = 2.0

SPREADSHEET_ID = "193mGmiA_T3VFV8PO_wYMcFd4W-CLWLAdspNeSJ6Gllo"

# Data goes to Cards_Data, row 2 down, columns A–AF (added Sport + site column).
TARGET_RANGE = "Cards_Data!A2"

# PrizePicks CSV path (existing)
PRIZEPICKS_CSV_PATH = "prizepicks-cards.csv"

# Underdog CSV path (new)
UNDERDOG_CSV_PATH = "underdog-cards.csv"

# Unified header fields for both PrizePicks and Underdog
# Final intended header row for unified Cards_Data tab:
# Date,CardID,Slip,Legs,Leg1ID,Leg2ID,Leg3ID,Leg4ID,Leg5ID,Leg6ID,AvgProb,AvgEdge,CardEV,WinProbCash,KellyStake,PlayerBlock,selected,portfolioRank,efficiencyScore,kellyMeanReturn,kellyVariance,kellyRawFraction,kellyCappedFraction,kellyFinalFraction,kellyExpectedProfit,kellyMaxWin,kellyRiskAdjustment,kellyIsCapped,kellyCapReasons,runTimestamp
UNIFIED_CSV_HEADER_FIELDS = [
    "site",        # Platform identifier (PP or UD)
    "flexType",    # Slip type
    "cardEv",      # CardEV% (raw decimal)
    "winProbCash",
    "winProbAny",  # Additional field present in CSV
    "avgProb",     # Average of leg true probabilities
    "avgEdgePct",  # Average leg edge in percent
    "leg1Id",
    "leg2Id",
    "leg3Id",
    "leg4Id",
    "leg5Id",
    "leg6Id",
    # Kelly fields
    "kellyMeanReturn",
    "kellyVariance", 
    "kellyRawFraction",
    "kellyCappedFraction",
    "kellyFinalFraction",
    "kellyStake",
    "kellyExpectedProfit",
    "kellyMaxWin",
    "kellyRiskAdjustment",
    "kellyIsCapped",
    "kellyCapReasons",
    # Portfolio fields
    "selected",
    "portfolioRank",
    "efficiencyScore",
    "runTimestamp",
]


_sheets_service = None


def get_sheets_service():
    global _sheets_service
    if _sheets_service is not None:
        return _sheets_service

    creds = None
    if os.path.exists("token.json"):
        creds = Credentials.from_authorized_user_file("token.json", SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(
                "credentials.json", SCOPES
            )
            creds = flow.run_local_server(port=0)
        with open("token.json", "w", encoding="utf-8") as token:
            token.write(creds.to_json())
    _sheets_service = build("sheets", "v4", credentials=creds)
    return _sheets_service


def load_cards_from_csv(csv_path: str, default_site: str):
    """
    Load cards from a CSV file and normalize to unified schema.
    
    Args:
        csv_path: Path to CSV file
        default_site: Site value to use if not present in CSV ('PP' or 'UD')
    
    Returns:
        List of normalized row dictionaries
    """
    if not os.path.exists(csv_path):
        print(f"WARNING: CSV file not found: {csv_path}")
        return []
    
    leg_keys = [f"leg{i}Id" for i in range(1, 7)]
    rows = []
    site_used = default_site  # Track which site is actually used
    
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            print(f"ERROR: CSV {csv_path} has no fieldnames")
            return []
        
        # Check for required fields
        required_fields = ["flexType", "cardEv", "runTimestamp"]
        missing = set(required_fields) - set(reader.fieldnames)
        if missing:
            print(f"WARNING: CSV {csv_path} missing required columns: {missing}")
            # Continue with available fields
        
        for row in reader:
            # Skip completely empty rows
            if not any(row.values()):
                continue
            
            # Normalize site field
            site = row.get("site", default_site)
            if not site:
                site = default_site
            site_used = site  # Update the site that's actually being used
            
            # Create normalized row with all unified fields
            normalized_row = {
                "Sport": row.get("Sport", ""),
                "site": site,
                "flexType": row.get("flexType", ""),
                "cardEv": row.get("cardEv", ""),
                "winProbCash": row.get("winProbCash", ""),
                "winProbAny": row.get("winProbAny", ""),
                "avgProb": row.get("avgProb", ""),
                "avgEdgePct": row.get("avgEdgePct", ""),
                "runTimestamp": row.get("runTimestamp", ""),
                # Kelly fields (with defaults)
                "kellyMeanReturn": row.get("kellyMeanReturn", "0"),
                "kellyVariance": row.get("kellyVariance", "0"),
                "kellyRawFraction": row.get("kellyRawFraction", "0"),
                "kellyCappedFraction": row.get("kellyCappedFraction", "0"),
                "kellyFinalFraction": row.get("kellyFinalFraction", "0"),
                "kellyStake": row.get("kellyStake", "0"),
                "kellyExpectedProfit": row.get("kellyExpectedProfit", "0"),
                "kellyMaxWin": row.get("kellyMaxWin", "0"),
                "kellyRiskAdjustment": row.get("kellyRiskAdjustment", ""),
                "kellyIsCapped": row.get("kellyIsCapped", "False"),
                "kellyCapReasons": row.get("kellyCapReasons", ""),
                # Portfolio fields (with defaults)
                "selected": row.get("selected", "False"),
                "portfolioRank": row.get("portfolioRank", ""),
                "efficiencyScore": row.get("efficiencyScore", "0"),
            }
            
            # Add leg fields
            for leg_key in leg_keys:
                normalized_row[leg_key] = row.get(leg_key, "")
            
            rows.append(normalized_row)
    
    print(f"Loaded {len(rows)} rows from {csv_path} (site: {site_used})")
    return rows


def csv_to_values_split_and_reorder_unified(pp_rows, ud_rows):
    """
    Convert unified PrizePicks and Underdog rows to Sheets format.
    
    Output columns for Cards_Data A–AF:
    A: Sport
    B: runTimestamp (Date)
    C: Card_ID (site: PP or UD)
    D: Slip (flexType)
    E: Legs (computed from non-empty leg IDs)
    F–K: Leg1_ID..Leg6_ID
    L: AvgProb (from avgProb)
    M: AvgEdge% (from avgEdgePct)
    N: CardEV% (cardEv)
    O: WinProbCash (winProbCash)
    P: KellyStake (kellyStake)
    Q: PlayerBlock (placeholder for future use)
    R: selected (portfolio selection)
    S: portfolioRank (1-based rank if selected)
    T: efficiencyScore (EV / cappedKelly)
    U–AE: Kelly detailed fields
    AF: runTimestamp (repeated for consistency)
    """
    leg_keys = [f"leg{i}Id" for i in range(1, 7)]
    all_rows = []
    
    # Process PrizePicks rows
    for row in pp_rows:
        leg_vals = [row.get(k, "") for k in leg_keys]
        legs_count = sum(1 for v in leg_vals if v)

        out_row = [
            row.get("Sport", ""),           # A Sport
            row.get("runTimestamp", ""),    # B Date
            row.get("site", "PP"),          # C Card_ID (site)
            row.get("flexType", ""),        # D Slip
            legs_count,                     # E Legs
            *leg_vals,                      # F–K Leg1_ID..Leg6_ID
            row.get("avgProb", ""),         # L AvgProb
            row.get("avgEdgePct", ""),      # M AvgEdge%
            row.get("cardEv", ""),          # N CardEV%
            row.get("winProbCash", ""),    # O WinProbCash
            row.get("kellyStake", "0"),     # P KellyStake
            "",                             # Q PlayerBlock (placeholder)
            row.get("selected", "False"),   # R selected
            row.get("portfolioRank", ""),   # S portfolioRank
            row.get("efficiencyScore", "0"), # T efficiencyScore
            # Kelly detailed fields U–AE
            row.get("kellyMeanReturn", "0"),
            row.get("kellyVariance", "0"),
            row.get("kellyRawFraction", "0"),
            row.get("kellyCappedFraction", "0"),
            row.get("kellyFinalFraction", "0"),
            row.get("kellyExpectedProfit", "0"),
            row.get("kellyMaxWin", "0"),
            row.get("kellyRiskAdjustment", ""),
            row.get("kellyIsCapped", "False"),
            row.get("kellyCapReasons", ""),
            row.get("runTimestamp", ""),    # AF runTimestamp (repeated)
        ]
        all_rows.append(out_row)
    
    # Process Underdog rows
    for row in ud_rows:
        leg_vals = [row.get(k, "") for k in leg_keys]
        legs_count = sum(1 for v in leg_vals if v)

        out_row = [
            row.get("Sport", ""),           # A Sport
            row.get("runTimestamp", ""),    # B Date
            row.get("site", "UD"),          # C Card_ID (site)
            row.get("flexType", ""),        # D Slip
            legs_count,                     # E Legs
            *leg_vals,                      # F–K Leg1_ID..Leg6_ID
            row.get("avgProb", ""),         # L AvgProb
            row.get("avgEdgePct", ""),      # M AvgEdge%
            row.get("cardEv", ""),          # N CardEV%
            row.get("winProbCash", ""),    # O WinProbCash
            row.get("kellyStake", "0"),     # P KellyStake
            "",                             # Q PlayerBlock (placeholder)
            row.get("selected", "False"),   # R selected
            row.get("portfolioRank", ""),   # S portfolioRank
            row.get("efficiencyScore", "0"), # T efficiencyScore
            # Kelly detailed fields U–AE
            row.get("kellyMeanReturn", "0"),
            row.get("kellyVariance", "0"),
            row.get("kellyRawFraction", "0"),
            row.get("kellyCappedFraction", "0"),
            row.get("kellyFinalFraction", "0"),
            row.get("kellyExpectedProfit", "0"),
            row.get("kellyMaxWin", "0"),
            row.get("kellyRiskAdjustment", ""),
            row.get("kellyIsCapped", "False"),
            row.get("kellyCapReasons", ""),
            row.get("runTimestamp", ""),    # AF runTimestamp (repeated)
        ]
        all_rows.append(out_row)

    return all_rows


def _sheets_request_with_retry(request):
    """Execute a Sheets API request with exponential backoff on 5xx / 429."""
    last_error = None
    for attempt in range(SHEETS_RETRIES):
        try:
            return request.execute()
        except HttpError as e:
            last_error = e
            status = e.resp.status if hasattr(e, "resp") else getattr(e, "status_code", None)
            if status in (429, 500, 502, 503) and attempt < SHEETS_RETRIES - 1:
                delay = SHEETS_RETRY_BASE_DELAY * (2**attempt)
                time.sleep(delay)
                continue
            raise
    if last_error:
        raise last_error


def main(dry_run: bool = False):
    # Load PrizePicks cards
    pp_rows = load_cards_from_csv(PRIZEPICKS_CSV_PATH, "PP")
    
    # Load Underdog cards
    ud_rows = load_cards_from_csv(UNDERDOG_CSV_PATH, "UD")
    
    # Log summary
    pp_count = len(pp_rows)
    ud_count = len(ud_rows)
    total_count = pp_count + ud_count
    
    print(f"Loaded {pp_count} PrizePicks rows, {ud_count} Underdog rows, total {total_count} rows")
    
    if total_count == 0:
        print("WARNING: No card data found from either PrizePicks or Underdog")
        return
    
    # Convert to Sheets format
    values = csv_to_values_split_and_reorder_unified(pp_rows, ud_rows)
    print(f"Converted {len(values)} rows to Sheets format")

    if dry_run:
        print("Dry run: skipping Sheets clear/update.")
        return

    service = get_sheets_service()
    body = {"values": values}

    # Clear A–AE on Cards_Data (row 2 down) - updated for Kelly and portfolio columns
    _sheets_request_with_retry(
        service.spreadsheets().values().clear(
            spreadsheetId=SPREADSHEET_ID,
            range="Cards_Data!A2:AF",
        )
    )

    if values:
        _sheets_request_with_retry(
            service.spreadsheets().values().update(
                spreadsheetId=SPREADSHEET_ID,
                range=TARGET_RANGE,
                valueInputOption="RAW",
                body=body,
            )
        )

    print(f"Pushed {pp_count} PrizePicks rows, {ud_count} Underdog rows, total {total_count} rows to Cards tab")
    
    # Debug: show first row with Sport
    if values:
        first_row = values[0]
        sport = first_row[0] if len(first_row) > 0 else "unknown"
        site = first_row[1] if len(first_row) > 1 else "unknown"
        flex_type = first_row[2] if len(first_row) > 2 else "unknown"
        print(f"First row preview: Sport={sport}, site={site}, flexType={flex_type}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Push card data from CSV to Cards_Data sheet.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only parse CSV and report row count; do not clear or update Sheets.",
    )
    args = parser.parse_args()
    main(dry_run=args.dry_run)
