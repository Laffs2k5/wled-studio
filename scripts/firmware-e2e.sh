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
# A bare IP must not pass on its reverse DNS: 185.199.110.153 resolves back to
# cdn-185-199-110-153.github.com. (PlatformIO's online check asks for it; any
# answer, a 403 too, counts as online.)
ip=185.199.110.153
code=$(dc exec -T builder curl -sS -m 20 -o /dev/null -w '%{http_code}' "http://$ip/" 2>/dev/null || true)
[ "$code" = 403 ] || fail "the proxy let http://$ip through on its reverse DNS (answered $code)"
code=$(dc exec -T builder curl -sS -m 20 -k -o /dev/null -w '%{http_connect}' "https://$ip/" 2>/dev/null || true)
[ "$code" = 403 ] || fail "the proxy tunnelled to $ip:443 on its reverse DNS (answered $code)"
echo "an IP address whose reverse DNS is allowed: refused"

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

echo "== preflight: a look on the demo device, checked against the gate's image"
did=$(curl -fsS "${W[@]}" -d "{\"name\":\"e2e\",\"host\":\"${DEMO_DEVICE:-demo-device:8081}\"}" "$B/api/devices" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
curl -fsS "${W[@]}" -d '{"seg":[{"id":0,"fx":0}]}' "$B/api/devices/$did/state" > /dev/null
curl -fsS "${W[@]}" -X POST "$B/api/devices/$did/capture/E2E%20solid" > /dev/null
curl -fsS "${W[@]}" -d '{"seg":[{"id":0,"fx":8}]}' "$B/api/devices/$did/state" > /dev/null
curl -fsS "${W[@]}" -X POST "$B/api/devices/$did/capture/E2E%20comet" > /dev/null
# The demo device makes up its effects: its "Solid" is WLED's too, its "Comet" isn't (WLED's
# comet is called Lighthouse). So against the real image one look is ok, the other unavailable.
curl -fsS "$B/api/firmware/jobs/$gid/preflight?device=$did" | python3 -c '
import json, sys
r = json.load(sys.stdin)
rows = {x.get("look"): x for x in r["rows"]}
print(json.dumps({"effects": r["effects"], "counts": r["counts"]}))
print("solid:", rows["E2E solid"]["status"], "| comet:", rows["E2E comet"]["status"], rows["E2E comet"]["notes"])
assert r["effects"] > 200, r["effects"]
assert rows["E2E solid"]["status"] == "ok", rows["E2E solid"]
assert rows["E2E comet"]["status"] == "unavailable" and rows["E2E comet"]["changes"], rows["E2E comet"]
'
echo "== flash: the gate's real image to the demo device (which models WLED's /update), then revert"
# without the client-certificate proxy's header, the plan blocks
curl -fsS "$B/api/firmware/jobs/$gid/flash-plan?device=$did" | python3 -c '
import json, sys
p = json.load(sys.stdin)
assert not p["can_flash"] and [c["id"] for c in p["checks"] if c["level"] == "block"] == ["certificate"], p["checks"]'
C=(-H "X-Client-Cert: e2e")
curl -fsS "${C[@]}" "$B/api/firmware/jobs/$gid/flash-plan?device=$did" | python3 -c '
import json, sys
p = json.load(sys.stdin)
print(json.dumps({"image": p["image"], "checks": [(c["id"], c["level"]) for c in p["checks"]]}))
assert p["can_flash"], p["checks"]
assert p["image"]["size"] and p["image"]["size"] <= p["image"]["slot"] and len(p["image"]["sha256"]) == 64, p["image"]'
follow() {  # follow <run json>: wait for a flash or revert to finish, print its steps
  local rid; rid=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
  for _ in $(seq 1 90); do
    run=$(curl -fsS "$B/api/flashes/$rid")
    [[ $(python3 -c 'import json,sys; print(json.load(sys.stdin)["state"])' <<< "$run") != running ]] && break
    sleep 2
  done
  python3 -c 'import json,sys; r = json.load(sys.stdin); print(r["state"]); [print(" ", s["name"], s["state"], s["detail"]) for s in r["steps"]]' <<< "$run"
}
flash=$(curl -fsS "${W[@]}" "${C[@]}" -d "{\"device\":\"$did\",\"confirm\":\"e2e\"}" "$B/api/firmware/jobs/$gid/flash" | follow)
echo "$flash"
# the demo device keeps its made-up effects after a flash, so the effect-list check warns
grep -q '^warnings$' <<< "$flash" && grep -q 'upload ok Update successful' <<< "$flash" && grep -q 'image ok' <<< "$flash" \
  || { echo "flash: not as expected"; exit 1; }
revert=$(curl -fsS "${W[@]}" "${C[@]}" -d '{"confirm":"e2e"}' "$B/api/devices/$did/revert" | follow)
echo "$revert"
grep -q '^done$' <<< "$revert" || { echo "revert: not as expected"; exit 1; }
echo "firmware end-to-end passed"
