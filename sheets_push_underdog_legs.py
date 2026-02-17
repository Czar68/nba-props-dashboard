# sheets_push_underdog_legs.py (UD LEGS)

import os
import csv

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

SPREADSHEET_ID = "193mGmiA_T3VFV8PO_wYMcFd4W-CLWLAdspNeSJ6Gllo"

# New tab for Underdog legs
TARGET_RANGE = "UD-Legs!A2"  # keep row 1 for headers/formulas

# Underdog legs CSV written by run_underdog_optimizer.ts
CSV_PATH = "underdog-legs.csv"


def get_sheets_service():
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

    return build("sheets", "v4", credentials=creds)


def csv_to_values(path: str):
    """Read legs CSV, sort by legEv descending, return data rows (excluding header)."""
    rows = []

    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        try:
            header = next(reader)
        except StopIteration:
            return rows

        # Find legEv column index for sorting
        try:
            leg_ev_idx = header.index("legEv")
        except ValueError:
            leg_ev_idx = None

        for row in reader:
            rows.append(row)

    # Sort by legEv descending (largest to smallest)
    if leg_ev_idx is not None and rows:
        rows.sort(key=lambda r: float(r[leg_ev_idx]) if leg_ev_idx < len(r) and r[leg_ev_idx] else 0, reverse=True)

    return rows


def main():
    if not os.path.exists(CSV_PATH):
        raise FileNotFoundError(f"CSV not found: {CSV_PATH}")

    service = get_sheets_service()
    values = csv_to_values(CSV_PATH)

    body = {"values": values}

    # Clear existing UD-Legs data (Sport + 15 data cols + IsNonStandardOdds = 17 cols = A–Q)
    service.spreadsheets().values().clear(
        spreadsheetId=SPREADSHEET_ID,
        range="UD-Legs!A2:Q",
    ).execute()

    if values:
        # Push new UD-Legs data
        service.spreadsheets().values().update(
            spreadsheetId=SPREADSHEET_ID,
            range=TARGET_RANGE,
            valueInputOption="RAW",
            body=body,
        ).execute()

    print(f"Pushed {len(values)} rows to {TARGET_RANGE}")
    
    # Debug: show first row with Sport
    if values:
        first_row = values[0]
        sport = first_row[0] if len(first_row) > 0 else "unknown"
        leg_id = first_row[1] if len(first_row) > 1 else "unknown"
        player = first_row[2] if len(first_row) > 2 else "unknown"
        print(f"First row preview: Sport={sport}, id={leg_id}, player={player}")


if __name__ == "__main__":
    main()
