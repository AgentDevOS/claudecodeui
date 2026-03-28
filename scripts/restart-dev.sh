#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_PORT="${SERVER_PORT:-3001}"
VITE_PORT="${VITE_PORT:-5173}"

get_cwd() {
  local pid="$1"
  lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1
}

is_repo_pid() {
  local pid="$1"
  [[ "$(get_cwd "$pid")" == "$ROOT_DIR" ]]
}

matches_repo_dev_process() {
  local pid="$1"
  local command="$2"

  if ! is_repo_pid "$pid"; then
    return 1
  fi

  case "$command" in
    *"node server/index.js"*|*"/vite"*|*" vite "*|vite)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

collect_pids() {
  ps -axo pid=,command= | while read -r pid command; do
    [[ -n "$pid" ]] || continue
    [[ "$pid" == "$$" ]] && continue
    [[ "$pid" == "$PPID" ]] && continue

    if matches_repo_dev_process "$pid" "$command"; then
      printf '%s\n' "$pid"
    fi
  done

  for port in "$SERVER_PORT" "$VITE_PORT"; do
    while read -r pid; do
      [[ -n "$pid" ]] || continue
      if is_repo_pid "$pid"; then
        printf '%s\n' "$pid"
      fi
    done < <(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  done
}

pids=()
while IFS= read -r pid; do
  [[ -n "$pid" ]] || continue
  pids+=("$pid")
done < <(collect_pids | awk 'NF' | sort -u)

if (( ${#pids[@]} > 0 )); then
  echo "Stopping existing dev processes: ${pids[*]}"
  kill "${pids[@]}" 2>/dev/null || true

  for _ in {1..20}; do
    remaining=()
    for pid in "${pids[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        remaining+=("$pid")
      fi
    done

    if (( ${#remaining[@]} == 0 )); then
      break
    fi

    sleep 0.25
  done

  remaining=()
  for pid in "${pids[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      remaining+=("$pid")
    fi
  done

  if (( ${#remaining[@]} > 0 )); then
    echo "Force stopping stubborn dev processes: ${remaining[*]}"
    kill -9 "${remaining[@]}" 2>/dev/null || true
  fi
fi

exec pnpm run dev:raw
