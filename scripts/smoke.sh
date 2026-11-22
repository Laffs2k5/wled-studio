#!/usr/bin/env bash
# SPDX-License-Identifier: EUPL-1.2
# End-to-end smoke test against a running wled-studio and the demo device:
#   docker compose --profile demo up -d && scripts/smoke.sh
set -euo pipefail
B=${1:-http://127.0.0.1:8080}
DEVICE_HOST=${2:-demo-device:8081}
W=(-H "X-WLED-Studio: 1" -H "Content-Type: application/json")
fail() { echo "FAIL: $*" >&2; exit 1; }

for i in $(seq 1 30); do curl -fsS "$B/api/health" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "$B/api/health" | grep -q ok || fail "health"
curl -fsS "$B/" | grep -q '<div id="root">' || fail "web UI not served"
curl -fsS -D - -o /dev/null "$B/" | grep -qi "content-security-policy: default-src 'self'" || fail "CSP header"

id=$(curl -fsS "${W[@]}" -d "{\"name\":\"Smoke\",\"host\":\"$DEVICE_HOST\"}" "$B/api/devices" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
curl -fsS "$B/api/devices/$id/profile" | python3 -c 'import json,sys; p=json.load(sys.stdin); assert any(e["name"]=="Comet" for e in p["effects"]), p' || fail "profile"
curl -fsS "${W[@]}" -d '{"seg":[{"id":0,"fx":8,"ix":222}]}' "$B/api/devices/$id/state" | grep -q '"ix":222' || fail "live state"
curl -fsS -X POST "${W[@]}" "$B/api/devices/$id/capture/Smoke%20look?preset_id=9" >/dev/null || fail "capture"
curl -fsS "${W[@]}" -d '{"dry_run":false}' "$B/api/devices/$id/push" | grep -q '"done":true' || fail "push"
curl -fsS "$B/api/devices/$id/presets" | grep -q 'Smoke look' || fail "pushed preset not on the device"

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Content-Type: application/json" -d '{}' "$B/api/devices/$id/push")
[ "$code" = 403 ] || fail "write without the guard header answered $code"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: evil.example" "$B/api/health")
[ "$code" = 400 ] || fail "foreign Host header answered $code"
curl -fsS -X DELETE -H "X-WLED-Studio: 1" "$B/api/devices/$id" >/dev/null
echo "smoke test passed"
