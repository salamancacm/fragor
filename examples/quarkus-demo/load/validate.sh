#!/usr/bin/env bash
# Validation matrix: real runs for several loads, both timeout configurations and repetitions.
# Each run restarts every service so runs are independent. Summaries go to
# results/summary-validation-<config>-r<rate>-<rep>.json; then build the report with
#   node load/validation-report.mjs
# Usage: load/validate.sh [repetitions=3] ["rates"="50 100 150"]
set -euo pipefail
reps="${1:-3}"
rates="${2:-50 100 150}"

wait_ready() {
  for _ in $(seq 1 60); do
    [ "$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:8080/checkout)" = "200" ] && return 0
    sleep 2
  done
  echo "services did not become ready" >&2
  return 1
}

run_config() {
  local config="$1"
  docker compose up -d > /dev/null 2>&1
  for rate in $rates; do
    for rep in $(seq 1 "$reps"); do
      docker compose restart > /dev/null 2>&1
      wait_ready
      local label="validation-${config}-r${rate}-${rep}"
      echo "$(date +%H:%M:%S) run $label"
      RATE="$rate" RUN_LABEL="$label" docker compose run --rm k6 > "results/k6-$label.log" 2>&1
      tail -6 "results/k6-$label.log"
    done
  done
}

mkdir -p results
(
  unset ORDER_PAYMENT_READ_TIMEOUT GATEWAY_ORDER_READ_TIMEOUT
  run_config timeout
)
(
  export ORDER_PAYMENT_READ_TIMEOUT=2000 GATEWAY_ORDER_READ_TIMEOUT=10000
  run_config readtimeout
)
echo "$(date +%H:%M:%S) done"
