// "Seen items" bookkeeping in Workers KV: one KV key per feed, holding recent item ids.

export const MAX_SEEN_PER_FEED = 300;

/** Short stable key for a feed URL (SHA-256, hex, first 32 chars). */
export async function feedKey(feedUrl) {
  const bytes = new TextEncoder().encode(feedUrl);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `seen:${hex.slice(0, 32)}`;
}

/** Load the seen-id list for a feed. Returns null if the feed was never checked before. */
export async function loadSeen(kv, feedUrl) {
  const raw = await kv.get(await feedKey(feedUrl));
  if (raw === null || raw === undefined) return null;
  try {
    const ids = JSON.parse(raw);
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

export async function saveSeen(kv, feedUrl, ids) {
  await kv.put(await feedKey(feedUrl), JSON.stringify(ids.slice(0, MAX_SEEN_PER_FEED)));
}

/**
 * Decide which items are new.
 * @param items feed items, newest first
 * @param seen  previously seen ids, or null on the first check of this feed
 * @param opts  { firstRunPost: boolean, maxNew: number }
 * @returns {{ fresh: object[], seen: string[], changed: boolean }}
 *   fresh: items to post, oldest first; seen: updated id list (newest first)
 */
export function selectNew(items, seen, { firstRunPost = false, maxNew = 5 } = {}) {
  const ids = items.map((i) => i.id);
  const firstRun = seen === null;
  const known = new Set(seen || []);
  let fresh = items.filter((i) => !known.has(i.id));
  // de-duplicate ids that appear twice inside the same feed
  const once = new Set();
  fresh = fresh.filter((i) => (once.has(i.id) ? false : once.add(i.id)));

  if (firstRun && !firstRunPost) fresh = []; // first check: remember everything, post nothing
  fresh = fresh.slice(0, Math.max(0, maxNew)).reverse(); // newest N, then oldest first for posting

  const merged = [...new Set([...ids, ...(seen || [])])].slice(0, MAX_SEEN_PER_FEED);
  const changed = firstRun || merged.length !== (seen || []).length || merged.some((id, n) => id !== seen[n]);
  return { fresh, seen: merged, changed };
}
