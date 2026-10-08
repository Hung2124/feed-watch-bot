// LOCAL DEMO ONLY. A tiny stand-in for the Telegram Bot API plus a demo RSS feed,
// so the Worker can be exercised with `wrangler dev` without a real bot.
//   POST /bot<token>/<method>   -> prints what the bot would send, returns {ok:true}
//   GET  /demo-feed.xml         -> RSS feed with the demo items
//   POST /demo-feed/add?title=  -> publishes a new demo item
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 8788);
const items = [
  { id: "demo-2", title: "Weekly price list updated" },
  { id: "demo-1", title: "Store opening hours" },
];
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const strip = (s) => String(s).replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function feed() {
  const entries = items
    .map((i) => `<item><title>${esc(i.title)}</title><link>http://127.0.0.1:${PORT}/post/${i.id}</link><guid>${i.id}</guid></item>`)
    .join("");
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Demo Shop News (local)</title>${entries}</channel></rss>`;
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.method === "GET" && url.pathname === "/demo-feed.xml") {
        res.writeHead(200, { "content-type": "application/rss+xml" });
        return res.end(feed());
      }
      if (req.method === "POST" && url.pathname === "/demo-feed/add") {
        const title = url.searchParams.get("title") || "New item";
        items.unshift({ id: `demo-${items.length + 1}`, title });
        console.log(`[demo feed] published: "${title}"`);
        res.writeHead(200);
        return res.end("ok");
      }
      const m = url.pathname.match(/^\/bot[^/]+\/(\w+)$/);
      if (req.method === "POST" && m) {
        const payload = JSON.parse(body || "{}");
        if (m[1] === "sendMessage") {
          console.log(`[mock Telegram] bot -> chat ${payload.chat_id}:`);
          for (const line of strip(payload.text).split("\n")) console.log(`    ${line}`);
        } else {
          console.log(`[mock Telegram] ${m[1]}`);
        }
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ ok: true, result: true }));
      }
      res.writeHead(404);
      res.end("not found");
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`[mock Telegram] listening on http://127.0.0.1:${PORT} (LOCAL DEMO, not the real Telegram API)`));
