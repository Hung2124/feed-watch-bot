// Minimal Telegram Bot API client (sendMessage only).

export function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Build an HTML-formatted message for one feed item (kept under Telegram's 4096-char limit). */
export function formatMessage(feedTitle, item) {
  const title = escapeHtml(item.title).slice(0, 300);
  const source = escapeHtml(feedTitle || "feed").slice(0, 100);
  const line = item.link ? `<a href="${escapeHtml(item.link)}">${title}</a>` : `<b>${title}</b>`;
  return `🆕 ${line}\n<i>${source}</i>`;
}

/**
 * Send one message. Retries once after Telegram's retry_after on HTTP 429.
 * @param fetchImpl injectable fetch for tests
 */
export async function sendMessage({ token, chatId, text, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  if (!token || !chatId) throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set (wrangler secret put ...)");
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: false } });
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body });
    if (res.ok) return true;
    let info = {};
    try {
      info = await res.json();
    } catch {}
    if (res.status === 429 && attempt === 0) {
      const wait = Number(info?.parameters?.retry_after || 1);
      await sleep(Math.min(wait, 30) * 1000);
      continue;
    }
    // never include the token in errors
    throw new Error(`Telegram sendMessage failed: HTTP ${res.status} ${info.description || ""}`.trim());
  }
  return false;
}
