"""
fix_sheets_formulas.py — One-time script to repair:
  1) Cards sheet K1:N1 ARRAYFORMULA off-by-one (fixes K10:N10 blank)
  2) Calculator sheet #DIV/0! errors (text-to-number coercion)

Run:  python fix_sheets_formulas.py [--dry-run]
"""

import argparse
import os
import time

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
SPREADSHEET_ID = "193mGmiA_T3VFV8PO_wYMcFd4W-CLWLAdspNeSJ6Gllo"


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


# ──────────────────────────────────────────────────────────────
# FIX 1: Cards K1:N1 — change Cards_Data!K2:K → Cards_Data!K:K
# Root cause: ARRAYFORMULA element alignment off-by-one because
# the data reference starts at row 2 but the formula is in row 1.
# ──────────────────────────────────────────────────────────────

CARDS_FORMULAS = {
    "Cards!K1": '=ARRAYFORMULA(IF(ROW(A:A)=1,"AvgProb",Cards_Data!K:K))',
    "Cards!L1": '=ARRAYFORMULA(IF(ROW(A:A)=1,"AvgEdge%",Cards_Data!L:L))',
    "Cards!M1": '=ARRAYFORMULA(IF(ROW(A:A)=1,"CardEV%",Cards_Data!M:M))',
    "Cards!N1": '=ARRAYFORMULA(IF(ROW(A:A)=1,"WinProbCash",Cards_Data!N:N))',
}


# ──────────────────────────────────────────────────────────────
# FIX 2: Calculator — add *1 coercion so AVERAGE/FILTER work
# on text-string values returned by INDEX/MATCH from Legs sheet.
# ──────────────────────────────────────────────────────────────

CALC_FORMULAS = {
    # Row 7: Avg trueProb
    "Calculator!B7": '=IF(COUNTA($B$2:$G$2)=0,"",AVERAGE(FILTER($B$3:$G$3*1,$B$2:$G$2<>"")))',

    # Row 8: Avg edge%
    "Calculator!B8": '=IF(COUNTA($B$2:$G$2)=0,"",AVERAGE(FILTER($B$4:$G$4*1,$B$2:$G$2<>"")))',

    # Rows 11-19 Column C: AvgProb per slip type (add *1 coercion + IFERROR)
    "Calculator!C11": '=IFERROR(AVERAGE(FILTER(B$3:C$3*1,B$3:C$3<>"")),"")',  # 2P
    "Calculator!C12": '=IFERROR(AVERAGE(FILTER(B$3:D$3*1,B$3:D$3<>"")),"")',  # 3P
    "Calculator!C13": '=IFERROR(AVERAGE(FILTER(B$3:D$3*1,B$3:D$3<>"")),"")',  # 3F
    "Calculator!C14": '=IFERROR(AVERAGE(FILTER(B$3:E$3*1,B$3:E$3<>"")),"")',  # 4P
    "Calculator!C15": '=IFERROR(AVERAGE(FILTER(B$3:E$3*1,B$3:E$3<>"")),"")',  # 4F
    "Calculator!C16": '=IFERROR(AVERAGE(FILTER(B$3:F$3*1,B$3:F$3<>"")),"")',  # 5P
    "Calculator!C17": '=IFERROR(AVERAGE(FILTER(B$3:F$3*1,B$3:F$3<>"")),"")',  # 5F
    "Calculator!C18": '=IFERROR(AVERAGE(FILTER(B$3:G$3*1,B$3:G$3<>"")),"")',  # 6P
    "Calculator!C19": '=IFERROR(AVERAGE(FILTER(B$3:G$3*1,B$3:G$3<>"")),"")',  # 6F
}


def main(dry_run: bool = False):
    all_fixes = {**CARDS_FORMULAS, **CALC_FORMULAS}

    print(f"Formulas to fix: {len(all_fixes)}")
    for cell, formula in all_fixes.items():
        print(f"  {cell}: {formula[:80]}{'...' if len(formula)>80 else ''}")

    if dry_run:
        print("\nDry run — no changes pushed.")
        return

    service = get_sheets_service()

    # Push each formula individually using USER_ENTERED so Sheets parses them
    for cell, formula in all_fixes.items():
        print(f"  Writing {cell} ...")
        service.spreadsheets().values().update(
            spreadsheetId=SPREADSHEET_ID,
            range=cell,
            valueInputOption="USER_ENTERED",
            body={"values": [[formula]]},
        ).execute()
        time.sleep(0.3)  # gentle rate limiting

    print(f"\nDone — pushed {len(all_fixes)} formula fixes to Sheets.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Fix Cards K:N array formulas and Calculator #DIV/0! errors."
    )
    parser.add_argument("--dry-run", action="store_true",
                        help="Print formulas without writing to Sheets.")
    args = parser.parse_args()
    main(dry_run=args.dry_run)
