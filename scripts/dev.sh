#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
  .venv/bin/pip install -r backend/requirements.txt
fi

if [[ ! -d frontend/node_modules ]]; then
  (cd frontend && npm install)
fi

echo "Starting API on :8000 and UI on :5173"
(.venv/bin/uvicorn app:app --reload --port 8000 --app-dir backend) &
API_PID=$!
(cd frontend && npm run dev -- --host 127.0.0.1 --port 5173) &
UI_PID=$!
trap 'kill $API_PID $UI_PID 2>/dev/null || true' EXIT
wait
