// Telegram chat commands: /start /help /watch /list /remove /rate
import { fetchFeed } from "./feed.js";
import { loadSeen, saveSeen, selectNew } from "./dedupe.js";
import { addWatch, listWatches, removeWatch } from "./store.js";
import { escapeHtml } from "./telegram.js";
import { currencyCode, validateFeedUrl } from "./validate.js";
import { parseFeedList } from "./feed.js";

export const HELP = [
  "<b>feed-watch-bot</b>: I post new items from RSS/Atom feeds to this chat.",
  "",
  "/watch &lt;url&gt; - watch a feed (only new items are posted)",
  "/list - show watched feeds",
  "/remove &lt;id&gt; - stop watching a feed",
  "/rate USD EUR - ECB reference exchange rate",
  "/help - this message",
].join("\n");

export const BOT_COMMANDS = [
  { command: "watch", description: "Watch an RSS/Atom feed: /watch <url>" },
  { command: "list", description: "Show watched feeds" },
  { command: "remove", description: "Stop watching: /remove <id>" },
  { command: "rate", description: "Exchange rate: /rate USD EUR" },
  { command: "help", description: "How to use this bot" },
];

/** "/watch@MyBot https://x" -> { name: "watch", args: ["https://x"] } */
export function parseCommand(text) {
  const m = String(text || "").trim().match(/^\/([a-z_]+)(?:@[\w_]+)?(?:\s+([\s\S]*))?$/i);
  if (!m) return null;
  return { name: m[1].toLowerCase(), args: (m[2] || "").trim().split(/\s+/).filter(Boolean) };
}

/**
 * Handle one command and return the reply text (HTML).
 * deps: { env, kv, chatId, fetchImpl }
 */
export async function handleCommand(cmd, { env, kv, chatId, fetchImpl = fetch }) {
  switch (cmd.name) {
    case "start":
    case "help":
      return HELP;
    case "watch":
      return watch(cmd.args[0], { env, kv, chatId, fetchImpl });
    case "list":
      return list({ env, kv, chatId });
    case "remove":
      return remove(cmd.args[0], { kv, chatId });
    case "rate":
      return rate(cmd.args, { env, fetchImpl });
    default:
      return "Unknown command. Send /help for the list.";
  }
}

async function watch(arg, { env, kv, chatId, fetchImpl }) {
  const checked = validateFeedUrl(arg, { allowPrivate: String(env.ALLOW_PRIVATE_FEEDS) === "true" });
  if (!checked.ok) return `⚠️ ${escapeHtml(checked.error)}`;
  const url = checked.url;
  if (parseFeedList(env.FEEDS).includes(url)) return "ℹ️ That feed is already in the bot's fixed list (wrangler.toml).";

  let feed;
  try {
    feed = await fetchFeed(url, { fetchImpl });
  } catch (err) {
    return `⚠️ Could not read a feed at that URL (${escapeHtml(err.message)}).`;
  }
  const max = Number.parseInt(env.MAX_FEEDS_PER_CHAT ?? "10", 10) || 10;
  const res = await addWatch(kv, chatId, { url, title: feed.title || url }, { max });
  if (!res.ok && res.reason === "duplicate") return `ℹ️ Already watching that feed as #${res.watch.id}.`;
  if (!res.ok) return `⚠️ Limit reached (${max} feeds). Remove one with /remove &lt;id&gt; first.`;

  // Remember what is in the feed right now, so only items published from now on are posted.
  const seen = await loadSeen(kv, url);
  const { seen: updated } = selectNew(feed.items, seen, { firstRunPost: false });
  await saveSeen(kv, url, updated);

  return `✅ Watching #${res.watch.id}: <b>${escapeHtml(res.watch.title)}</b>\n${feed.items.length} existing item(s) skipped; new ones will be posted here.`;
}

async function list({ env, kv, chatId }) {
  const fixed = parseFeedList(env.FEEDS);
  const mine = await listWatches(kv, chatId);
  if (!fixed.length && !mine.length) return "No feeds yet. Add one with /watch &lt;url&gt;";
  const lines = ["<b>Watched feeds</b>"];
  for (const w of mine) lines.push(`#${w.id} ${escapeHtml(w.title)}\n   ${escapeHtml(w.url)}`);
  if (fixed.length) {
    lines.push("", "<i>Fixed in wrangler.toml:</i>");
    for (const u of fixed) lines.push(`• ${escapeHtml(u)}`);
  }
  return lines.join("\n");
}

async function remove(arg, { kv, chatId }) {
  if (!/^\d{1,4}$/.test(String(arg || ""))) return "Send it like this: /remove 2 (see /list for ids)";
  const removed = await removeWatch(kv, chatId, Number(arg));
  if (!removed) return `⚠️ No feed with id #${escapeHtml(arg)}. See /list.`;
  return `🗑 Removed #${removed.id}: ${escapeHtml(removed.title)}`;
}

async function rate(args, { env, fetchImpl }) {
  const from = currencyCode(args[0]);
  const to = currencyCode(args[1]);
  if (!from || !to) return "Send it like this: /rate USD EUR (3-letter currency codes)";
  if (from === to) return `1 ${from} = 1 ${to}`;
  const base = env.RATES_API_BASE || "https://api.frankfurter.dev/v1";
  let data;
  try {
    const res = await fetchImpl(`${base}/latest?base=${from}&symbols=${to}`, { signal: AbortSignal.timeout(8000) });
    if (res.status === 404 || res.status === 422) return `⚠️ ${from}/${to} is not available from the ECB reference rates.`;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    return `⚠️ Rate service unavailable (${escapeHtml(err.message)}). Try again later.`;
  }
  const value = data?.rates?.[to];
  if (typeof value !== "number") return `⚠️ ${from}/${to} is not available from the ECB reference rates.`;
  return `💱 1 ${from} = <b>${value}</b> ${to}\n<i>ECB reference rate, ${escapeHtml(data.date || "")} (via Frankfurter)</i>`;
}
