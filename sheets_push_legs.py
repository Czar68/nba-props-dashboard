# sheets_push_legs.py (LEGS)

import os
import csv

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

SPREADSHEET_ID = "193mGmiA_T3VFV8PO_wYMcFd4W-CLWLAdspNeSJ6Gllo"

# Keep row 1 for headers/formulas; data starts at A2.
TARGET_RANGE = "Legs!A2"

# PrizePicks legs CSV written by run_optimizer.ts
CSV_PATH = "prizepicks-legs.csv"


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
    """Read legs CSV and return data rows (excluding header)."""
    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        try:
            next(reader)  # skip header
        except StopIteration:
            return rows
        for row in reader:
            rows.append(row)
    return rows


def main():
    if not os.path.exists(CSV_PATH):
        raise FileNotFoundError(f"CSV not found: {CSV_PATH}")

    service = get_sheets_service()
    values = csv_to_values(CSV_PATH)
    body = {"values": values}

    # Clear the whole Legs area before pushing new rows.
    # Adjust the end column if you change the legs CSV schema width.
    # Legs CSV now has 16 columns: Sport + A–O = A–P.
    service.spreadsheets().values().clear(
        spreadsheetId=SPREADSHEET_ID,
        range="Legs!A2:P",
    ).execute()

    if values:
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
