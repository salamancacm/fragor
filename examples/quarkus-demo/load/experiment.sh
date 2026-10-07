#!/usr/bin/env bash
# One experiment: monitor the services, run the k6 load test, simulate the mirror scenario with
# Fragor and print both side by side. Run from examples/quarkus-demo with the services up.
# Usage: load/experiment.sh <label>   (ORDER_PROFILE=breaker selects the breaker scenario)
set -euo pipefail
label="${1:?usage: load/experiment.sh <label>}"
scenario="fragor/baseline.json"
[ "${ORDER_PROFILE:-prod}" = "breaker" ] && scenario="fragor/breaker.json"
cli="../../packages/cli/dist/fragor.mjs"
[ -f "$cli" ] || { echo "build the Fragor CLI first: (cd ../.. && pnpm build)"; exit 1; }
mkdir -p results
node load/monitor.mjs "$label" 125 500 > "results/monitor-$label.log" 2>&1 &
monitor=$!
RUN_LABEL="$label" docker compose run --rm k6
wait "$monitor"
node "$cli" run "$scenario" --json > "results/fragor-$label.json"
node load/compare.mjs "results/timeline-$label.json" "results/fragor-$label.json" | tee "results/compare-$label.txt"
