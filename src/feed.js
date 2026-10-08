// Parse RSS 2.0, RSS 1.0 (RDF) and Atom feeds into a common shape.
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
  // Real feeds (e.g. GitHub release notes) carry large escaped HTML bodies. We only need
  // ids, titles, links and dates, so bodies are kept raw (stopNodes) and the entity limits
  // are raised from the library defaults while staying bounded.
  stopNodes: ["*.content", "*.summary", "*.description", "*.content:encoded", "*.media:group"],
  processEntities: { enabled: true, maxTotalExpansions: 20000, maxExpandedLength: 2_000_000, maxEntityCount: 100 },
  htmlEntities: true,
});

const asArray = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

/** Return the plain text of a node that may be a string, number or {#text: ...}. */
export function text(node) {
  if (node === undefined || node === null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node).trim();
  if (typeof node === "object" && "#text" in node) return String(node["#text"]).trim();
  return "";
}

/** Pick the best link from an Atom <link> element list. */
function atomLink(links) {
  const list = asArray(links);
  const alt = list.find((l) => typeof l === "object" && (!l["@_rel"] || l["@_rel"] === "alternate"));
  const chosen = alt || list[0];
  if (!chosen) return "";
  return typeof chosen === "string" ? chosen.trim() : (chosen["@_href"] || "").trim();
}

function normalise(item) {
  const id = item.id || item.link || `${item.title}|${item.published}`;
  return { id: String(id).trim(), title: item.title || "(untitled)", link: item.link, published: item.published || "" };
}

/**
 * Parse feed XML.
 * @returns {{ title: string, items: {id: string, title: string, link: string, published: string}[] }}
 * Items keep feed order (normally newest first).
 */
export function parseFeed(xml) {
  if (typeof xml !== "string" || !xml.trim()) throw new Error("Empty feed body");
  let doc;
  try {
    doc = parser.parse(xml);
  } catch (err) {
    throw new Error(`Invalid XML: ${err.message}`);
  }

  if (doc.rss && doc.rss.channel) {
    const ch = doc.rss.channel;
    return {
      title: text(ch.title),
      items: asArray(ch.item).map((it) =>
        normalise({
          id: text(it.guid),
          title: text(it.title),
          link: text(it.link),
          published: text(it.pubDate) || text(it["dc:date"]),
        }),
      ),
    };
  }

  if (doc.feed) {
    const f = doc.feed;
    return {
      title: text(f.title),
      items: asArray(f.entry).map((e) =>
        normalise({
          id: text(e.id),
          title: text(e.title),
          link: atomLink(e.link),
          published: text(e.published) || text(e.updated),
        }),
      ),
    };
  }

  const rdf = doc["rdf:RDF"];
  if (rdf) {
    return {
      title: text(rdf.channel && rdf.channel.title),
      items: asArray(rdf.item).map((it) =>
        normalise({
          id: (it["@_rdf:about"] || "").trim(),
          title: text(it.title),
          link: text(it.link),
          published: text(it["dc:date"]),
        }),
      ),
    };
  }

  throw new Error("Not an RSS or Atom feed");
}

/** Split the FEEDS variable (newline, comma or whitespace separated) into unique http(s) URLs. */
export function parseFeedList(value) {
  const urls = String(value || "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));
  return [...new Set(urls)];
}
