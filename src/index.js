// feed-watch-bot: Cloudflare Worker. A Cron Trigger polls RSS/Atom feeds,
// remembers seen items in Workers KV and posts new ones to a Telegram chat.
import { parseFeed, parseFeedList } from "./feed.js";
import { loadSeen, saveSeen, selectNew } from "./dedupe.js";
import { formatMessage, sendMessage } from "./telegram.js";

const UA = "feed-watch-bot/1.0 (+https://developers.cloudflare.com/workers/)";

function settings(env) {
  return {
    feeds: parseFeedList(env.FEEDS),
    maxNew: Number.parseInt(env.MAX_ITEMS_PER_FEED ?? "5", 10) || 5,
    firstRunPost: String(env.POST_ON_FIRST_RUN ?? "false").toLowerCase() === "true",
    sendDelayMs: Number.parseInt(env.SEND_DELAY_MS ?? "1100", 10),
  };
}

/** Check every configured feed once. Returns a summary used for logs and tests. */
export async function runOnce(env, { fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const cfg = settings(env);
  const summary = { feeds: cfg.feeds.length, posted: 0, errors: [] };
  if (!env.SEEN) throw new Error("KV binding SEEN is missing (see wrangler.toml)");

  for (const url of cfg.feeds) {
    try {
      const res = await fetchImpl(url, { headers: { "user-agent": UA, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const feed = parseFeed(await res.text());
      const seen = await loadSeen(env.SEEN, url);
      const { fresh, seen: updated, changed } = selectNew(feed.items, seen, cfg);

      const posted = new Set();
      try {
        for (const item of fresh) {
          await sendMessage({ token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID, text: formatMessage(feed.title, item), fetchImpl, sleep });
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

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runOnce(env));
  },

  // Health check only. It never triggers a run or reveals configuration.
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/" || pathname === "/health") {
      return new Response(`feed-watch-bot is running. Watching ${parseFeedList(env.FEEDS).length} feed(s).\n`, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return new Response("Not found\n", { status: 404 });
  },
};
