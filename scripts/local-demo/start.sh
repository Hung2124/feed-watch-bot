#!/usr/bin/env bash
# Start the mock Telegram API and `wrangler dev` with FAKE local settings.
# Nothing here talks to the real Telegram API or to Cloudflare's servers.
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/local-demo/env.sh
cat > .dev.vars <<VARS
TELEGRAM_BOT_TOKEN=000000:LOCAL-DEMO-NOT-A-REAL-TOKEN
TELEGRAM_CHAT_ID=$DEMO_CHAT
TELEGRAM_WEBHOOK_SECRET=$DEMO_SECRET
TELEGRAM_API_BASE=$MOCK
ALLOW_PRIVATE_FEEDS=true
SEND_DELAY_MS=0
FEEDS=
VARS
node scripts/local-demo/mock-telegram.mjs > "$LOG" 2>&1 &
echo $! > /tmp/feed-watch-bot-mock.pid
WRANGLER_SEND_METRICS=false npx wrangler dev --test-scheduled --ip 127.0.0.1 --port 8799 --persist-to /tmp/feed-watch-bot-demo-state > /tmp/feed-watch-bot-dev.log 2>&1 &
echo $! > /tmp/feed-watch-bot-dev.pid
for i in $(seq 1 90); do grep -q "Ready on" /tmp/feed-watch-bot-dev.log && break; sleep 2; done
grep -q "Ready on" /tmp/feed-watch-bot-dev.log && echo "worker ready on $WORKER" || { echo "wrangler dev did not start"; exit 1; }
