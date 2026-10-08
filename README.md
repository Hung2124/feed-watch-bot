# feed-watch-bot

A tiny **Telegram alert bot that runs on Cloudflare Workers**. No server to rent, nothing to keep online.

Every 15 minutes a **Cron Trigger** checks your RSS / Atom feeds, remembers what it has
already seen in **Workers KV**, and posts each new item to your **Telegram** chat, group or channel.

```
 Cron Trigger (every 15 min)
        │
        ▼
 ┌───────────────┐   fetch    ┌──────────────────────┐
 │  Worker       │──────────▶│ RSS / Atom feeds      │
 │  src/index.js │            └──────────────────────┘
 │               │  seen ids  ┌──────────────────────┐
 │               │◀─────────▶│ Workers KV (SEEN)     │
 │               │            └──────────────────────┘
 │               │ sendMessage┌──────────────────────┐
 │               │──────────▶│ Telegram Bot API      │──▶ your chat
 └───────────────┘            └──────────────────────┘
```

## Features

- Watches any number of **RSS 2.0, RSS 1.0 (RDF) and Atom** feeds (set in `wrangler.toml`).
- **No duplicates:** seen item ids are stored per feed in Workers KV (one key per feed, capped list),
  and KV is only written when something changed.
- **No flood on day one:** the first check of a feed just remembers the existing items
  (`POST_ON_FIRST_RUN = "false"`), then only genuinely new items are posted.
- Posts **oldest first**, at most `MAX_ITEMS_PER_FEED` per feed per run, with a pause between
  messages to respect Telegram's rate limits; retries once on HTTP 429.
- A broken feed is logged and skipped; the other feeds still run. If Telegram fails halfway,
  items that were already delivered are not sent again.
- **Secrets stay secret:** the bot token and chat id are Wrangler secrets, never in the code or in logs.
- Offline unit tests with Node's built-in test runner (`npm test`), no network needed.

## What you need

- A free **Cloudflare account** (your own).
- A **Telegram bot token** from [@BotFather](https://t.me/BotFather) (your own bot).
- **Node.js 22+** on your computer (Wrangler 4 requires it).

## Setup, step by step

### 1. Get the code and install

```bash
git clone <this-repo-url> feed-watch-bot
cd feed-watch-bot
npm install
npm test            # optional: runs the offline tests
```

### 2. Create your Telegram bot

1. In Telegram, open **@BotFather** and send `/newbot`. Choose a name and a username.
2. BotFather replies with a **token** like `123456789:AA...`. Keep it private.
3. Add the bot to the chat where alerts should go:
   - **Private chat:** open your bot and press **Start**.
   - **Group:** add the bot to the group.
   - **Channel:** add the bot as an **administrator** with permission to post.
4. Find the **chat id**: send a message in that chat (in a channel, post something), then open
   `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in your browser and look for
   `"chat":{"id": ...}`. Group and channel ids are negative numbers (e.g. `-100...`).
   For a public channel you can also use its `@channelusername`.

### 3. Log in to Cloudflare from Wrangler

```bash
npx wrangler login      # opens your browser; approve access for your own account
npx wrangler whoami     # check you are on the right account
```

### 4. Create the KV namespace

```bash
npx wrangler kv namespace create SEEN
```

Copy the `id` it prints into `wrangler.toml`, replacing `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`.

### 5. Choose your feeds

Edit `[vars]` in `wrangler.toml`:

```toml
FEEDS = """
https://github.com/cloudflare/workers-sdk/releases.atom
https://example.com/blog/rss.xml
"""
```

Optional settings: `MAX_ITEMS_PER_FEED`, `POST_ON_FIRST_RUN`, `SEND_DELAY_MS`, and the schedule in
`[triggers] crons` (cron times are UTC).

### 6. Add your secrets

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN    # paste the BotFather token when asked
npx wrangler secret put TELEGRAM_CHAT_ID      # paste the chat id
```

They are stored encrypted in your Cloudflare account. You can also add them in the dashboard
under *Workers & Pages → feed-watch-bot → Settings → Variables and Secrets* (type **Secret**).

### 7. Deploy

```bash
npx wrangler deploy
```

That's it. The Worker URL shows a short health message, and the cron runs every 15 minutes.
Watch live logs with:

```bash
npx wrangler tail
```

The first run only records existing items. Wait for a new item in one of your feeds, or set
`POST_ON_FIRST_RUN = "true"` once if you want to see messages immediately.

## Test locally

```bash
cp .dev.vars.example .dev.vars        # put a TEST bot token and chat id here (git-ignored)
npm run dev                           # wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=*/15+*+*+*+*"   # trigger one run
```

## Configuration reference

| Name | Where | Default | Meaning |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | secret | (required) | Token from @BotFather |
| `TELEGRAM_CHAT_ID` | secret | (required) | Chat, group or channel id |
| `FEEDS` | `[vars]` | one example feed | Feed URLs, one per line (commas also work) |
| `MAX_ITEMS_PER_FEED` | `[vars]` | `5` | Max new items posted per feed per run |
| `POST_ON_FIRST_RUN` | `[vars]` | `false` | Post existing items on the first check |
| `SEND_DELAY_MS` | `[vars]` | `1100` | Pause between Telegram messages |
| `SEEN` | KV binding | (required) | Stores seen item ids |
| `crons` | `[triggers]` | `*/15 * * * *` | Schedule (UTC) |

## Free plan notes

A few feeds every 15 minutes is a small workload: 96 cron runs a day, and at most one KV write
per feed per run (only when the feed has new items). Check Cloudflare's current
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and
[KV limits](https://developers.cloudflare.com/kv/platform/limits/) before adding many feeds or
running more often.

## Project layout

```
src/index.js      cron handler (runOnce) + health-check fetch handler
src/feed.js       RSS / Atom / RDF parsing (fast-xml-parser)
src/dedupe.js     KV "seen" bookkeeping and new-item selection
src/telegram.js   sendMessage with HTML escaping and 429 retry
test/             node:test unit tests + XML fixtures
wrangler.toml     Worker name, cron, KV binding, feed list
```

## Scope

- Sends to **Telegram only**.
- Runs on **your own** Cloudflare account with **your own** bot token; the developer never needs
  your password or token.
- Bug fixes for 7 days after delivery are included in the gig. Maintenance after that is not included
  (available as a separate order).

## Hire me

Need a custom Telegram alert bot that runs on your own Cloudflare account? Order on Fiverr:
**FIVERR_GIG_URL** <!-- PLACEHOLDER: replace with the real Fiverr gig link once the gig is live -->

## License

[MIT](LICENSE)
