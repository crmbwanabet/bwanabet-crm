// Server-side Telegram dispatcher for the BwanaBet CRM.
// Holds TELEGRAM_BOT_TOKEN; the browser never sees it.
// Same-origin only — does not set Access-Control-Allow-Origin, so cross-origin
// browsers will block the request.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const MAX_BODY_BYTES = 16 * 1024;       // 16 KB header room — Telegram caps at 4096 chars in a message
const MAX_TEXT_LENGTH = 4096;            // Telegram sendMessage hard limit

function parseBody(req) {
  return new Promise(resolve => {
    let data = '';
    let total = 0;
    let aborted = false;
    req.on('data', chunk => {
      if (aborted) return;
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        aborted = true;
        try { req.destroy(); } catch (e) {}
        return resolve(null);
      }
      data += chunk;
    });
    req.on('end', () => {
      if (aborted) return;
      try { resolve(JSON.parse(data)); }
      catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

async function fetchActiveSubscribers() {
  const url = `${SUPABASE_URL}/rest/v1/telegram_subscribers?select=chat_id&is_active=eq.true`;
  const resp = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!resp.ok) return [];
  const json = await resp.json();
  return Array.isArray(json) ? json : [];
}

async function sendOne(chatId, text) {
  return fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'Supabase not configured' });
  if (!TELEGRAM_BOT_TOKEN) return res.status(500).json({ error: 'Telegram not configured' });

  const body = await parseBody(req);
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Invalid JSON body' });

  const { text, chatId } = body;
  if (typeof text !== 'string' || text.length === 0) {
    return res.status(400).json({ error: 'text is required and must be a non-empty string' });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({ error: `text must be ≤ ${MAX_TEXT_LENGTH} characters` });
  }
  if (chatId !== undefined && (typeof chatId !== 'string' && typeof chatId !== 'number')) {
    return res.status(400).json({ error: 'chatId must be a string or number when provided' });
  }

  try {
    if (chatId !== undefined) {
      // Single-recipient mode (used for "Test" buttons targeting a specific subscriber)
      const r = await sendOne(chatId, text);
      if (!r.ok) {
        const detail = await r.text().catch(() => '');
        return res.status(502).json({ error: 'Telegram send failed', detail });
      }
      return res.status(200).json({ sent: 1 });
    }

    const subs = await fetchActiveSubscribers();
    if (!subs.length) return res.status(200).json({ sent: 0, skipped: 'no subscribers' });

    const results = await Promise.allSettled(subs.map(s => sendOne(s.chat_id, text)));
    const sent = results.filter(r => r.status === 'fulfilled' && r.value.ok).length;
    return res.status(200).json({ sent, total: subs.length });
  } catch (e) {
    return res.status(500).json({ error: 'Telegram dispatch failed', detail: e.message });
  }
};
