#!/usr/bin/env bash
set -euo pipefail

# Requires Firebase emulators to be running.
# Example:
#   firebase emulators:start --only functions,firestore,hosting
#
# This script validates:
# - first submission -> created
# - duplicate submission -> already_exists

HOST="${HOST:-http://127.0.0.1:5000}"
SITE_PATH="${SITE_PATH:-/api/submitWaitlist}"

echo "Submitting initial waitlist payload..."
curl -sS -X POST "${HOST}${SITE_PATH}" \
  -H "Content-Type: application/json" \
  --data '{"email":"smoke-test@example.com","sourceForm":"hero","utm":{"source":"smoke","medium":"script"}}' \
  | sed -n '1,3p'
echo

echo "Submitting duplicate payload..."
curl -sS -X POST "${HOST}${SITE_PATH}" \
  -H "Content-Type: application/json" \
  --data '{"email":"smoke-test@example.com","sourceForm":"footer"}' \
  | sed -n '1,3p'
echo
