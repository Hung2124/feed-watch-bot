import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFeed, parseFeedList } from "../src/feed.js";
import { fixture } from "./helpers.js";

test("parses RSS 2.0: titles, entities, CDATA, guid fallback to link", () => {
  const feed = parseFeed(fixture("rss2.xml"));
  assert.equal(feed.title, "Example Shop Blog");
  assert.equal(feed.items.length, 3);
  assert.deepEqual(feed.items[0], {
    id: "post-103",
    title: "Price drop: Blue Kettle & Mug set",
    link: "https://example.com/blog/price-drop",
    published: "Thu, 08 Oct 2026 09:00:00 GMT",
  });
  assert.equal(feed.items[1].title, "New arrivals <October>");
  assert.equal(feed.items[2].id, "https://example.com/blog/hours"); // no <guid> -> link
});

test("parses Atom: picks rel=alternate link, decodes title", () => {
  const feed = parseFeed(fixture("atom.xml"));
  assert.equal(feed.title, "Release notes from example/tool");
  assert.equal(feed.items.length, 2);
  assert.equal(feed.items[0].id, "tag:example.org,2026:Release/3");
  assert.equal(feed.items[1].link, "https://example.org/tool/releases/tag/v1.1.0");
  assert.equal(feed.items[1].title, "v1.1.0 <beta>");
});

test("parses RSS 1.0 (RDF)", () => {
  const feed = parseFeed(fixture("rdf.xml"));
  assert.equal(feed.title, "Example RDF News");
  assert.deepEqual(feed.items.map((i) => i.id), ["https://example.net/a"]);
});

test("rejects empty bodies and non-feed XML", () => {
  assert.throws(() => parseFeed(""), /Empty feed/);
  assert.throws(() => parseFeed("<html><body>hi</body></html>"), /Not an RSS or Atom feed/);
});

test("parseFeedList splits on commas/newlines, drops junk and duplicates", () => {
  const list = parseFeedList(" https://a.example/feed.xml,\nhttps://b.example/atom \n ftp://nope  https://a.example/feed.xml ");
  assert.deepEqual(list, ["https://a.example/feed.xml", "https://b.example/atom"]);
  assert.deepEqual(parseFeedList(undefined), []);
});

test("large escaped HTML bodies (like GitHub release notes) do not hit entity limits", () => {
  const feed = parseFeed(fixture("atom-large-content.xml"));
  assert.equal(feed.items.length, 1);
  assert.equal(feed.items[0].title, "v2.0.0");
});
