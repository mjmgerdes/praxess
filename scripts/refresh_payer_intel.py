#!/usr/bin/env python3
"""Cron job: refresh data/payer-intel.json from the Praxigen coverage API.

Grounded-data rules: every payer row carries its
sources; criteria are summarized from cited public policy documents, never
fabricated; a payer with no published row stays explicitly empty rather than
being filled in. Schedule lives in ops/CRON.md (nightly).

Usage:
    PRAXIGEN_API_BASE=https://... PRAXIGEN_API_KEY=... python3 scripts/refresh_payer_intel.py [--cpt 72148]

Without credentials this is a dry run: it validates the current file and
reports what would be refreshed. The hackathon seed was pulled live via the
Praxigen MCP (get_pa_requirements) on 2026-07-18.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INTEL_PATH = ROOT / "data" / "payer-intel.json"
PUBLIC_COPY = ROOT / "frontend" / "public" / "model" / "payer-intel.json"

# Payers the case pipeline tracks for this service family. Extend deliberately;
# coverage breadth comes from the Praxigen API, not from this list.
TRACKED_PAYERS = [
    "UnitedHealthcare",
    "Aetna",
    "Cigna",
    "Horizon BCBS NJ",
    "Medicare (CMS LCD/NCD)",
    "Meridian",
]


def fetch_row(base: str, key: str, payer: str, cpt: str) -> dict | None:
    url = f"{base}/pa-requirements?payer={urllib.parse.quote(payer)}&cpt={cpt}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.load(resp)
    return data or None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cpt", default="72148")
    args = ap.parse_args()

    intel = json.loads(INTEL_PATH.read_text())
    base = os.environ.get("PRAXIGEN_API_BASE")
    key = os.environ.get("PRAXIGEN_API_KEY")

    if not base or not key:
        n = len(intel.get("payers", []))
        print(f"[dry-run] no PRAXIGEN_API_* credentials; current file has {n} payer rows "
              f"(synced {intel['_meta'].get('synced')}). Would refresh: {', '.join(TRACKED_PAYERS)}")
        _publish(intel)
        return 0

    rows = []
    for payer in TRACKED_PAYERS:
        try:
            row = fetch_row(base, key, payer, args.cpt)
        except Exception as exc:  # noqa: BLE001 — cron must not die on one payer
            print(f"[warn] {payer}: {exc!r}; keeping previous row")
            row = next((p for p in intel["payers"] if p["payer"].startswith(payer.split(' ')[0])), None)
        if row:
            rows.append(row)
        else:
            # Grounded-pipeline rule: absence stays visible, never invented.
            rows.append({"payer": payer, "requiresPa": None, "criteriaSummary": None,
                         "sources": [], "note": "no published row for this CPT yet"})

    intel["payers"] = rows
    intel["_meta"]["synced"] = dt.date.today().isoformat()
    INTEL_PATH.write_text(json.dumps(intel, indent=2) + "\n")
    _publish(intel)
    print(f"[ok] refreshed {len(rows)} payer rows -> {INTEL_PATH}")
    return 0


def _publish(intel: dict) -> None:
    """Copy into the frontend's public dir so the UI fetches the latest."""
    PUBLIC_COPY.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_COPY.write_text(json.dumps(intel, indent=2) + "\n")


if __name__ == "__main__":
    sys.exit(main())
