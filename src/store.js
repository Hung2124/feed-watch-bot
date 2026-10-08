// Per-chat watch list stored in Workers KV under "chat:<chatId>:feeds".

export const chatKey = (chatId) => `chat:${chatId}:feeds`;

/** @returns {Promise<{id:number,url:string,title:string,added:string}[]>} */
export async function listWatches(kv, chatId) {
  const raw = await kv.get(chatKey(chatId));
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function saveWatches(kv, chatId, list) {
  await kv.put(chatKey(chatId), JSON.stringify(list));
}

export async function addWatch(kv, chatId, { url, title }, { max = 10, now = () => new Date().toISOString() } = {}) {
  const list = await listWatches(kv, chatId);
  const existing = list.find((w) => w.url === url);
  if (existing) return { ok: false, reason: "duplicate", watch: existing };
  if (list.length >= max) return { ok: false, reason: "limit" };
  const id = list.reduce((m, w) => Math.max(m, w.id), 0) + 1;
  const watch = { id, url, title: String(title || "").slice(0, 200), added: now() };
  list.push(watch);
  await saveWatches(kv, chatId, list);
  return { ok: true, watch };
}

export async function removeWatch(kv, chatId, id) {
  const list = await listWatches(kv, chatId);
  const idx = list.findIndex((w) => w.id === id);
  if (idx === -1) return null;
  const [removed] = list.splice(idx, 1);
  await saveWatches(kv, chatId, list);
  return removed;
}
