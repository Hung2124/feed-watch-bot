import { readFileSync } from "node:fs";

export const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

/** In-memory stand-in for a Workers KV namespace. */
export class MemoryKV {
  constructor() {
    this.store = new Map();
    this.puts = 0;
  }
  async get(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  async put(key, value) {
    this.puts++;
    this.store.set(key, String(value));
  }
}

/**
 * Fake fetch: feed URLs return fixture XML, Telegram calls are recorded.
 * routes: { [url]: string | {status:number, body?:string} }
 */
export function fakeFetch(routes, { telegramStatus = [] } = {}) {
  const sent = [];
  const statuses = [...telegramStatus];
  const impl = async (url, init = {}) => {
    if (url.startsWith("https://api.telegram.org/")) {
      const status = statuses.length ? statuses.shift() : 200;
      sent.push({ url, body: JSON.parse(init.body), status });
      const payload = status === 200 ? { ok: true } : status === 429 ? { ok: false, parameters: { retry_after: 1 } } : { ok: false, description: "Bad Request" };
      return new Response(JSON.stringify(payload), { status });
    }
    const route = routes[url];
    if (route === undefined) return new Response("not found", { status: 404 });
    if (typeof route === "string") return new Response(route, { status: 200 });
    return new Response(route.body ?? "", { status: route.status });
  };
  return { impl, sent };
}
