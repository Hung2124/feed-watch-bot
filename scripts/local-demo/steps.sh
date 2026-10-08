#!/usr/bin/env bash
# The recorded part of the local demo (docs/demo.gif). Typing is simulated;
# every response comes from the real Worker code running in `wrangler dev`.
cd "$(dirname "$0")/../.."
source scripts/local-demo/env.sh
PS="\033[1;32m$\033[0m "
type_cmd() { printf "$PS"; for ((i=0;i<${#1};i++)); do printf '%s' "${1:i:1}"; sleep 0.025; done; sleep 0.3; printf '\n'; }
note() { printf "\033[1;33m# %s\033[0m\n" "$1"; sleep 0.8; }
note "LOCAL DEMO: simulated Telegram updates -> wrangler dev (real Worker code, local KV)"
note "-> mock Telegram API on 127.0.0.1:8788. No real Telegram, no Cloudflare deploy."
type_cmd 'send "/watch http://127.0.0.1:8788/demo-feed.xml"'
scripts/local-demo/send.sh "/watch $MOCK/demo-feed.xml"; sleep 1.2
type_cmd 'send "/watch https://github.com/cloudflare/workers-sdk/releases.atom"'
scripts/local-demo/send.sh "/watch https://github.com/cloudflare/workers-sdk/releases.atom"; sleep 1.2
type_cmd 'send "/rate USD EUR"'
scripts/local-demo/send.sh "/rate USD EUR"; sleep 1.2
type_cmd 'curl -X POST "$MOCK/demo-feed/add?title=Flash+sale+today"   # new item in the feed'
curl -s -X POST "$MOCK/demo-feed/add?title=Flash+sale+today" > /dev/null; sleep 0.5; tail -n 1 "$LOG"; sleep 1
type_cmd 'curl "$WORKER/__scheduled?cron=*/15+*+*+*+*"   # run the cron once'
before=$(wc -l < "$LOG"); curl -s "$WORKER/__scheduled?cron=*/15+*+*+*+*"; echo
for i in $(seq 1 30); do [ "$(wc -l < "$LOG")" -gt "$before" ] && break; sleep 0.5; done; sleep 0.5
tail -n +"$((before + 1))" "$LOG"; sleep 1.2
type_cmd 'send "/list"'
scripts/local-demo/send.sh "/list"; sleep 1.2
type_cmd 'send "/remove 1"'
scripts/local-demo/send.sh "/remove 1"; sleep 1.2
type_cmd 'send "/list" 999   # a chat that is not allowed'
scripts/local-demo/send.sh "/list" 999 | head -1; echo "  (no reply: only TELEGRAM_CHAT_ID is answered)"
sleep 3
