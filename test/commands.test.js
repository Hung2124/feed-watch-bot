import { test } from "node:test";
import assert from "node:assert/strict";
import { handleSetup, handleWebhook, runOnce, safeEqual, WEBHOOK_PATH } from "../src/app.js";
import { parseCommand } from "../src/commands.js";
import { currencyCode, validateFeedUrl } from "../src/validate.js";
import { listWatches } from "../src/store.js";
import { fakeFetch, fixture, MemoryKV } from "./helpers.js";

const FEED = "https://example.com/blog/rss.xml";
const ATOM = "https://example.org/tool/releases.atom";
const RATES = "https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR";
const SECRET = "s3cret_TOKEN-123";
const CHAT = 4242;

const envFor = (kv, extra = {}) => ({
  SEEN: kv,
  FEEDS: "",
  TELEGRAM_BOT_TOKEN: "123:TEST",
  TELEGRAM_CHAT_ID: String(CHAT),
  TELEGRAM_WEBHOOK_SECRET: SECRET,
  SEND_DELAY_MS: "0",
  ...extra,
});

function update(text, chatId = CHAT, secret = SECRET) {
  const headers = { "content-type": "application/json" };
  if (secret !== null) headers["x-telegram-bot-api-secret-token"] = secret;
  return new Request(`https://bot.example${WEBHOOK_PATH}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ update_id: 1, message: { message_id: 1, chat: { id: chatId, type: "private" }, text } }),
  });
}

async function send(env, text, routes = {}, opts = {}) {
  const f = fakeFetch(routes, opts);
  const res = await handleWebhook(update(text), env, { fetchImpl: f.impl });
  return { res, sent: f.sent, reply: f.sent.at(-1)?.body.text };
}

// ---------- parsing & validation ----------

test("parseCommand handles bot mentions and arguments", () => {
  assert.deepEqual(parseCommand("/watch@MyBot https://a.example/x"), { name: "watch", args: ["https://a.example/x"] });
  assert.deepEqual(parseCommand("/LIST"), { name: "list", args: [] });
  assert.equal(parseCommand("hello"), null);
});

test("validateFeedUrl rejects unsafe or malformed URLs", () => {
  assert.equal(validateFeedUrl("https://example.com/feed#x").url, "https://example.com/feed");
  for (const bad of [
    "", "not a url", "ftp://example.com/feed", "javascript:alert(1)", "https://user:pw@example.com/feed",
    "http://localhost/feed", "http://127.0.0.1/feed", "http://10.1.2.3/", "http://192.168.1.1/",
    "http://169.254.169.254/latest", "http://172.20.0.1/", "http://[::1]/", "http://2130706433/",
    "http://intranet/feed", "http://printer.local/", "https://x.example/" + "a".repeat(2100),
  ]) {
    assert.equal(validateFeedUrl(bad).ok, false, bad);
  }
  assert.equal(validateFeedUrl("http://127.0.0.1:8788/feed.xml", { allowPrivate: true }).ok, true);
});

test("currencyCode accepts only 3-letter codes", () => {
  assert.equal(currencyCode("usd"), "USD");
  assert.equal(currencyCode("US"), null);
  assert.equal(currencyCode("US1"), null);
});

test("safeEqual", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
  assert.equal(safeEqual(null, "x"), false);
});

// ---------- webhook security ----------

test("webhook rejects a missing or wrong secret token", async () => {
  const env = envFor(new MemoryKV());
  const f = fakeFetch({});
  assert.equal((await handleWebhook(update("/help", CHAT, null), env, { fetchImpl: f.impl })).status, 401);
  assert.equal((await handleWebhook(update("/help", CHAT, "wrong"), env, { fetchImpl: f.impl })).status, 401);
  assert.equal(f.sent.length, 0);
});

test("webhook is disabled when no secret is configured", async () => {
  const env = envFor(new MemoryKV(), { TELEGRAM_WEBHOOK_SECRET: "" });
  assert.equal((await handleWebhook(update("/help"), env)).status, 503);
});

test("messages from other chats are ignored silently", async () => {
  const kv = new MemoryKV();
  const f = fakeFetch({ [FEED]: fixture("rss2.xml") });
  const res = await handleWebhook(update(`/watch ${FEED}`, 999), envFor(kv), { fetchImpl: f.impl });
  assert.equal(res.status, 200);
  assert.equal(f.sent.length, 0);
  assert.equal(kv.puts, 0);
});

test("non-command text and non-POST requests", async () => {
  const env = envFor(new MemoryKV());
  const { sent } = await send(env, "just chatting");
  assert.equal(sent.length, 0);
  const get = await handleWebhook(new Request(`https://bot.example${WEBHOOK_PATH}`), env);
  assert.equal(get.status, 405);
});

// ---------- commands ----------

test("/help and /start reply with the command list", async () => {
  const { reply, sent } = await send(envFor(new MemoryKV()), "/start");
  assert.match(reply, /\/watch/);
  assert.equal(sent[0].body.chat_id, CHAT);
  assert.equal(sent[0].url, "https://api.telegram.org/bot123:TEST/sendMessage");
});

