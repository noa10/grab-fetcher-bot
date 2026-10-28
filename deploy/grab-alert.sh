#!/usr/bin/env bash
# Telegram alerting for the grab-fetcher-bot systemd units.
#
# Wired in with drop-ins, so the vendor unit files stay untouched:
#
#   /etc/systemd/system/grab-fetcher.service.d/alerting.conf
#     [Unit]
#     OnFailure=grab-alert@%N.service
#     OnSuccess=grab-recover@%N.service
#
# Usage: grab-alert.sh <unit-base-name> failure|success
#
# <unit-base-name> is systemd's %N, i.e. the unit name without ".service".
#
# Failure alerts are throttled: the first failure notifies immediately, then at
# most once per GRAB_ALERT_THROTTLE seconds (default 4h) while it keeps failing.
# That matters because the order timer retries every 5 minutes — without a
# throttle a broken login would send 288 messages a day.
#
# Recovery messages are only sent for a unit that was actually alerted on, so
# the normal success path costs one stat() and stays silent.
set -uo pipefail

UNIT_BASE="${1:-}"
MODE="${2:-failure}"
if [ -z "$UNIT_BASE" ]; then
  echo "usage: $0 <unit-base-name> <failure|success>" >&2
  exit 2
fi
UNIT="${UNIT_BASE}.service"

STATE_DIR="${GRAB_ALERT_STATE_DIR:-/var/tmp/grab-alert}"
THROTTLE="${GRAB_ALERT_THROTTLE:-14400}"
TARGET="${GRAB_ALERT_TARGET:-telegram}"
HERMES="${HERMES_BIN:-/home/ubuntu/.local/bin/hermes}"
REPO="${GRAB_ALERT_REPO:-/home/ubuntu/repos/grab-fetcher-bot}"

mkdir -p "$STATE_DIR" 2>/dev/null || true
state="$STATE_DIR/${UNIT_BASE}.state"
now=$(date +%s)

send() {
  local msg="$1"
  if [ -x "$HERMES" ]; then
    printf '%s\n' "$msg" | "$HERMES" send --to "$TARGET" --quiet && return 0
    echo "grab-alert: hermes send failed for $UNIT" >&2
    return 1
  fi
  echo "grab-alert: $HERMES not executable, cannot notify" >&2
  return 1
}

# "2d 3h", "3h 12m", "5m" — short enough for a Telegram title line.
human_duration() {
  local s=$1 d h m
  d=$((s / 86400)); h=$(((s % 86400) / 3600)); m=$(((s % 3600) / 60))
  if [ "$d" -gt 0 ]; then printf '%dd %dh' "$d" "$h"
  elif [ "$h" -gt 0 ]; then printf '%dh %dm' "$h" "$m"
  else printf '%dm' "$m"; fi
}

if [ "$MODE" = "success" ]; then
  [ -f "$state" ] || exit 0
  # shellcheck disable=SC1090
  . "$state"
  msg=$(printf '🟢 %s recovered\n\nIt had failed %s time(s) over %s.\nNow: %s' \
    "$UNIT" "${COUNT:-?}" "$(human_duration $(( now - ${FIRST_FAIL:-$now} )))" \
    "$(date -u '+%Y-%m-%d %H:%M UTC')")
  send "$msg" && rm -f "$state"
  exit 0
fi

# --- failure path -----------------------------------------------------------
first=$now
count=1
last_notify=0
if [ -f "$state" ]; then
  # shellcheck disable=SC1090
  . "$state"
  first=${FIRST_FAIL:-$now}
  count=$(( ${COUNT:-0} + 1 ))
  last_notify=${LAST_NOTIFY:-0}
fi

# Record the new count even when the alert itself is throttled.
cat > "$state" <<EOF
FIRST_FAIL=$first
LAST_NOTIFY=$last_notify
COUNT=$count
EOF

if [ "$last_notify" -ne 0 ] && [ $(( now - last_notify )) -lt "$THROTTLE" ]; then
  exit 0
fi

# Ask for each property separately: `systemctl show -p A -p B --value` prints in
# the manager's property order, not the order requested, so positional reads lie.
result=$(systemctl show "$UNIT" -p Result --value 2>/dev/null)
status=$(systemctl show "$UNIT" -p ExecMainStatus --value 2>/dev/null)
result="${result:-unknown}"
status="${status:-?}"

# The logger writes every line twice (two transports), so collapse consecutive
# duplicates before showing the tail. Drop systemd's own accounting line.
log_tail=$(journalctl -u "$UNIT" -n 80 --no-pager -o cat 2>/dev/null \
  | awk 'NF && $0 != prev { print } { prev = $0 }' \
  | grep -vE 'CPU time over|^Consumed ' \
  | tail -n 10 \
  | cut -c1-300)

msg=$(printf '🔴 %s failed\n\nResult: %s (exit %s)\nFailures: %s over %s\nChecked: %s\n\n%s' \
  "$UNIT" "$result" "$status" "$count" \
  "$(human_duration $(( now - first )))" \
  "$(date -u '+%Y-%m-%d %H:%M UTC')" \
  "${log_tail:-<no log output>}")

# Attach the login screenshot when it is fresh — it is the single most useful
# artefact for a portal break. hermes send turns "MEDIA:<path>" into an upload.
shot="$REPO/screenshots/login_error.png"
if [ -f "$shot" ]; then
  age=$(( now - $(stat -c %Y "$shot") ))
  if [ "$age" -lt 900 ]; then
    msg+=$'\n\n'"MEDIA:$shot"
  fi
fi

msg+=$'\n\n'"_(retries every 5 min; this alert repeats at most every $((THROTTLE / 3600))h while it stays broken)_"

if send "$msg"; then
  sed -i "s/^LAST_NOTIFY=.*/LAST_NOTIFY=$now/" "$state"
fi
exit 0
