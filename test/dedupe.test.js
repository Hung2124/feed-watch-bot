import { test } from "node:test";
import assert from "node:assert/strict";
import { feedKey, loadSeen, saveSeen, selectNew, MAX_SEEN_PER_FEED } from "../src/dedupe.js";
import { MemoryKV } from "./helpers.js";

const items = (...ids) => ids.map((id) => ({ id, title: id, link: `https://x.example/${id}` }));

test("first run remembers everything and posts nothing by default", () => {
  const r = selectNew(items("c", "b", "a"), null);
  assert.deepEqual(r.fresh, []);
  assert.deepEqual(r.seen, ["c", "b", "a"]);
  assert.equal(r.changed, true);
});

test("first run can post when POST_ON_FIRST_RUN is enabled (capped, oldest first)", () => {
  const r = selectNew(items("d", "c", "b", "a"), null, { firstRunPost: true, maxNew: 2 });
  assert.deepEqual(r.fresh.map((i) => i.id), ["c", "d"]);
  assert.deepEqual(r.seen, ["d", "c", "b", "a"]);
});

test("only unseen items are returned, oldest first", () => {
  const r = selectNew(items("e", "d", "c"), ["c", "b", "a"]);
  assert.deepEqual(r.fresh.map((i) => i.id), ["d", "e"]);
  assert.deepEqual(r.seen, ["e", "d", "c", "b", "a"]);
  assert.equal(r.changed, true);
});

test("nothing new -> nothing to post and no KV write needed", () => {
  const r = selectNew(items("c", "b"), ["c", "b", "a"]);
  assert.deepEqual(r.fresh, []);
  assert.equal(r.changed, false);
});

test("duplicate ids inside one feed are posted once", () => {
  const r = selectNew(items("x", "x", "y"), []);
  assert.deepEqual(r.fresh.map((i) => i.id), ["y", "x"]);
});

test("seen list is capped", () => {
  const many = Array.from({ length: MAX_SEEN_PER_FEED + 50 }, (_, i) => `id-${i}`);
  const r = selectNew(items(...many), []);
  assert.equal(r.seen.length, MAX_SEEN_PER_FEED);
});

test("KV round-trip uses a stable hashed key per feed", async () => {
  const kv = new MemoryKV();
  assert.equal(await loadSeen(kv, "https://a.example/feed"), null);
  await saveSeen(kv, "https://a.example/feed", ["1", "2"]);
  assert.deepEqual(await loadSeen(kv, "https://a.example/feed"), ["1", "2"]);
  assert.equal(await feedKey("https://a.example/feed"), await feedKey("https://a.example/feed"));
  assert.notEqual(await feedKey("https://a.example/feed"), await feedKey("https://b.example/feed"));
  assert.match(await feedKey("https://a.example/feed"), /^seen:[0-9a-f]{32}$/);
});
