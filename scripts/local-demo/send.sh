#!/usr/bin/env bash
# Send a SIMULATED Telegram update to the local Worker and print what the bot replied
# (as received by the mock Telegram API).  usage: send.sh "/watch <url>" [chat_id]
cd "$(dirname "$0")/../.."
source scripts/local-demo/env.sh
TEXT=$1; CHAT=${2:-$DEMO_CHAT}
before=$(wc -l < "$LOG")
BODY=$(node -e 'console.log(JSON.stringify({update_id: Date.now(), message: {message_id: 1, date: Math.floor(Date.now()/1000), chat: {id: Number(process.argv[2]), type: "private"}, from: {id: Number(process.argv[2]), is_bot: false, first_name: "Demo"}, text: process.argv[1]}}))' "$TEXT" "$CHAT")
status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$WORKER/telegram/webhook" \
  -H "content-type: application/json" -H "x-telegram-bot-api-secret-token: $DEMO_SECRET" -d "$BODY")
for i in $(seq 1 30); do [ "$(wc -l < "$LOG")" -gt "$before" ] && break; sleep 0.5; done
sleep 0.3
echo "  (webhook HTTP $status)"
tail -n +"$((before + 1))" "$LOG"
