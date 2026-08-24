#!/bin/bash
# Double-click in Finder, or run: ./start-game.command

set -u

APP_PORT=5173
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR"

# Finder-launched .command files have a tiny PATH. Pick up Homebrew / nvm Node.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
fi

echo "=========================================="
echo "LAB 7"
echo "=========================================="
echo

SERVER_PID=""

cleanup() {
  if [ -n "${SERVER_PID}" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if lsof -nP -iTCP:"${APP_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[INFO] Server already running on port ${APP_PORT}."
else
  echo "[INFO] Starting local server in \"${APP_DIR}\"..."
  if command -v node >/dev/null 2>&1; then
    PORT="$APP_PORT" node "$APP_DIR/server.js" &
    SERVER_PID=$!
  else
    echo "[WARN] Node not found. Falling back to npx serve."
    if ! command -v npx >/dev/null 2>&1; then
      echo "[ERROR] Neither node nor npx is available. Install Node.js first: https://nodejs.org/"
      echo
      read -r -p "Press Enter to close..."
      exit 1
    fi
    npx --yes serve -l "$APP_PORT" . &
    SERVER_PID=$!
  fi
  echo "[INFO] Waiting for server..."
  ready=0
  for _ in $(seq 1 20); do
    if curl -fsS --max-time 1 "http://127.0.0.1:${APP_PORT}/" >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 0.3
  done
  if [ "$ready" != "1" ]; then
    echo "[ERROR] Server did not become ready on port ${APP_PORT}."
    echo
    read -r -p "Press Enter to close..."
    exit 1
  fi
fi

GAME_URL="http://localhost:${APP_PORT}/"
echo "[INFO] Opening game: ${GAME_URL}"
open "$GAME_URL"

echo
echo "[INFO] Do not open index.html via file:// double-click."
echo "[INFO] Close this window or press Ctrl+C to stop the server."
echo

if [ -n "${SERVER_PID}" ]; then
  wait "$SERVER_PID"
else
  read -r -p "Press Enter to close..."
fi
