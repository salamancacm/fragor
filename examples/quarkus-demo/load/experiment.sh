#!/usr/bin/env bash
# One experiment: monitor the services, run the k6 load test, simulate the mirror scenario with
# Fragor and print both side by side. Run from examples/quarkus-demo with the services up.
# Usage: load/experiment.sh <label>   (ORDER_PROFILE=breaker selects the breaker scenario)
set -euo pipefail
label="${1:?usage: load/experiment.sh <label>}"
# The mirror scenario: baseline or breaker, and the "-read-timeout" variant when the client read
# timeouts enforce the deadlines (otherwise the code's @Timeout is modeled as "caller-pool").
scenario="fragor/baseline"
[ "${ORDER_PROFILE:-prod}" = "breaker" ] && scenario="fragor/breaker"
if [ -n "${ORDER_PAYMENT_READ_TIMEOUT:-}" ] && [ "${ORDER_PAYMENT_READ_TIMEOUT}" != "30000" ]; then
  scenario="${scenario}-read-timeout"
fi
scenario="${scenario}.json"
echo "mirror scenario: $scenario"
cli="../../packages/cli/dist/fragor.mjs"
[ -f "$cli" ] || { echo "build the Fragor CLI first: (cd ../.. && pnpm build)"; exit 1; }
mkdir -p results
node load/monitor.mjs "$label" 125 500 > "results/monitor-$label.log" 2>&1 &
monitor=$!
RUN_LABEL="$label" docker compose run --rm k6
wait "$monitor"
rate_args=()
[ -n "${RATE:-}" ] && rate_args=(--set "traffic.web.pattern.rps=${RATE}")
node "$cli" run "$scenario" --json "${rate_args[@]}" > "results/fragor-$label.json"
node load/compare.mjs "results/timeline-$label.json" "results/fragor-$label.json" | tee "results/compare-$label.txt"
