export interface ToolResult { ok: boolean; data?: unknown; error?: string; }

const UA = 'Mozilla/5.0 (compatible; NEXUS-Agent/1.0)';

// ── Web ────────────────────────────────────────────────────────────────────────

export async function webFetch(url: string): Promise<ToolResult> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 6000);
    return { ok: true, data: text };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function rssFeed(url: string, limit = 10): Promise<ToolResult> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const xml = await res.text();

    const items: Array<{ title: string; link: string; description: string; date: string }> = [];
    const itemRe = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/g;
    const titleRe = /<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/;
    const linkRe  = /<link[^>]*>([^<]+)<\/link>|<link[^>]+href="([^"]+)"/;
    const descRe  = /<(?:description|summary|content)[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/(?:description|summary|content)>/;
    const dateRe  = /<(?:pubDate|updated|published)>(.*?)<\/(?:pubDate|updated|published)>/;

    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(xml)) !== null && items.length < limit) {
      const x = m[1];
      items.push({
        title:       titleRe.exec(x)?.[1]?.trim() ?? '',
        link:        ((linkRe.exec(x)?.[1] ?? linkRe.exec(x)?.[2]) ?? '').trim(),
        description: (descRe.exec(x)?.[1] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').slice(0, 280).trim(),
        date:        dateRe.exec(x)?.[1]?.trim() ?? '',
      });
    }
    return { ok: true, data: items };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function htmlExtract(url: string, textSelector: string): Promise<ToolResult> {
  const page = await webFetch(url);
  if (!page.ok) return page;
  const text = String(page.data ?? '');
  // Find text after selector keyword (best-effort for agent context)
  const lower = text.toLowerCase();
  const idx   = lower.indexOf(textSelector.toLowerCase());
  const snippet = idx >= 0 ? text.slice(idx, idx + 800) : text.slice(0, 800);
  return { ok: true, data: snippet };
}

// ── HTTP ───────────────────────────────────────────────────────────────────────

async function doFetch(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<ToolResult> {
  try {
    const opts: RequestInit = {
      method,
      headers: { 'User-Agent': UA, 'Content-Type': 'application/json', ...headers },
      signal: AbortSignal.timeout(15_000),
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res  = await fetch(url, opts);
    const ct   = res.headers.get('content-type') ?? '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    return { ok: res.ok, data, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export const httpGet    = (url: string, headers?: Record<string, string>) => doFetch('GET',    url, undefined, headers);
export const httpPost   = (url: string, body: unknown, headers?: Record<string, string>) => doFetch('POST',   url, body, headers);
export const httpPut    = (url: string, body: unknown, headers?: Record<string, string>) => doFetch('PUT',    url, body, headers);
export const httpPatch  = (url: string, body: unknown, headers?: Record<string, string>) => doFetch('PATCH',  url, body, headers);
export const httpDelete = (url: string, headers?: Record<string, string>) => doFetch('DELETE', url, undefined, headers);

// ── Webhooks / Messaging ───────────────────────────────────────────────────────

export const sendWebhook = (webhookUrl: string, payload: Record<string, unknown>) => httpPost(webhookUrl, payload);

export async function sendDiscord(webhookUrl: string, content: string, username = 'NEXUS'): Promise<ToolResult> {
  return httpPost(webhookUrl, { content, username, embeds: [] });
}

export async function sendSlack(webhookUrl: string, text: string): Promise<ToolResult> {
  return httpPost(webhookUrl, { text });
}

export async function sendTelegram(botToken: string, chatId: string, text: string): Promise<ToolResult> {
  return httpPost(`https://api.telegram.org/bot${botToken}/sendMessage`, { chat_id: chatId, text, parse_mode: 'Markdown' });
}

export async function sendEmail(
  apiKey: string, from: string, to: string, subject: string, html: string
): Promise<ToolResult> {
  // Resend.com API — free tier: 3000 emails/month
  return httpPost('https://api.resend.com/emails', { from, to, subject, html }, { Authorization: `Bearer ${apiKey}` });
}

// ── Transform ─────────────────────────────────────────────────────────────────

export async function runCode(code: string, context: string): Promise<ToolResult> {
  try {
    // eslint-disable-next-line no-new-func
    const fn     = new Function('context', `"use strict";\n${code}`);
    const result = fn(context);
    return { ok: true, data: String(result ?? '') };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function jsonExtract(json: string, path: string): Promise<ToolResult> {
  try {
    const obj  = JSON.parse(json);
    const keys = path.split('.').filter(Boolean);
    let   cur: unknown = obj;
    for (const k of keys) {
      if (cur == null || typeof cur !== 'object') break;
      cur = (cur as Record<string, unknown>)[k];
    }
    return { ok: true, data: typeof cur === 'string' ? cur : JSON.stringify(cur) };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function filterCondition(context: string, condition: string): Promise<ToolResult> {
  try {
    // eslint-disable-next-line no-new-func
    const fn     = new Function('context', `"use strict"; return !!(${condition});`);
    const passes = Boolean(fn(context));
    return { ok: true, data: passes };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export const TOOLS = {
  webFetch, rssFeed, htmlExtract,
  httpGet, httpPost, httpPut, httpPatch, httpDelete,
  sendWebhook, sendDiscord, sendSlack, sendTelegram, sendEmail,
  runCode, jsonExtract, filterCondition,
};
