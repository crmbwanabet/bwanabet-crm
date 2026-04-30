// Standalone smoke test for /api/telegram — run with: node tests/telegram.test.js

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'fake-anon-key';
process.env.TELEGRAM_BOT_TOKEN = 'fake-bot-token';

const { Readable } = require('stream');
const path = require('path');

const fetchLog = [];
global.fetch = async (url, opts) => {
  fetchLog.push({ url, opts });
  if (url.includes('telegram_subscribers')) {
    return { ok: true, json: async () => ([{ chat_id: 1001 }, { chat_id: 1002 }]) };
  }
  if (url.includes('api.telegram.org')) {
    return { ok: true, text: async () => 'ok', json: async () => ({ result: 'ok' }) };
  }
  return { ok: false, json: async () => ({}), text: async () => '' };
};

function loadHandler() {
  const p = path.resolve(__dirname, '..', 'api', 'telegram.js');
  delete require.cache[p];
  return require(p);
}

function makeReq(body) {
  const json = JSON.stringify(body);
  const stream = Readable.from([json]);
  stream.method = 'POST';
  return stream;
}

function makeReqRaw(rawText, method = 'POST') {
  const stream = Readable.from([rawText]);
  stream.method = method;
  return stream;
}

function makeRes() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
    setHeader() {}, end() {},
  };
}

let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

(async () => {
  console.log('Running api/telegram.js smoke tests\n');
  const handler = loadHandler();

  console.log('[1] GET rejected');
  {
    const req = makeReqRaw('', 'GET');
    const res = makeRes();
    await handler(req, res);
    assert('GET → 405', res.statusCode === 405);
  }

  console.log('\n[2] Invalid JSON rejected');
  {
    fetchLog.length = 0;
    const req = makeReqRaw('not json', 'POST');
    const res = makeRes();
    await handler(req, res);
    assert('Invalid JSON → 400', res.statusCode === 400);
    assert('No fetch on invalid body', fetchLog.length === 0);
  }

  console.log('\n[3] Missing text');
  {
    const req = makeReq({});
    const res = makeRes();
    await handler(req, res);
    assert('Missing text → 400', res.statusCode === 400);
  }

  console.log('\n[4] Empty text');
  {
    const req = makeReq({ text: '' });
    const res = makeRes();
    await handler(req, res);
    assert('Empty text → 400', res.statusCode === 400);
  }

  console.log('\n[5] Non-string text');
  {
    const req = makeReq({ text: { evil: 'x' } });
    const res = makeRes();
    await handler(req, res);
    assert('Object text → 400', res.statusCode === 400);
  }

  console.log('\n[6] Text over Telegram limit');
  {
    const req = makeReq({ text: 'A'.repeat(5000) });
    const res = makeRes();
    await handler(req, res);
    assert('Over 4096 chars → 400', res.statusCode === 400);
  }

  console.log('\n[7] Body size limit');
  {
    fetchLog.length = 0;
    const req = makeReqRaw('A'.repeat(20 * 1024), 'POST');
    const res = makeRes();
    await handler(req, res);
    assert('Oversized body → 400', res.statusCode === 400);
    assert('No telegram dispatch', !fetchLog.some(c => c.url.includes('api.telegram.org')));
  }

  console.log('\n[8] Happy path: broadcast');
  {
    fetchLog.length = 0;
    const req = makeReq({ text: '✅ <b>Test broadcast</b>' });
    const res = makeRes();
    await handler(req, res);
    assert('200 OK', res.statusCode === 200);
    const tg = fetchLog.filter(c => c.url.includes('api.telegram.org'));
    assert('Sent to 2 subscribers', tg.length === 2);
    if (tg.length) {
      const body = JSON.parse(tg[0].opts.body);
      assert('parse_mode=HTML', body.parse_mode === 'HTML');
      assert('chat_id forwarded', body.chat_id === 1001);
      assert('text forwarded verbatim', body.text === '✅ <b>Test broadcast</b>');
    }
    assert('Body has sent count', res.body && typeof res.body.sent === 'number');
  }

  console.log('\n[9] Happy path: single recipient via chatId');
  {
    fetchLog.length = 0;
    const req = makeReq({ text: 'hi', chatId: 9999 });
    const res = makeRes();
    await handler(req, res);
    assert('200 OK', res.statusCode === 200);
    const tg = fetchLog.filter(c => c.url.includes('api.telegram.org'));
    assert('Sent to 1 recipient', tg.length === 1);
    if (tg.length) {
      const body = JSON.parse(tg[0].opts.body);
      assert('chat_id is the override', body.chat_id === 9999);
    }
    const subsCalls = fetchLog.filter(c => c.url.includes('telegram_subscribers'));
    assert('Did NOT query subscribers in single mode', subsCalls.length === 0);
  }

  console.log('\n[10] Bad chatId type');
  {
    const req = makeReq({ text: 'hi', chatId: { evil: 'x' } });
    const res = makeRes();
    await handler(req, res);
    assert('Bad chatId → 400', res.statusCode === 400);
  }

  console.log('\n[11] No subscribers — graceful');
  {
    const origFetch = global.fetch;
    global.fetch = async (url) => {
      if (url.includes('telegram_subscribers')) return { ok: true, json: async () => [] };
      return origFetch(url);
    };
    const handler2 = loadHandler();
    const req = makeReq({ text: 'hi' });
    const res = makeRes();
    await handler2(req, res);
    assert('200 OK', res.statusCode === 200);
    assert('Body says skipped', res.body && res.body.skipped === 'no subscribers');
    global.fetch = origFetch;
  }

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('Test runner crashed:', e); process.exit(2); });
