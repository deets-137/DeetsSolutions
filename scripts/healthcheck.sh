#!/usr/bin/env bash
# Deets.Solutions health check — run ad-hoc to see whether the domain is
# resolving to Cloudflare (good) or still leaking to Squarespace (bad).
#
#   bash scripts/healthcheck.sh
#
# Exit code 0 = all green, 1 = something is pointing at Squarespace / down.

set -u

APEX="deets.solutions"
HOSTS=("deets.solutions" "www.deets.solutions")
RESOLVERS=("1.1.1.1" "8.8.8.8")           # Cloudflare + Google, to catch splits
EXPECT_NS_MATCH="ns.cloudflare.com"

# Known Squarespace endpoints — if any of these appear, DNS is leaking.
SQSP_IPS_RE='198\.185\.159\.|198\.49\.23\.|198\.49\.22\.'
SQSP_BODY_RE='Squarespace|No Such Website|site .*been deleted'

green() { printf '\033[32m%s\033[0m' "$1"; }
red()   { printf '\033[31m%s\033[0m' "$1"; }
yellow(){ printf '\033[33m%s\033[0m' "$1"; }
ok()    { printf '  %s %s\n' "$(green '[OK]')"   "$1"; }
fail()  { printf '  %s %s\n' "$(red   '[FAIL]')" "$1"; FAILED=1; }
warn()  { printf '  %s %s\n' "$(yellow '[WARN]')" "$1"; }

FAILED=0

# Extract A/AAAA answers from a Windows/Unix `nslookup HOST RESOLVER` — grab every
# IP-looking token that appears at or after the "Name:" line (skips the resolver's
# own "Address:" line printed above it).
resolve() {
  local host="$1" resolver="$2"
  nslookup "$host" "$resolver" 2>/dev/null \
    | awk '/^Name:/{f=1} f' \
    | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}|([0-9a-fA-F]{0,4}:){3,}[0-9a-fA-F:]+' \
    | grep -v "^${resolver}$" | sort -u
}

echo "=============================================="
echo " Deets.Solutions health check — $(date '+%Y-%m-%d %H:%M:%S')"
echo "=============================================="

# 1) Nameservers ---------------------------------------------------------------
echo
echo "Nameservers ($APEX)"
NS=$(nslookup -type=NS "$APEX" 1.1.1.1 2>/dev/null | grep -i "nameserver" | sed 's/.*= *//' | sort -u)
if [ -z "$NS" ]; then
  fail "could not read NS records"
else
  echo "$NS" | sed 's/^/    /'
  if echo "$NS" | grep -qi "$EXPECT_NS_MATCH"; then
    ok "delegated to Cloudflare"
  else
    fail "NOT on Cloudflare nameservers (still $(echo "$NS" | head -1))"
  fi
fi

# 2) Resolution (per host, per resolver) --------------------------------------
for host in "${HOSTS[@]}"; do
  echo
  echo "DNS resolution — $host"
  for r in "${RESOLVERS[@]}"; do
    ips=$(resolve "$host" "$r")
    if [ -z "$ips" ]; then
      fail "$host via $r → no answer"
      continue
    fi
    joined=$(echo "$ips" | paste -sd' ' -)
    if echo "$ips" | grep -qE "$SQSP_IPS_RE"; then
      fail "$host via $r → LEAKS to Squarespace: $joined"
    else
      ok "$host via $r → $joined"
    fi
  done
done

# 3) What the site actually serves (HTTP) -------------------------------------
for host in "${HOSTS[@]}"; do
  echo
  echo "HTTP — https://$host"
  headers=$(curl -sS -I --max-time 15 "https://$host" 2>/dev/null)
  if [ -z "$headers" ]; then
    fail "no HTTP response"
    continue
  fi
  status=$(echo "$headers" | grep -iE '^HTTP/' | tail -1 | tr -d '\r')
  server=$(echo "$headers" | grep -iE '^Server:' | tail -1 | tr -d '\r' | sed 's/^[Ss]erver: *//')
  title=$(curl -sS --max-time 15 "https://$host" 2>/dev/null | grep -ioE '<title>[^<]*</title>' | head -1)

  printf '    %s\n' "$status"
  printf '    Server: %s\n' "${server:-<none>}"
  [ -n "$title" ] && printf '    %s\n' "$title"

  if echo "$server" | grep -qi "squarespace" || echo "$title" | grep -qiE "$SQSP_BODY_RE"; then
    fail "$host is being served by SQUARESPACE (stale record)"
  elif echo "$status" | grep -qE ' 200'; then
    if echo "$server" | grep -qi "cloudflare"; then
      ok "$host served by Cloudflare, HTTP 200"
    else
      warn "$host HTTP 200 but Server='$server' (expected cloudflare)"
    fi
  else
    fail "$host returned '$status'"
  fi
done

# Verdict ---------------------------------------------------------------------
echo
echo "----------------------------------------------"
if [ "$FAILED" -eq 0 ]; then
  echo " $(green 'ALL GREEN') — pointing at Cloudflare, serving your site."
else
  echo " $(red 'PROBLEMS FOUND') — see [FAIL] lines above."
  echo " Most common cause: a stale Squarespace A/AAAA/CNAME record still in"
  echo " Cloudflare DNS. Fix: Cloudflare → deets.solutions → DNS → Records,"
  echo " delete any record whose target is a Squarespace IP (198.185.159.x /"
  echo " 198.49.23.x) or *.squarespace.com. Keep only the Pages records."
fi
echo "----------------------------------------------"

exit "$FAILED"
