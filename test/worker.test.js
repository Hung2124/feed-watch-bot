import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { runOnce } from "../src/app.js";
import { escapeHtml, formatMessage, sendMessage } from "../src/telegram.js";
import { fakeFetch, fixture, MemoryKV } from "./helpers.js";

const RSS = "https://example.com/blog/rss.xml";
const ATOM = "https://example.org/tool/releases.atom";
const noSleep = async () => {};
const baseEnv = (kv) => ({
  SEEN: kv,
  FEEDS: `${RSS}\n${ATOM}`,
  TELEGRAM_BOT_TOKEN: "123:TEST",
  TELEGRAM_CHAT_ID: "-1001",
  SEND_DELAY_MS: "0",
});

test("first cron run stores seen ids without posting; second run posts only new items", async () => {
  const kv = new MemoryKV();
  const env = baseEnv(kv);
  const first = fakeFetch({ [RSS]: fixture("rss2.xml"), [ATOM]: fixture("atom.xml") });
  const s1 = await runOnce(env, { fetchImpl: first.impl, sleep: noSleep });
  assert.deepEqual(s1, { feeds: 2, posted: 0, errors: [] });
  assert.equal(first.sent.length, 0);
  assert.equal(kv.puts, 2);

  const newer = fixture("rss2.xml").replace(
    "<item>",
    "<item><title>Flash sale</title><link>https://example.com/blog/flash</link><guid>post-104</guid></item><item>",
  );
  const second = fakeFetch({ [RSS]: newer, [ATOM]: fixture("atom.xml") });
  const s2 = await runOnce(env, { fetchImpl: second.impl, sleep: noSleep });
  assert.equal(s2.posted, 1);
  assert.equal(second.sent.length, 1);
  const msg = second.sent[0];
  assert.equal(msg.url, "https://api.telegram.org/bot123:TEST/sendMessage");
  assert.equal(msg.body.chat_id, "-1001");
  assert.equal(msg.body.parse_mode, "HTML");
  assert.match(msg.body.text, /<a href="https:\/\/example.com\/blog\/flash">Flash sale<\/a>/);
  assert.equal(kv.puts, 3); // only the changed feed was written

  const third = fakeFetch({ [RSS]: newer, [ATOM]: fixture("atom.xml") });
  const s3 = await runOnce(env, { fetchImpl: third.impl, sleep: noSleep });
  assert.equal(s3.posted, 0); // deduped
  assert.equal(kv.puts, 3);
});

test("a broken feed is reported but does not stop the others", async () => {
  const kv = new MemoryKV();
  const env = { ...baseEnv(kv), POST_ON_FIRST_RUN: "true", MAX_ITEMS_PER_FEED: "2" };
  const f = fakeFetch({ [RSS]: { status: 500 }, [ATOM]: fixture("atom.xml") });
  const s = await runOnce(env, { fetchImpl: f.impl, sleep: noSleep });
  assert.equal(s.posted, 2);
  assert.equal(s.errors.length, 1);
  assert.match(s.errors[0], /rss\.xml: HTTP 500/);
  // oldest first
  assert.match(f.sent[0].body.text, /v1\.1\.0 &lt;beta&gt;/);
  assert.match(f.sent[1].body.text, /v1\.2\.0/);
});

test("if Telegram fails mid-run, already-posted items are not re-sent next time", async () => {
  const kv = new MemoryKV();
  const env = { ...baseEnv(kv), FEEDS: RSS, POST_ON_FIRST_RUN: "true" };
  const f1 = fakeFetch({ [RSS]: fixture("rss2.xml") }, { telegramStatus: [200, 400] });
  const s1 = await runOnce(env, { fetchImpl: f1.impl, sleep: noSleep });
  assert.equal(s1.posted, 1);
  assert.match(s1.errors[0], /HTTP 400/);
  assert.doesNotMatch(s1.errors[0], /123:TEST/); // token never leaks into logs

  const f2 = fakeFetch({ [RSS]: fixture("rss2.xml") });
  const s2 = await runOnce(env, { fetchImpl: f2.impl, sleep: noSleep });
  assert.equal(s2.posted, 2); // the two that were not delivered yet
  assert.ok(f2.sent.every((m) => !m.body.text.includes("hours")));
});

test("missing secrets give a clear error instead of a silent failure", async () => {
  const kv = new MemoryKV();
  const env = { SEEN: kv, FEEDS: RSS, POST_ON_FIRST_RUN: "true", SEND_DELAY_MS: "0" };
  const s = await runOnce(env, { fetchImpl: fakeFetch({ [RSS]: fixture("rss2.xml") }).impl, sleep: noSleep });
  assert.match(s.errors[0], /wrangler secret put/);
});

test("sendMessage retries once after HTTP 429", async () => {
  const f = fakeFetch({}, { telegramStatus: [429, 200] });
  const waits = [];
  const ok = await sendMessage({ token: "t", chatId: "1", text: "hi", fetchImpl: f.impl, sleep: async (ms) => waits.push(ms) });
  assert.equal(ok, true);
  assert.equal(f.sent.length, 2);
  assert.deepEqual(waits, [1000]);
});

test("message formatting escapes HTML", () => {
  assert.equal(escapeHtml(`<a & "b">`), "&lt;a &amp; &quot;b&quot;&gt;");
  const text = formatMessage("Feed <1>", { title: "A & B", link: "https://x.example/?a=1&b=2" });
  assert.equal(text, '🆕 <a href="https://x.example/?a=1&amp;b=2">A &amp; B</a>\n<i>Feed &lt;1&gt;</i>');
});

test("fetch handler is a health check only", async () => {
  const res = await worker.fetch(new Request("https://bot.example/"), { FEEDS: `${RSS},${ATOM}` });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Watching 2 fixed feed/);
  const res404 = await worker.fetch(new Request("https://bot.example/run"), {});
  assert.equal(res404.status, 404);
});

test("the Worker entry module exports only the default handler (workerd rejects other exports)", async () => {
  const mod = await import("../src/index.js");
  assert.deepEqual(Object.keys(mod), ["default"]);
  assert.equal(typeof mod.default.fetch, "function");
  assert.equal(typeof mod.default.scheduled, "function");
});
