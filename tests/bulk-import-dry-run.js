// Dry-run simulator for the agent bulk-import flow.
// Reads the user's CSV (path passed as arg or default), parses it the same way
// SheetJS would, then mirrors the exact normalization logic from
// AgentManager.processAgentListUpload — but skips the actual DB insert.
//
// Run: node tests/bulk-import-dry-run.js "C:/Users/USER/Downloads/Bwana Agents list - Sheet1.csv"

const fs = require('fs');
const path = require('path');

const csvPath = process.argv[2] || 'C:/Users/USER/Downloads/Bwana Agents list - Sheet1.csv';

// ===== Mirrors of the in-app helpers =====
const cyrillicToLatin = {
  'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E', 'Н': 'H', 'К': 'K', 'М': 'M',
  'О': 'O', 'Р': 'P', 'Т': 'T', 'Х': 'X', 'У': 'Y', 'З': '3', 'І': 'I',
  'а': 'a', 'с': 'c', 'е': 'e', 'о': 'o', 'р': 'p', 'х': 'x', 'у': 'y',
  'і': 'i', 'ѕ': 's', 'ј': 'j',
};
function sanitizePromoCode(code) {
  if (!code) return code;
  return String(code).split('').map(c => cyrillicToLatin[c] || c).join('').trim().toUpperCase();
}

// Lightweight CSV parser that handles RFC-4180-ish quoted fields with embedded
// commas and newlines. Mirrors what SheetJS does for CSVs.
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i+1] === '"') { cur += '"'; i += 2; continue; }
      if (ch === '"') { inQuotes = false; i++; continue; }
      cur += ch; i++; continue;
    } else {
      if (ch === '"') { inQuotes = true; i++; continue; }
      if (ch === ',') { row.push(cur); cur = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; i++; continue; }
      cur += ch; i++; continue;
    }
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

// Phone normalization mirror — must match AgentManager.processAgentListUpload
function normalizePhone(raw) {
  let s = String(raw || '').split(/[\/;,]/)[0]; // take first number when multi-number
  let phone = s.replace(/[^0-9+]/g, '').trim();
  if (!phone) return null;
  if (phone.startsWith('+')) {
    // keep
  } else if (phone.startsWith('260')) {
    phone = '+' + phone;
  } else if (phone.startsWith('0') && phone.length >= 9) {
    phone = '+260' + phone.slice(1);
  } else if (phone.length >= 9) {
    phone = '+260' + phone;
  }
  if (phone.replace(/\D/g, '').length > 15) return null; // ITU max
  return phone;
}

// ===== Main =====
console.log(`Dry-run import simulator for: ${csvPath}\n`);

let raw;
try {
  raw = fs.readFileSync(csvPath, 'utf8');
} catch (e) {
  console.error('Could not read CSV:', e.message);
  process.exit(1);
}

// Strip UTF-8 BOM if present
if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);

const allRows = parseCSV(raw);
console.log(`Parsed ${allRows.length} CSV rows total`);
console.log(`(Layout assumes row 0 = title, row 1 = header, rows 2+ = data)\n`);

// Apply the exact same loop as processAgentListUpload
let created = 0, skipped = 0, errors = [];
const seenCodes = new Set();
const samples = [];
const phoneNormStats = { withPlus: 0, with260: 0, with0: 0, bareDigits: 0, empty: 0, other: 0 };
const planStats = { loss_based: 0, nil: 0 };
const skipReasons = { noCode: 0, noName: 0, duplicate: 0, percentOutOfRange: 0 };

