#!/usr/bin/env bash
# SPDX-License-Identifier: EUPL-1.2
# End to end through the egress proxy: the builder's network policy, then a real
# preview job and a real gate build, started through the app's API.
#   WLEDSTUDIO_BUILDER_URL=http://builder:8090 docker compose --profile firmware up -d
#   scripts/firmware-e2e.sh
set -euo pipefail
B=${1:-http://127.0.0.1:8080}
W=(-H "X-WLED-Studio: 1" -H "Content-Type: application/json")
fail() { echo "FAIL: $*" >&2; exit 1; }
dc() { docker compose --profile firmware "$@"; }

echo "== network policy"
if dc exec -T builder curl -sS -m 10 --noproxy '*' -o /dev/null https://example.com 2>/dev/null; then
  fail "the builder reached the internet directly"
fi
echo "direct egress: blocked"
for i in $(seq 1 30); do   # wait for the proxy
  code=$(dc exec -T builder curl -sS -m 20 -o /dev/null -w '%{http_code}' https://github.com 2>/dev/null || true)
  case "$code" in 2*|3*) break ;; esac
  sleep 2
done
case "$code" in 2*|3*) echo "github.com through the proxy: $code" ;; *) fail "github.com through the proxy answered $code" ;; esac
if dc exec -T builder curl -sS -m 20 -o /dev/null https://example.com 2>/dev/null; then
  fail "the proxy let a host outside the allowlist through"
fi
echo "example.com through the proxy: refused"

for i in $(seq 1 60); do curl -fsS "$B/api/firmware/status" 2>/dev/null | grep -q '"enabled":true' && break; sleep 2; done
curl -fsS "$B/api/firmware/status" | grep -q '"status":"ok"' || fail "the app can't reach the builder"

wait_job() {
  local id=$1 limit=$2 state
  for i in $(seq 1 "$limit"); do
    state=$(curl -fsS "$B/api/firmware/jobs/$id" | python3 -c 'import json,sys; print(json.load(sys.stdin)["state"])')
    case "$state" in passed|failed) break ;; esac
    sleep 10
  done
  echo "$state"
}

echo "== preview job (installs Emscripten through the proxy on first use)"
pid=$(curl -fsS "${W[@]}" -d '{"usermods":["studio_example_fx"]}' "$B/api/firmware/previews" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
state=$(wait_job "$pid" 90)
curl -fsS "$B/api/firmware/jobs/$pid/log" | tail -n 5
[ "$state" = passed ] || fail "preview job: $state"
curl -fsS -D - -o /dev/null "$B/api/firmware/jobs/$pid/preview/preview.wasm" | grep -qi "application/wasm" || fail "preview.wasm"

echo "== gate job (stock check, custom build with the example effect)"
gid=$(curl -fsS "${W[@]}" -d '{"pins":"quinled-16.0.1.json","target":"dig-next-2","usermods":["studio_example_fx"]}' "$B/api/firmware/jobs" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
state=$(wait_job "$gid" 240)
curl -fsS "$B/api/firmware/jobs/$gid" | python3 -c 'import json,sys; r=json.load(sys.stdin).get("report",{}); print(json.dumps({k: r.get(k) for k in ("passed","checks","error")}))'
[ "$state" = passed ] || { curl -fsS "$B/api/firmware/jobs/$gid/log" | tail -n 40; fail "gate job: $state"; }
echo "firmware end-to-end passed"