test("/watch stores the feed per chat and marks existing items as seen", async () => {
  const kv = new MemoryKV();
  const env = envFor(kv);
  const { reply } = await send(env, `/watch ${FEED}`, { [FEED]: fixture("rss2.xml") });
  assert.match(reply, /Watching #1: <b>Example Shop Blog<\/b>/);
  assert.match(reply, /3 existing item/);
  const list = await listWatches(kv, String(CHAT));
  assert.deepEqual(list.map((w) => [w.id, w.url]), [[1, FEED]]);

  // the cron run posts nothing until a new item appears
  const s1 = await runOnce(env, { fetchImpl: fakeFetch({ [FEED]: fixture("rss2.xml") }).impl, sleep: async () => {} });
  assert.equal(s1.posted, 0);
  const newer = fixture("rss2.xml").replace("<item>", "<item><title>New!</title><link>https://example.com/n</link><guid>n1</guid></item><item>");
  const f = fakeFetch({ [FEED]: newer });
  const s2 = await runOnce(env, { fetchImpl: f.impl, sleep: async () => {} });
  assert.equal(s2.posted, 1);
  assert.match(f.sent[0].body.text, /New!/);
  assert.equal(f.sent[0].body.chat_id, String(CHAT));
});

test("/watch rejects bad input, non-feeds, duplicates and the per-chat limit", async () => {
  const kv = new MemoryKV();
  const env = envFor(kv, { MAX_FEEDS_PER_CHAT: "1" });
  assert.match((await send(env, "/watch")).reply, /Send it like this/);
  assert.match((await send(env, "/watch http://169.254.169.254/")).reply, /Private, local/);
  assert.match((await send(env, `/watch ${FEED}`, { [FEED]: "<html>nope</html>" })).reply, /Could not read a feed/);
  assert.match((await send(env, `/watch ${FEED}`, { [FEED]: { status: 404 } })).reply, /HTTP 404/);
  assert.match((await send(env, `/watch ${FEED}`, { [FEED]: fixture("rss2.xml") })).reply, /Watching #1/);
  assert.match((await send(env, `/watch ${FEED}`, { [FEED]: fixture("rss2.xml") })).reply, /Already watching/);
  assert.match((await send(env, `/watch ${ATOM}`, { [ATOM]: fixture("atom.xml") })).reply, /Limit reached \(1 feeds\)/);
});

test("/watch of a feed that is already fixed in wrangler.toml", async () => {
  const env = envFor(new MemoryKV(), { FEEDS: FEED });
  assert.match((await send(env, `/watch ${FEED}`)).reply, /already in the bot's fixed list/);
});

test("/list shows chat feeds and fixed feeds; /remove deletes by id", async () => {
  const kv = new MemoryKV();
  const env = envFor(kv, { FEEDS: "https://fixed.example/feed.xml" });
  await send(env, `/watch ${FEED}`, { [FEED]: fixture("rss2.xml") });
  await send(env, `/watch ${ATOM}`, { [ATOM]: fixture("atom.xml") });
  const listed = (await send(env, "/list")).reply;
  assert.match(listed, /#1 Example Shop Blog/);
  assert.match(listed, /#2 Release notes from example\/tool/);
  assert.match(listed, /fixed\.example/);

  assert.match((await send(env, "/remove 1")).reply, /Removed #1/);
  assert.match((await send(env, "/remove 1")).reply, /No feed with id #1/);
  assert.match((await send(env, "/remove abc")).reply, /Send it like this/);
  const after = (await send(env, "/list")).reply;
  assert.doesNotMatch(after, /#1 /);
  assert.match(after, /#2 /);
});

test("/list with nothing configured", async () => {
  assert.match((await send(envFor(new MemoryKV()), "/list")).reply, /No feeds yet/);
});

test("/rate uses the Frankfurter API and validates codes", async () => {
  const env = envFor(new MemoryKV());
  const body = JSON.stringify({ amount: 1, base: "USD", date: "2026-10-08", rates: { EUR: 0.89397 } });
  const ok = await send(env, "/rate usd eur", { [RATES]: body });
  assert.match(ok.reply, /1 USD = <b>0\.89397<\/b> EUR/);
  assert.match(ok.reply, /2026-10-08/);
  assert.match((await send(env, "/rate USD")).reply, /Send it like this/);
  assert.match((await send(env, "/rate USD EURO")).reply, /Send it like this/);
  assert.match((await send(env, "/rate USD VND", { "https://api.frankfurter.dev/v1/latest?base=USD&symbols=VND": { status: 404 } })).reply, /not available/);
  assert.match((await send(env, "/rate USD EUR", { [RATES]: { status: 500 } })).reply, /unavailable/);
  assert.match((await send(env, "/rate EUR EUR")).reply, /1 EUR = 1 EUR/);
});

test("unknown commands get a hint; HTML in input is escaped", async () => {
  const env = envFor(new MemoryKV());
  assert.match((await send(env, "/foo")).reply, /Unknown command/);
  assert.match((await send(env, "/remove <b>")).reply, /Send it like this/);
});

test("replies can go to a local mock Telegram API (TELEGRAM_API_BASE)", async () => {
  const env = envFor(new MemoryKV(), { TELEGRAM_API_BASE: "http://127.0.0.1:8788" });
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  await handleWebhook(update("/help"), env, { fetchImpl });
  assert.deepEqual(calls, ["http://127.0.0.1:8788/bot123:TEST/sendMessage"]);
});

// ---------- /setup ----------

test("/setup registers the webhook with the secret and the command menu", async () => {
  const env = envFor(new MemoryKV());
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
  };
  const bad = await handleSetup(new Request("https://bot.example/setup", { method: "POST", headers: { "x-setup-key": "nope" } }), env, { fetchImpl });
  assert.equal(bad.status, 401);
  const res = await handleSetup(new Request("https://bot.example/setup", { method: "POST", headers: { "x-setup-key": SECRET } }), env, { fetchImpl });
  assert.equal(res.status, 200);
  assert.match(calls[0].url, /\/setWebhook$/);
  assert.equal(calls[0].body.url, `https://bot.example${WEBHOOK_PATH}`);
  assert.equal(calls[0].body.secret_token, SECRET);
  assert.match(calls[1].url, /\/setMyCommands$/);
  assert.ok(calls[1].body.commands.some((c) => c.command === "watch"));
  assert.doesNotMatch(await res.text(), /123:TEST/);
});
