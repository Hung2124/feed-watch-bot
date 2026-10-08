// Input validation for /watch URLs and /rate currency codes.

const PRIVATE_V4 = [
  [0x00000000, 8], // 0.0.0.0/8
  [0x0a000000, 8], // 10.0.0.0/8
  [0x64400000, 10], // 100.64.0.0/10 (carrier-grade NAT)
  [0x7f000000, 8], // 127.0.0.0/8
  [0xa9fe0000, 16], // 169.254.0.0/16 (link-local, cloud metadata)
  [0xac100000, 12], // 172.16.0.0/12
  [0xc0a80000, 16], // 192.168.0.0/16
  [0xe0000000, 4], // 224.0.0.0/4 multicast
  [0xf0000000, 4], // 240.0.0.0/4 reserved
];

function ipv4ToInt(host) {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function isPrivateHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host.startsWith("[")) return true; // IPv6 literals are not accepted
  const n = ipv4ToInt(host);
  if (n !== null) return PRIVATE_V4.some(([base, bits]) => n >>> (32 - bits) === base >>> (32 - bits));
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return true; // decimal / hex encoded IPs
  return !host.includes("."); // single-label names
}

/**
 * Validate a feed URL from a chat message.
 * @returns {{ ok: true, url: string } | { ok: false, error: string }}
 */
export function validateFeedUrl(input, { allowPrivate = false } = {}) {
  const raw = String(input || "").trim();
  if (!raw) return { ok: false, error: "Send it like this: /watch https://example.com/feed.xml" };
  if (raw.length > 2048) return { ok: false, error: "That URL is too long." };
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "That doesn't look like a valid URL." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "Only http(s) feed URLs are supported." };
  if (url.username || url.password) return { ok: false, error: "URLs with a username or password are not accepted." };
  if (!allowPrivate && isPrivateHost(url.hostname)) return { ok: false, error: "Private, local or IP-address hosts are not allowed." };
  url.hash = "";
  return { ok: true, url: url.toString() };
}

/** Validate a 3-letter ISO currency code. Returns the upper-case code or null. */
export function currencyCode(input) {
  const code = String(input || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}
