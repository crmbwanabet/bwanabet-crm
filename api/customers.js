const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const CRM_API_KEY  = process.env.CRM_API_KEY;

const VALID_FIELDS = new Set([
  'id', 'phone_number', 'registration_date', 'last_activity', 'last_deposit_date',
  'sport_bet_amount', 'sport_win_amount', 'sport_bet_count', 'sport_win_count',
  'casino_bet_amount', 'casino_win_amount', 'casino_bet_count', 'casino_win_count',
  'deposit_amount', 'deposit_count', 'withdrawal_amount', 'withdrawal_count',
  'bonus_amount', 'status', 'currency',
]);

const NUMERIC_FIELDS = new Set([
  'sport_bet_amount', 'sport_win_amount', 'sport_bet_count', 'sport_win_count',
  'casino_bet_amount', 'casino_win_amount', 'casino_bet_count', 'casino_win_count',
  'deposit_amount', 'deposit_count', 'withdrawal_amount', 'withdrawal_count',
  'bonus_amount',
]);

function cleanRecord(raw) {
  const record = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!VALID_FIELDS.has(key)) continue;
    if (key === 'phone_number' && value != null) {
      record[key] = String(value).replace(/[^0-9+]/g, '');
    } else if (NUMERIC_FIELDS.has(key)) {
      record[key] = Number(value) || 0;
    } else if (value !== undefined) {
      record[key] = value;
    }
  }
  if (!record.currency) record.currency = 'ZMW';
  return record;
}

async function handlePost(req, res) {
  const body = await parseBody(req);
  if (!body) return res.status(400).json({ error: 'Invalid JSON body' });

  const rows = Array.isArray(body) ? body : [body];
  if (rows.length === 0) return res.status(400).json({ error: 'Empty payload' });
  if (rows.length > 5000) return res.status(400).json({ error: 'Max 5000 records per request' });

  const cleaned = [];
  const errors = [];

  rows.forEach((row, i) => {
    if (!row.id) {
      errors.push({ index: i, error: 'Missing required field: id' });
      return;
    }
    cleaned.push(cleanRecord(row));
  });

  if (cleaned.length === 0) {
    return res.status(400).json({ error: 'No valid records', details: errors });
  }

  // Batch upsert in chunks of 1000
  const BATCH = 1000;
  let upserted = 0;
  for (let i = 0; i < cleaned.length; i += BATCH) {
    const chunk = cleaned.slice(i, i + BATCH);
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/customers`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify(chunk),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      return res.status(502).json({
        error: 'Supabase upsert failed',
        upserted,
        remaining: cleaned.length - upserted,
        detail,
      });
    }
    upserted += chunk.length;
  }

  res.status(200).json({ success: true, upserted, errors });
}

async function handleGet(req, res) {
  const { id, phone, status, limit = '100', offset = '0' } = req.query;

  let url = `${SUPABASE_URL}/rest/v1/customers?select=*`;
  if (id)     url += `&id=eq.${encodeURIComponent(id)}`;
  if (phone)  url += `&phone_number=eq.${encodeURIComponent(phone)}`;
  if (status) url += `&status=eq.${encodeURIComponent(status)}`;
  url += `&limit=${Math.min(parseInt(limit) || 100, 1000)}`;
  url += `&offset=${parseInt(offset) || 0}`;
  url += `&order=last_activity.desc.nullslast`;

  const resp = await fetch(url, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });

  if (!resp.ok) {
    const detail = await resp.text();
    return res.status(502).json({ error: 'Supabase query failed', detail });
  }

  const data = await resp.json();
  res.status(200).json(data);
}

function parseBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(204).end();

  // Auth
  if (!CRM_API_KEY) return res.status(500).json({ error: 'CRM_API_KEY not configured' });
  if (req.headers['x-api-key'] !== CRM_API_KEY) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  try {
    if (req.method === 'POST') return await handlePost(req, res);
    if (req.method === 'GET')  return await handleGet(req, res);
    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: 'Internal error', detail: e.message });
  }
};