for (let i = 2; i < allRows.length; i++) {
  const row = allRows[i];
  const code = sanitizePromoCode(String(row[9] || row[0] || ''));
  const name = String(row[1] || '').trim();
  if (!code) { skipped++; skipReasons.noCode++; continue; }
  if (!name) { skipped++; skipReasons.noName++; continue; }
  if (seenCodes.has(code)) { skipped++; skipReasons.duplicate++; continue; }
  seenCodes.add(code);

  const rawPhone = String(row[3] || '');
  const phone = normalizePhone(rawPhone);
  if (!rawPhone) phoneNormStats.empty++;
  else if (rawPhone.replace(/\s/g, '').startsWith('+')) phoneNormStats.withPlus++;
  else if (rawPhone.replace(/\s/g, '').startsWith('260')) phoneNormStats.with260++;
  else if (rawPhone.replace(/\s/g, '').startsWith('0')) phoneNormStats.with0++;
  else if (/^\d+$/.test(rawPhone.replace(/\s/g, ''))) phoneNormStats.bareDigits++;
  else phoneNormStats.other++;

  const nrc = String(row[4] || '').trim();
  const location = String(row[5] || '').trim();
  const recruiter = String(row[6] || '').trim();
  const rawPercent = String(row[8] || '').trim();
  const percent = /^\d+(\.\d+)?$/.test(rawPercent) ? parseFloat(rawPercent) : 20;
  const link = String(row[10] || '').trim();
  const source = String(row[2] || '').trim();

  const plan = percent === 0 ? 'nil' : 'loss_based';
  const commissionRate = plan === 'loss_based' ? percent : 0;
  const perClientAmount = plan === 'per_client' ? 100 : 0;
  planStats[plan] = (planStats[plan] || 0) + 1;

  const insertPayload = {
    promo_code: code,
    name,
    phone: phone || null,
    nrc: nrc || null,
    location: location || null,
    recruiter_name: recruiter || null,
    source: source || null,
    commission_plan: plan,
    commission_rate: commissionRate,
    per_client_amount: perClientAmount,
    signup_link: link || ('https://bwanabet.com/en/auth/signup/' + code),
    status: 'active',
    is_active: true,
    self_registered: false,
  };

  if (samples.length < 5) samples.push({ row: i, payload: insertPayload, rawPhone });
  created++;
}

console.log('===== Dry-run results =====');
console.log(`Would CREATE: ${created} agents`);
console.log(`Would SKIP:   ${skipped} rows`);
console.log(`  - no code:  ${skipReasons.noCode}`);
console.log(`  - no name:  ${skipReasons.noName}`);
console.log(`  - duplicate code in CSV: ${skipReasons.duplicate}`);
console.log('');
console.log('Plan distribution:');
for (const [k, v] of Object.entries(planStats)) console.log(`  ${k}: ${v}`);
console.log('');
console.log('Phone source format (raw values):');
for (const [k, v] of Object.entries(phoneNormStats)) console.log(`  ${k}: ${v}`);
console.log('');
console.log('First 5 insert payloads (sample):');
for (const s of samples) {
  console.log(`\n  Row ${s.row} — raw phone: "${s.rawPhone}"`);
  console.log('  ' + JSON.stringify(s.payload, null, 2).split('\n').join('\n  '));
}

if (errors.length) {
  console.log(`\n${errors.length} parse/validation errors (showing first 10):`);
  errors.slice(0, 10).forEach(e => console.log('  - ' + e));
}

// === Diagnostics: show edge cases ===
console.log('\n===== Diagnostics =====');

// Re-pass to find duplicates and weird phones
const codeFirstRow = new Map();
const duplicates = [];
const weirdPhones = [];
const a80Like = [];
for (let i = 2; i < allRows.length; i++) {
  const row = allRows[i];
  const code = sanitizePromoCode(String(row[9] || row[0] || ''));
  const name = String(row[1] || '').trim();
  if (!code || !name) continue;
  if (codeFirstRow.has(code)) duplicates.push({ row: i, code, name, firstSeen: codeFirstRow.get(code) });
  else codeFirstRow.set(code, i);

  const rawPhone = String(row[3] || '');
  if (rawPhone && !/^[\d\s\+\-\(\)]+$/.test(rawPhone)) {
    weirdPhones.push({ row: i, code, name, rawPhone: JSON.stringify(rawPhone) });
  }
  if (rawPhone.includes('\n') || rawPhone.includes('\r')) {
    a80Like.push({ row: i, code, name, rawPhone: JSON.stringify(rawPhone), normalized: normalizePhone(rawPhone) });
  }
}

if (duplicates.length) {
  console.log(`\nDuplicate codes within the CSV (${duplicates.length}):`);
  duplicates.forEach(d => console.log(`  Row ${d.row}: code "${d.code}" (${d.name}) — first seen at row ${d.firstSeen}`));
}

if (weirdPhones.length) {
  console.log(`\nUnusual phone characters (${weirdPhones.length}):`);
  weirdPhones.slice(0, 10).forEach(w => console.log(`  Row ${w.row}: ${w.code} ${w.name} — raw=${w.rawPhone}`));
}

if (a80Like.length) {
  console.log(`\nMulti-line phone fields (${a80Like.length}):`);
  a80Like.forEach(p => console.log(`  Row ${p.row}: ${p.code} ${p.name} — raw=${p.rawPhone} → normalized=${p.normalized}`));
}

console.log(`\nDone. Real import would also assign password_hash="123456" (default) to every agent.`);
