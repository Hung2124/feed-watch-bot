#!/usr/bin/env bash
cd "$(dirname "$0")/../.."
kill "$(cat /tmp/feed-watch-bot-dev.pid 2>/dev/null)" "$(cat /tmp/feed-watch-bot-mock.pid 2>/dev/null)" 2>/dev/null
pkill -f "wrangler dev --test-scheduled --ip 127.0.0.1 --port 8799" 2>/dev/null
rm -f .dev.vars
echo stopped
