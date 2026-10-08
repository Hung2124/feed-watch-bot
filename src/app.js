// feed-watch-bot core logic (kept out of index.js: a Worker module may only export handlers).
// Cloudflare Worker: A Cron Trigger polls RSS/Atom feeds,
// remembers seen items in Workers KV and posts new ones to a Telegram chat.
import { fetchFeed, parseFeedList } from "./feed.js";
import { loadSeen, saveSeen, selectNew } from "./dedupe.js";
import { callApi, DEFAULT_API_BASE, formatMessage, sendMessage } from "./telegram.js";
import { BOT_COMMANDS, handleCommand, parseCommand } from "./commands.js";
import { listWatches } from "./store.js";

export const WEBHOOK_PATH = "/telegram/webhook";

function settings(env) {
  return {
    feeds: parseFeedList(env.FEEDS),
    maxNew: Number.parseInt(env.MAX_ITEMS_PER_FEED ?? "5", 10) || 5,
    firstRunPost: String(env.POST_ON_FIRST_RUN ?? "false").toLowerCase() === "true",
    sendDelayMs: Number.parseInt(env.SEND_DELAY_MS ?? "1100", 10),
    apiBase: env.TELEGRAM_API_BASE || DEFAULT_API_BASE,
  };
}

/** Fixed feeds from wrangler.toml plus feeds added with /watch in the configured chat. */
async function feedsToCheck(env, cfg) {
  const urls = [...cfg.feeds];
  if (env.TELEGRAM_CHAT_ID) {
    for (const w of await listWatches(env.SEEN, env.TELEGRAM_CHAT_ID)) if (!urls.includes(w.url)) urls.push(w.url);
  }
  return urls;
}

/** Check every configured feed once. Returns a summary used for logs and tests. */
export async function runOnce(env, { fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const cfg = settings(env);
  if (!env.SEEN) throw new Error("KV binding SEEN is missing (see wrangler.toml)");
  const feeds = await feedsToCheck(env, cfg);
  const summary = { feeds: feeds.length, posted: 0, errors: [] };

  for (const url of feeds) {
    try {
      const feed = await fetchFeed(url, { fetchImpl });
      const seen = await loadSeen(env.SEEN, url);
      const { fresh, seen: updated, changed } = selectNew(feed.items, seen, cfg);

      const posted = new Set();
      try {
        for (const item of fresh) {
          await sendMessage({ token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID, text: formatMessage(feed.title, item), fetchImpl, sleep, apiBase: cfg.apiBase });
          posted.add(item.id);
          summary.posted++;
          if (cfg.sendDelayMs > 0) await sleep(cfg.sendDelayMs); // stay under Telegram's ~1 msg/s per chat
        }
      } catch (err) {
        // keep the items that were already posted, so they are not sent twice; the rest is retried next run
        const freshIds = new Set(fresh.map((i) => i.id));
        await saveSeen(env.SEEN, url, updated.filter((id) => !freshIds.has(id) || posted.has(id)));
        throw err;
      }
      if (changed) await saveSeen(env.SEEN, url, updated);
    } catch (err) {
      // one broken feed must not stop the others; nothing is saved for it, so it is retried next run
      summary.errors.push(`${url}: ${err.message}`);
    }
  }
  console.log(JSON.stringify({ event: "feed-check", ...summary }));
  return summary;
}

/** Constant-time string comparison for secrets. */
export function safeEqual(a, b) {
  const x = new TextEncoder().encode(String(a ?? ""));
  const y = new TextEncoder().encode(String(b ?? ""));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export const text = (body, status = 200) => new Response(body + "\n", { status, headers: { "content-type": "text/plain; charset=utf-8" } });

/**
 * Telegram webhook. Telegram sends the secret we registered in the
 * X-Telegram-Bot-Api-Secret-Token header; anything else is rejected.
 * Only messages from TELEGRAM_CHAT_ID are answered.
 */
export async function handleWebhook(request, env, { fetchImpl = fetch } = {}) {
  if (request.method !== "POST") return text("Method not allowed", 405);
  if (!env.TELEGRAM_WEBHOOK_SECRET) return text("Webhook disabled: TELEGRAM_WEBHOOK_SECRET is not set", 503);
  if (!safeEqual(request.headers.get("x-telegram-bot-api-secret-token"), env.TELEGRAM_WEBHOOK_SECRET)) return text("Unauthorized", 401);

  let update;
  try {
    update = await request.json();
  } catch {
    return text("Bad request", 400);
  }
  const msg = update.message || update.channel_post;
  const chatId = msg?.chat?.id;
  if (!msg || typeof msg.text !== "string" || chatId === undefined) return text("ignored");
  if (String(chatId) !== String(env.TELEGRAM_CHAT_ID)) {
    console.log(JSON.stringify({ event: "webhook-ignored", reason: "chat not allowed" }));
    return text("ignored"); // 200 so Telegram does not retry; no reply to strangers
  }
  const cmd = parseCommand(msg.text);
  if (!cmd) return text("ignored");

  const reply = await handleCommand(cmd, { env, kv: env.SEEN, chatId: String(chatId), fetchImpl });
  try {
    await sendMessage({ token: env.TELEGRAM_BOT_TOKEN, chatId, text: reply, fetchImpl, apiBase: env.TELEGRAM_API_BASE || DEFAULT_API_BASE, previews: false });
  } catch (err) {
    console.log(JSON.stringify({ event: "reply-failed", error: err.message }));
  }
  console.log(JSON.stringify({ event: "command", command: cmd.name }));
  return text("ok");
}

/**
 * One-time setup: registers the webhook (with the secret) and the command menu.
 * POST /setup with header X-Setup-Key: <TELEGRAM_WEBHOOK_SECRET>.
 */
export async function handleSetup(request, env, { fetchImpl = fetch } = {}) {
  if (request.method !== "POST") return text("Use POST with the X-Setup-Key header", 405);
  if (!env.TELEGRAM_WEBHOOK_SECRET || !safeEqual(request.headers.get("x-setup-key"), env.TELEGRAM_WEBHOOK_SECRET)) return text("Unauthorized", 401);
  const apiBase = env.TELEGRAM_API_BASE || DEFAULT_API_BASE;
  const webhookUrl = new URL(WEBHOOK_PATH, request.url).toString();
  try {
    await callApi({
      token: env.TELEGRAM_BOT_TOKEN,
      method: "setWebhook",
      payload: { url: webhookUrl, secret_token: env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ["message", "channel_post"], drop_pending_updates: true },
      fetchImpl,
      apiBase,
    });
    await callApi({ token: env.TELEGRAM_BOT_TOKEN, method: "setMyCommands", payload: { commands: BOT_COMMANDS }, fetchImpl, apiBase });
  } catch (err) {
    return text(`Setup failed: ${err.message}`, 502);
  }
  return text(`Webhook set to ${webhookUrl}`);
}
