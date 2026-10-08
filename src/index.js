// feed-watch-bot: Cloudflare Worker entry point. A Cron Trigger polls RSS/Atom feeds,
// remembers seen items in Workers KV and posts new ones to a Telegram chat; a webhook
// handles the /watch /list /remove /rate chat commands.
// Only the default export lives here: workerd rejects other named exports.
import { parseFeedList } from "./feed.js";
import { handleSetup, handleWebhook, runOnce, text, WEBHOOK_PATH } from "./app.js";

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runOnce(env));
  },

  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === WEBHOOK_PATH) return handleWebhook(request, env);
    if (pathname === "/setup") return handleSetup(request, env);
    if (pathname === "/" || pathname === "/health") {
      return text(`feed-watch-bot is running. Watching ${parseFeedList(env.FEEDS).length} fixed feed(s).`);
    }
    return text("Not found", 404);
  },
};
