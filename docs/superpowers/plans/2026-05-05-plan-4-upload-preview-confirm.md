# Plan 4: Upload Preview-and-Confirm Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert a preview-and-confirm step between file selection and database writes in the manager's Player Activity upload flow, surfacing match counts, per-plan summaries, and re-upload conflicts before any UPSERT happens.

**Architecture:** Extract the parse/analyse logic from the existing monolithic `processPlayerActivityUpload()` into a UMD-lite module (`assets/js/preview.js`) that can be unit-tested under `node --test`. The existing handler becomes a two-stage flow: stage 1 parses + analyses + shows a preview modal; stage 2 (gated by Confirm button + required checkboxes for warning states) runs the existing UPSERT logic against pre-computed data. After successful confirm, the user lands on the Overview tab via the existing `switchSubTab()` function.

**Tech Stack:** Vanilla JS (single-file `index.html` + new `assets/js/preview.js`). Tailwind CDN for modal styling. Node 18+ built-in `node:test` runner for unit tests (zero npm deps). Supabase JS client for UPSERTs (unchanged).

**Spec reference:** `docs/superpowers/specs/2026-05-04-affiliate-manager-redesign-design.md` Section 4.

**Repo:** `bwanabet-crm-overview` only. The agent portal repo is unaffected by this plan.

---

## File Structure

### New files
- `bwanabet-crm-overview/assets/js/preview.js` — pure-logic module with three exported functions (`summarizePerPlan`, `analyzeUpload`, `detectReuploadConflicts`). UMD-lite: works as `window.PreviewLogic` in browser and `module.exports` in Node tests.
- `bwanabet-crm-overview/tests/preview.test.js` — Node `node:test` unit tests for the three pure functions. Zero npm deps.
- `bwanabet-crm-overview/package.json` — minimal manifest, declares the `test` script. No dependencies.

### Modified files
- `bwanabet-crm-overview/index.html`
  - Add `<script src="assets/js/preview.js"></script>` after Supabase CDN script tag.
  - Add the Preview Modal HTML block in the modals section.
  - Refactor `AgentManager.processPlayerActivityUpload()` — split into `previewPlayerActivityUpload()` (new, opens modal) and `confirmPlayerActivityUpload()` (renamed-and-trimmed legacy DB-write path).
  - Adjust the Import button's `onclick` to call `previewPlayerActivityUpload`.

### Files NOT changed
- `bwanabet-crm-overview/api/*` — all server endpoints unchanged.
- Any database migrations — Plan 1 has the schema; Plan 4 reads `agent_payments.week_start_date` for conflict detection but doesn't alter it.

---

## Task 1: Set up the Node test harness

**Files:**
- Create: `bwanabet-crm-overview/package.json`
- Create: `bwanabet-crm-overview/tests/.gitkeep` (only if `tests/` is genuinely empty; today it exists so skip if already present)
- Create: `bwanabet-crm-overview/tests/smoke.test.js`

**Goal:** Stand up `node --test` so subsequent tasks can TDD pure functions.

- [ ] **Step 1: Verify Node version**

```bash
node --version
```

Expected: `v18.x.x` or higher. If lower, **STOP** and report BLOCKED — `node:test` requires 18+.

- [ ] **Step 2: Create `package.json`**

Write `bwanabet-crm-overview/package.json` with this exact content:

```json
{
  "name": "bwanabet-crm",
  "private": true,
  "version": "0.0.0",
  "description": "BwanaBet manager CRM — vanilla JS single-file app",
  "scripts": {
    "test": "node --test tests/"
  }
}
```

- [ ] **Step 3: Write a smoke test**

Create `bwanabet-crm-overview/tests/smoke.test.js`:

```javascript
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('node:test runner is functional', () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 4: Run the test**

```bash
cd "C:/Users/USER/Desktop/Claude projects/bwanabet-crm-overview"
npm test
```

Expected output ends with `# pass 1` (or similar). Exit code 0.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/USER/Desktop/Claude projects/bwanabet-crm-overview"
git add package.json tests/smoke.test.js
git commit -m "$(cat <<'EOF'
Add node:test harness for upload preview unit tests

Zero-dependency setup using Node 18+ built-in runner. Smoke test
confirms the runner works. Subsequent commits in Plan 4 will add
real tests against the new preview module.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Create the preview module skeleton

**Files:**
- Create: `bwanabet-crm-overview/assets/js/preview.js`

**Goal:** Establish the UMD-lite module with empty function stubs so subsequent TDD tasks have a target to import.

- [ ] **Step 1: Create the assets directory**

```bash
cd "C:/Users/USER/Desktop/Claude projects/bwanabet-crm-overview"
mkdir -p assets/js
```

- [ ] **Step 2: Write the skeleton**

Create `bwanabet-crm-overview/assets/js/preview.js`:

```javascript
// preview.js — pure logic for the player-activity upload preview-and-confirm flow.
// No DOM, no Supabase, no globals. Functions take inputs, return data.
// Loaded into the browser as window.PreviewLogic and into Node tests as module.exports.

const PreviewLogic = (() => {
  // Aggregates parsed rows into per-plan totals.
  // weeklyByAgent: array of { agent_id, plan, total_clients, qualifying_clients, total_losses, total_earnings }
  // Returns: { A: {...}, B: {...}, C: {...} } where each value is { agentsCount, qualifyingAgentsCount, totalClients, totalQualifyingClients, totalLosses, totalEarnings }
  function summarizePerPlan(weeklyByAgent) {
    throw new Error('not implemented');
  }

  // Reads parsed CSV/XLSX rows + agent list + week start, computes:
  //   matched: array of player rows whose agent_code maps to a known agent
  //   skipped: array of { row, reason } for unmatched / invalid rows
  //   weeklyByAgent: per-agent aggregated weekly summary (input to summarizePerPlan)
  //   perPlan: result of summarizePerPlan(weeklyByAgent)
  // Pure: no DB calls.
  function analyzeUpload(rows, agents, weekStartISO) {
    throw new Error('not implemented');
  }

  // Compares newly-computed per-agent earnings against existing paid agent_payments rows
  // for the same week. Returns array of conflicts:
  //   { agent_id, agent_name, paid: number, newEarnings: number, status: 'match'|'underpaid'|'overpaid' }
  // Only rows where there's a paid payment AND a new earnings calc are returned (no-op cases skipped).
  function detectReuploadConflicts(weeklyByAgent, paidPayments, weekStartISO, agents) {
    throw new Error('not implemented');
  }

  return { summarizePerPlan, analyzeUpload, detectReuploadConflicts };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PreviewLogic;
}
if (typeof window !== 'undefined') {
  window.PreviewLogic = PreviewLogic;
}
```

- [ ] **Step 3: Verify file written**

```bash
cd "C:/Users/USER/Desktop/Claude projects/bwanabet-crm-overview"
wc -l assets/js/preview.js
```

Expected: 30+ lines.

- [ ] **Step 4: Verify Node can require it without errors**

```bash
cd "C:/Users/USER/Desktop/Claude projects/bwanabet-crm-overview"
node -e "const P = require('./assets/js/preview.js'); console.log(Object.keys(P));"
```

Expected output: `[ 'summarizePerPlan', 'analyzeUpload', 'detectReuploadConflicts' ]`

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/USER/Desktop/Claude projects/bwanabet-crm-overview"
git add assets/js/preview.js
git commit -m "$(cat <<'EOF'
Add preview-logic module skeleton with three function stubs

UMD-lite wrapper exposes summarizePerPlan, analyzeUpload, and
detectReuploadConflicts to both window (browser) and module.exports
(Node tests). All three throw 'not implemented' until subsequent TDD
tasks fill them in.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: TDD `summarizePerPlan`

**Files:**
- Modify: `bwanabet-crm-overview/tests/preview.test.js` (create on first edit)
- Modify: `bwanabet-crm-overview/assets/js/preview.js`

**Goal:** Implement the smallest helper first — given a per-agent weekly array, group by plan and total counts and amounts.

- [ ] **Step 1: Write the failing test**

Create `bwanabet-crm-overview/tests/preview.test.js`:

```javascript
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarizePerPlan } = require('../assets/js/preview.js');

test('summarizePerPlan: empty input yields zero totals for all plans', () => {
  const result = summarizePerPlan([]);
  assert.deepEqual(result.A, { agentsCount: 0, qualifyingAgentsCount: 0, totalClients: 0, totalQualifyingClients: 0, totalLosses: 0, totalEarnings: 0 });
  assert.deepEqual(result.B, { agentsCount: 0, qualifyingAgentsCount: 0, totalClients: 0, totalQualifyingClients: 0, totalLosses: 0, totalEarnings: 0 });
  assert.deepEqual(result.C, { agentsCount: 0, qualifyingAgentsCount: 0, totalClients: 0, totalQualifyingClients: 0, totalLosses: 0, totalEarnings: 0 });
});

test('summarizePerPlan: aggregates Plan A correctly', () => {
  const input = [
    { agent_id: 'a1', plan: 'per_client', total_clients: 5, qualifying_clients: 4, total_losses: 0, total_earnings: 400 },
    { agent_id: 'a2', plan: 'per_client', total_clients: 3, qualifying_clients: 0, total_losses: 0, total_earnings: 0 },
    { agent_id: 'a3', plan: 'per_client', total_clients: 2, qualifying_clients: 2, total_losses: 0, total_earnings: 200 },
  ];
  const result = summarizePerPlan(input);
  assert.equal(result.A.agentsCount, 3);
  assert.equal(result.A.qualifyingAgentsCount, 2); // a1 and a3 had qualifying > 0
  assert.equal(result.A.totalClients, 10);
  assert.equal(result.A.totalQualifyingClients, 6);
  assert.equal(result.A.totalEarnings, 600);
});

test('summarizePerPlan: distinguishes plans per_client vs loss_based vs nil', () => {
  const input = [
    { agent_id: 'a1', plan: 'per_client', total_clients: 1, qualifying_clients: 1, total_losses: 0, total_earnings: 100 },
    { agent_id: 'a2', plan: 'loss_based', total_clients: 1, qualifying_clients: 1, total_losses: 500, total_earnings: 100 },
    { agent_id: 'a3', plan: 'nil', total_clients: 1, qualifying_clients: 1, total_losses: 200, total_earnings: 0 },
  ];
  const result = summarizePerPlan(input);
  assert.equal(result.A.agentsCount, 1);
  assert.equal(result.B.agentsCount, 1);
  assert.equal(result.B.totalLosses, 500);
  assert.equal(result.C.agentsCount, 1);
  assert.equal(result.C.totalEarnings, 0);
});
```

- [ ] **Step 2: Run the test — expect failure**

```bash
cd "C:/Users/USER/Desktop/Claude projects/bwanabet-crm-overview"
npm test
```

Expected: 3 failing tests for `summarizePerPlan` (the smoke test still passes). Exit code 1.

- [ ] **Step 3: Implement `summarizePerPlan`**

In `assets/js/preview.js`, replace the body of `summarizePerPlan` with:

```javascript
  function summarizePerPlan(weeklyByAgent) {
    const PLAN_KEY = { per_client: 'A', loss_based: 'B', nil: 'C' };
    const empty = () => ({
      agentsCount: 0,
      qualifyingAgentsCount: 0,
      totalClients: 0,
      totalQualifyingClients: 0,
      totalLosses: 0,
      totalEarnings: 0,
    });
    const result = { A: empty(), B: empty(), C: empty() };

    for (const row of weeklyByAgent) {
      const key = PLAN_KEY[row.plan];
      if (!key) continue;
      const bucket = result[key];
      bucket.agentsCount += 1;
      if ((row.qualifying_clients || 0) > 0) bucket.qualifyingAgentsCount += 1;
      bucket.totalClients += row.total_clients || 0;
      bucket.totalQualifyingClients += row.qualifying_clients || 0;
      bucket.totalLosses += Number(row.total_losses) || 0;
      bucket.totalEarnings += Number(row.total_earnings) || 0;
    }
    return result;
  }
```

- [ ] **Step 4: Run the tests — expect all green**

```bash
cd "C:/Users/USER/Desktop/Claude projects/bwanabet-crm-overview"
npm test
```

Expected: smoke test + 3 `summarizePerPlan` tests all passing (`# pass 4`). Exit code 0.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/USER/Desktop/Claude projects/bwanabet-crm-overview"
git add assets/js/preview.js tests/preview.test.js
git commit -m "$(cat <<'EOF'
Implement summarizePerPlan helper for upload preview

Buckets per-agent weekly rows into Plan A/B/C summaries with counts,
qualifying agent counts, total clients, total qualifying clients,
total losses, total earnings. Three TDD tests cover empty input,
single-plan aggregation, and multi-plan distinction.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: TDD `analyzeUpload`

**Files:**
- Modify: `bwanabet-crm-overview/tests/preview.test.js`
- Modify: `bwanabet-crm-overview/assets/js/preview.js`

**Goal:** Implement the main parsing function — given parsed CSV rows + agents list + week start, return matched/skipped rows and per-agent weekly aggregates.

The qualifying rule for Plan A (`per_client`): a row qualifies if `first_deposit ≥ 100 AND (sports_bet ≥ 100 OR casino_bet ≥ 100)`. Plan B (`loss_based`) all rows count toward losses; commission = `total_losses × 0.20`. Plan C (`nil`) tracks but pays nothing.

- [ ] **Step 1: Add tests for `analyzeUpload`**

Append to `tests/preview.test.js`:

```javascript
const { analyzeUpload } = require('../assets/js/preview.js');

const sampleAgents = [
  { id: 'agent-a', promo_code: 'A100', name: 'Alice', commission_plan: 'per_client' },
  { id: 'agent-b', promo_code: 'A200', name: 'Bob',   commission_plan: 'loss_based' },
  { id: 'agent-c', promo_code: 'A300', name: 'Carol', commission_plan: 'nil' },
];

test('analyzeUpload: matched and skipped row counts', () => {
  const rows = [
    { agent_code: 'A100', user_id: 'u1', first_deposit: 200, sports_bet: 200, casino_bet: 0, total_losses: 50 },
    { agent_code: 'A100', user_id: 'u2', first_deposit: 50,  sports_bet: 50,  casino_bet: 0, total_losses: 10 }, // not qualifying
    { agent_code: 'XXX',  user_id: 'u3', first_deposit: 200, sports_bet: 200, casino_bet: 0, total_losses: 50 }, // unmatched code
    { agent_code: '',     user_id: 'u4', first_deposit: 200, sports_bet: 200, casino_bet: 0, total_losses: 50 }, // missing code
  ];
  const result = analyzeUpload(rows, sampleAgents, '2026-04-27');
  assert.equal(result.matched.length, 2);
  assert.equal(result.skipped.length, 2);
  assert.equal(result.skipped[0].reason, 'unknown_agent_code');
  assert.equal(result.skipped[1].reason, 'missing_agent_code');
});

test('analyzeUpload: Plan A qualifying logic — deposit + (sports OR casino) ≥ 100', () => {
  const rows = [
    { agent_code: 'A100', user_id: 'u1', first_deposit: 100, sports_bet: 100, casino_bet: 0, total_losses: 0 },   // qualifies
    { agent_code: 'A100', user_id: 'u2', first_deposit: 100, sports_bet: 0,   casino_bet: 100, total_losses: 0 }, // qualifies (casino)
    { agent_code: 'A100', user_id: 'u3', first_deposit: 100, sports_bet: 50,  casino_bet: 50, total_losses: 0 },  // does NOT qualify (neither hits 100)
    { agent_code: 'A100', user_id: 'u4', first_deposit: 99,  sports_bet: 200, casino_bet: 0, total_losses: 0 },   // does NOT qualify (deposit < 100)
  ];
  const result = analyzeUpload(rows, sampleAgents, '2026-04-27');
  const aliceWeekly = result.weeklyByAgent.find(r => r.agent_id === 'agent-a');
  assert.equal(aliceWeekly.total_clients, 4);
  assert.equal(aliceWeekly.qualifying_clients, 2);
  assert.equal(aliceWeekly.total_earnings, 200); // 2 × K100
});

test('analyzeUpload: Plan B earns 20% of losses regardless of qualifying', () => {
  const rows = [
    { agent_code: 'A200', user_id: 'u1', first_deposit: 50,  sports_bet: 50,  casino_bet: 0, total_losses: 1000 },
    { agent_code: 'A200', user_id: 'u2', first_deposit: 200, sports_bet: 200, casino_bet: 0, total_losses: 500 },
  ];
  const result = analyzeUpload(rows, sampleAgents, '2026-04-27');
  const bobWeekly = result.weeklyByAgent.find(r => r.agent_id === 'agent-b');
  assert.equal(bobWeekly.total_clients, 2);
  assert.equal(bobWeekly.total_losses, 1500);
  assert.equal(bobWeekly.total_earnings, 300); // 1500 × 0.20
});

test('analyzeUpload: Plan C tracks clients, pays zero', () => {
  const rows = [
    { agent_code: 'A300', user_id: 'u1', first_deposit: 200, sports_bet: 200, casino_bet: 0, total_losses: 100 },
  ];
  const result = analyzeUpload(rows, sampleAgents, '2026-04-27');
  const carolWeekly = result.weeklyByAgent.find(r => r.agent_id === 'agent-c');
  assert.equal(carolWeekly.total_clients, 1);
  assert.equal(carolWeekly.total_earnings, 0);
});

test('analyzeUpload: perPlan summary is included', () => {
  const rows = [
    { agent_code: 'A100', user_id: 'u1', first_deposit: 200, sports_bet: 200, casino_bet: 0, total_losses: 0 },
  ];
  const result = analyzeUpload(rows, sampleAgents, '2026-04-27');
  assert.ok(result.perPlan);
  assert.equal(result.perPlan.A.qualifyingAgentsCount, 1);
  assert.equal(result.perPlan.A.totalEarnings, 100);
});
```

- [ ] **Step 2: Run tests — expect 5 new failures**

```bash
cd "C:/Users/USER/Desktop/Claude projects/bwanabet-crm-overview"
npm test
```

Expected: 5 failing tests for `analyzeUpload`; previous tests still pass.

- [ ] **Step 3: Implement `analyzeUpload`**

In `assets/js/preview.js`, replace the body of `analyzeUpload` with:

```javascript
  function analyzeUpload(rows, agents, weekStartISO) {
    const PLAN_A_RATE = 100; // K per qualifying client
    const PLAN_B_RATE = 0.20;
    const codeIndex = new Map();
    for (const a of agents) {
      if (a.promo_code) codeIndex.set(a.promo_code.toUpperCase().trim(), a);
    }

    const matched = [];
    const skipped = [];
    const perAgent = new Map(); // agent_id -> aggregate

    for (const row of rows) {
      const code = (row.agent_code || '').toUpperCase().trim();
      if (!code) {
        skipped.push({ row, reason: 'missing_agent_code' });
        continue;
      }
      const agent = codeIndex.get(code);
      if (!agent) {
        skipped.push({ row, reason: 'unknown_agent_code' });
        continue;
      }
      matched.push({ row, agent });

      const deposit = Number(row.first_deposit) || 0;
      const sports = Number(row.sports_bet) || 0;
      const casino = Number(row.casino_bet) || 0;
      const losses = Number(row.total_losses) || 0;
      const qualifies = deposit >= 100 && (sports >= 100 || casino >= 100);

      let bucket = perAgent.get(agent.id);
      if (!bucket) {
        bucket = {
          agent_id: agent.id,
          plan: agent.commission_plan,
          total_clients: 0,
          qualifying_clients: 0,
          total_losses: 0,
          total_earnings: 0,
        };
        perAgent.set(agent.id, bucket);
      }
      bucket.total_clients += 1;
      if (qualifies) bucket.qualifying_clients += 1;
      bucket.total_losses += losses;
    }

    // Compute earnings per plan
    for (const bucket of perAgent.values()) {
      if (bucket.plan === 'per_client') {
        bucket.total_earnings = bucket.qualifying_clients * PLAN_A_RATE;
      } else if (bucket.plan === 'loss_based') {
        bucket.total_earnings = Math.round(bucket.total_losses * PLAN_B_RATE * 100) / 100;
      } else {
        bucket.total_earnings = 0;
      }
    }

    const weeklyByAgent = Array.from(perAgent.values());
    const perPlan = summarizePerPlan(weeklyByAgent);
    return { matched, skipped, weeklyByAgent, perPlan, weekStartISO };
  }
```

- [ ] **Step 4: Run tests — expect all green**

```bash
cd "C:/Users/USER/Desktop/Claude projects/bwanabet-crm-overview"
npm test
```

Expected: all 9 tests pass (`# pass 9`). Exit code 0.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/USER/Desktop/Claude projects/bwanabet-crm-overview"
git add assets/js/preview.js tests/preview.test.js
git commit -m "$(cat <<'EOF'
Implement analyzeUpload — pure CSV-row analysis for preview

Maps player rows to agents by promo code, computes Plan A qualifying
status (deposit ≥100 AND sports/casino ≥100), Plan B 20% loss-based,
Plan C zero. Returns matched/skipped rows, per-agent weekly aggregates,
and per-plan summary. Five TDD tests cover the rule edges.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: TDD `detectReuploadConflicts`

**Files:**
- Modify: `bwanabet-crm-overview/tests/preview.test.js`
- Modify: `bwanabet-crm-overview/assets/js/preview.js`

**Goal:** Detect agents who were already paid for the upload's target week, and classify each as match / underpaid / overpaid.

- [ ] **Step 1: Add tests**

Append to `tests/preview.test.js`:

```javascript
const { detectReuploadConflicts } = require('../assets/js/preview.js');

test('detectReuploadConflicts: no paid payments returns empty list', () => {
  const weeklyByAgent = [{ agent_id: 'agent-a', total_earnings: 400 }];
  const result = detectReuploadConflicts(weeklyByAgent, [], '2026-04-27', sampleAgents);
  assert.deepEqual(result, []);
});

test('detectReuploadConflicts: payment exists for different week is ignored', () => {
  const weeklyByAgent = [{ agent_id: 'agent-a', total_earnings: 400 }];
  const paid = [{ agent_id: 'agent-a', week_start_date: '2026-04-20', amount: 400, status: 'paid' }];
  const result = detectReuploadConflicts(weeklyByAgent, paid, '2026-04-27', sampleAgents);
  assert.deepEqual(result, []);
});

test('detectReuploadConflicts: pending status payment is ignored', () => {
  const weeklyByAgent = [{ agent_id: 'agent-a', total_earnings: 400 }];
  const paid = [{ agent_id: 'agent-a', week_start_date: '2026-04-27', amount: 400, status: 'pending' }];
  const result = detectReuploadConflicts(weeklyByAgent, paid, '2026-04-27', sampleAgents);
  assert.deepEqual(result, []);
});

test('detectReuploadConflicts: classifies match / underpaid / overpaid', () => {
  const weeklyByAgent = [
    { agent_id: 'agent-a', total_earnings: 400 }, // match: paid 400
    { agent_id: 'agent-b', total_earnings: 600 }, // underpaid: paid 400, new 600 → +200 owed
    { agent_id: 'agent-c', total_earnings: 200 }, // overpaid: paid 400, new 200 → 200 over
  ];
  const paid = [
    { agent_id: 'agent-a', week_start_date: '2026-04-27', amount: 400, status: 'paid' },
    { agent_id: 'agent-b', week_start_date: '2026-04-27', amount: 400, status: 'paid' },
    { agent_id: 'agent-c', week_start_date: '2026-04-27', amount: 400, status: 'paid' },
  ];
  const agents = [
    { id: 'agent-a', name: 'Alice', promo_code: 'A100', commission_plan: 'per_client' },
    { id: 'agent-b', name: 'Bob',   promo_code: 'A200', commission_plan: 'per_client' },
    { id: 'agent-c', name: 'Carol', promo_code: 'A300', commission_plan: 'per_client' },
  ];
  const result = detectReuploadConflicts(weeklyByAgent, paid, '2026-04-27', agents);
  const byId = Object.fromEntries(result.map(c => [c.agent_id, c]));
  assert.equal(byId['agent-a'].status, 'match');
  assert.equal(byId['agent-b'].status, 'underpaid');
  assert.equal(byId['agent-c'].status, 'overpaid');
  assert.equal(byId['agent-c'].paid, 400);
  assert.equal(byId['agent-c'].newEarnings, 200);
  assert.equal(byId['agent-c'].agent_name, 'Carol');
});

test('detectReuploadConflicts: multiple paid rows for same week are summed', () => {
  const weeklyByAgent = [{ agent_id: 'agent-a', total_earnings: 400 }];
  const paid = [
    { agent_id: 'agent-a', week_start_date: '2026-04-27', amount: 200, status: 'paid' },
    { agent_id: 'agent-a', week_start_date: '2026-04-27', amount: 200, status: 'paid' },
  ];
  const result = detectReuploadConflicts(weeklyByAgent, paid, '2026-04-27', sampleAgents);
  assert.equal(result.length, 1);
  assert.equal(result[0].paid, 400);
  assert.equal(result[0].status, 'match');
});
```

- [ ] **Step 2: Run tests — expect 5 new failures**

```bash
cd "C:/Users/USER/Desktop/Claude projects/bwanabet-crm-overview"
npm test
```

Expected: 5 failing tests for `detectReuploadConflicts`.

- [ ] **Step 3: Implement `detectReuploadConflicts`**

Replace the body of `detectReuploadConflicts` in `assets/js/preview.js`:

```javascript
  function detectReuploadConflicts(weeklyByAgent, paidPayments, weekStartISO, agents) {
    const agentsById = new Map(agents.map(a => [a.id, a]));
    const paidByAgent = new Map();
    for (const p of paidPayments) {
      if (p.status !== 'paid') continue;
      if (p.week_start_date !== weekStartISO) continue;
      const prev = paidByAgent.get(p.agent_id) || 0;
      paidByAgent.set(p.agent_id, prev + (Number(p.amount) || 0));
    }

    const conflicts = [];
    for (const wd of weeklyByAgent) {
      const paid = paidByAgent.get(wd.agent_id);
      if (paid === undefined) continue; // no paid payment for this agent/week — not a conflict
      const newEarnings = Number(wd.total_earnings) || 0;
      let status;
      if (Math.abs(paid - newEarnings) < 0.005) status = 'match';
      else if (newEarnings > paid) status = 'underpaid';
      else status = 'overpaid';
      const agent = agentsById.get(wd.agent_id);
      conflicts.push({
        agent_id: wd.agent_id,
        agent_name: agent ? agent.name : '(unknown)',
        paid,
        newEarnings,
        status,
      });
    }
    return conflicts;
  }
```

- [ ] **Step 4: Run tests — expect all green**

```bash
cd "C:/Users/USER/Desktop/Claude projects/bwanabet-crm-overview"
npm test
```

Expected: all 14 tests pass.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/USER/Desktop/Claude projects/bwanabet-crm-overview"
git add assets/js/preview.js tests/preview.test.js
git commit -m "$(cat <<'EOF'
Implement detectReuploadConflicts for re-upload safety check

Compares newly-computed per-agent earnings against existing paid
agent_payments rows for the same week_start_date. Classifies each
overlap as match (within K0.005), underpaid (new > paid), or
overpaid (new < paid). Sums multiple paid rows per (agent, week).
Five TDD tests cover empty input, week mismatch, status filter,
classification logic, and multi-row aggregation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Add the preview modal HTML

**Files:**
- Modify: `bwanabet-crm-overview/index.html` (add modal markup near other modals; add `<script src="assets/js/preview.js">` after Supabase CDN)

**Goal:** Place the modal DOM in the document so subsequent JS can show/hide and populate it. No JS wiring yet.

- [ ] **Step 1: Find the Supabase CDN script tag**

Open `bwanabet-crm-overview/index.html` in a viewer. Search for `supabase-js`. Note the line number.

- [ ] **Step 2: Add the preview script include**

Immediately AFTER the Supabase CDN `<script>` tag and BEFORE the next `<script>` tag, add:

```html
<script src="assets/js/preview.js"></script>
```

- [ ] **Step 3: Find the existing modal block**

Search for `id="modal-id"` is hypothetical — instead search for `class="hidden fixed inset-0 bg-black bg-opacity-60 z-50`. Find the LAST such modal (so the new one goes near other modals). Note the line where its closing `</div></div>` ends.

- [ ] **Step 4: Add the preview modal block**

After the closing `</div></div>` of the last existing modal, add this exact HTML block:

```html
<!-- Player Activity Upload — Preview Modal -->
<div id="playerActivityPreviewModal" class="hidden fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4">
  <div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]">
    <div class="bg-slate-800 text-white px-5 py-4 rounded-t-2xl flex items-center justify-between">
      <h3 class="font-semibold flex items-center gap-2">
        <i data-lucide="file-spreadsheet" class="h-5 w-5"></i>
        Upload Preview
      </h3>
      <button onclick="document.getElementById('playerActivityPreviewModal').classList.add('hidden')" class="text-slate-400 hover:text-white">
        <i data-lucide="x" class="h-5 w-5"></i>
      </button>
    </div>

    <div class="flex-1 overflow-y-auto p-5 space-y-5">
      <!-- File / week meta -->
      <div id="previewMeta" class="text-sm text-slate-700 grid grid-cols-1 sm:grid-cols-3 gap-2">
        <!-- populated by JS: file name, week start, parsed row count -->
      </div>

      <!-- Match summary -->
      <div id="previewMatchSummary" class="rounded-xl border bg-slate-50 px-4 py-3 text-sm">
        <!-- populated by JS: matched / skipped counts, expandable skipped codes -->
      </div>

      <!-- Per-plan summary -->
      <div id="previewPerPlan" class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <!-- populated by JS: three plan cards -->
      </div>

      <!-- Re-upload conflicts (hidden if none) -->
      <div id="previewConflicts" class="hidden rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
        <h4 class="font-semibold text-amber-800 mb-2 flex items-center gap-2">
          <i data-lucide="alert-triangle" class="h-4 w-4"></i>
          Re-upload check
        </h4>
        <div id="previewConflictsList"></div>
      </div>

      <!-- Future-dated warning -->
      <div id="previewFutureDateWarning" class="hidden rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-center gap-2">
        <i data-lucide="calendar-x" class="h-4 w-4"></i>
        <span>Week start is in the future — typo?</span>
      </div>

      <!-- Gating checkboxes (rendered conditionally by JS) -->
      <div id="previewGates" class="space-y-2"></div>
    </div>

    <div class="border-t px-5 py-3 flex items-center justify-between gap-3 bg-slate-50 rounded-b-2xl">
      <button onclick="document.getElementById('playerActivityPreviewModal').classList.add('hidden')" class="px-4 py-2 text-slate-700 hover:bg-slate-200 rounded-lg text-sm">Cancel</button>
      <button id="confirmPlayerActivityBtn" onclick="AgentManager.confirmPlayerActivityUpload()" class="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
        <i data-lucide="check" class="h-4 w-4"></i>
        Confirm &amp; Import
      </button>
    </div>
  </div>
</div>
```

- [ ] **Step 5: Verify locally — open the page**

Open `bwanabet-crm-overview/index.html` in a browser. Open DevTools console. Run:

```javascript
window.PreviewLogic
```

Expected: an object with three function properties.

```javascript
document.getElementById('playerActivityPreviewModal')
```

Expected: an `<div>` element (the modal, currently hidden).

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/USER/Desktop/Claude projects/bwanabet-crm-overview"
git add index.html
git commit -m "$(cat <<'EOF'
Add preview modal markup and load preview-logic module

Inserts the Player Activity preview modal at the end of the modals
section with placeholder containers for meta, match summary, per-plan
cards, conflict list, future-date warning, and gating checkboxes.
Loads assets/js/preview.js so window.PreviewLogic is available.
No JS wiring yet — modal is unreachable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Wire up `previewPlayerActivityUpload()`

**Files:**
- Modify: `bwanabet-crm-overview/index.html` — refactor `AgentManager.processPlayerActivityUpload` and add `previewPlayerActivityUpload`.

**Goal:** Replace direct UPSERTs with: parse rows → compute preview → render modal → wait for Confirm.

- [ ] **Step 1: Locate the existing handler**

In `index.html`, find `AgentManager.processPlayerActivityUpload` (around line 6394). Read the full function — note that it does: validate dates, group rows, calculate commission, UPSERT player_activity, UPSERT weekly_data, send Telegram, show alert, reset form.

- [ ] **Step 2: Locate the existing Import button**

Find the button with `onclick="AgentManager.processPlayerActivityUpload()"` (around line 2992). Note the surrounding markup so you can edit just the onclick attribute.

- [ ] **Step 3: Rename existing function to `confirmPlayerActivityUpload`**

In place, rename `AgentManager.processPlayerActivityUpload` to `AgentManager.confirmPlayerActivityUpload`. The body stays the same for now — this function will read pre-computed data from `this.previewState` instead of recomputing.

- [ ] **Step 4: Add a new `previewPlayerActivityUpload` function**

Insert just BEFORE the renamed `confirmPlayerActivityUpload` definition:

```javascript
    async previewPlayerActivityUpload() {
      const fileData = this.playerActivityFileData;
      if (!fileData || !fileData.length) {
        showNotification('No file loaded — pick a file first', 'error');
        return;
      }
      const weekStart = document.getElementById('uploadWeekStart').value;
      const weekEnd = document.getElementById('uploadWeekEnd').value;
      if (!weekStart || !weekEnd) {
        showNotification('Pick week start and end dates', 'error');
        return;
      }

      // Map XLSX rows to the analyzer's expected shape.
      // Header columns from sheet: User ID, Phone Number, Agent Code, First Deposit Amount,
      // Total Deposit Amount, Total Bet Sports, Total Bet Casino, Total Bet, Losses
      const rows = fileData.map(r => ({
        agent_code: r['Agent Code'] || r.agent_code,
        user_id: r['User ID'] || r.user_id,
        phone: r['Phone Number'] || r.phone,
        first_deposit: r['First Deposit Amount'] || r.first_deposit || 0,
        sports_bet: r['Total Bet Sports'] || r.sports_bet || 0,
        casino_bet: r['Total Bet Casino'] || r.casino_bet || 0,
        total_losses: r['Losses'] || r.total_losses || 0,
      }));

      const analysis = window.PreviewLogic.analyzeUpload(rows, this.agents, weekStart);

      // Fetch paid payments for this week only — not full table
      const { data: paidPayments, error: payErr } = await App.db
        .from('agent_payments')
        .select('agent_id, week_start_date, amount, status')
        .eq('week_start_date', weekStart)
        .eq('status', 'paid');
      if (payErr) {
        showNotification(`Failed to load existing payments: ${payErr.message}`, 'error');
        return;
      }
      const conflicts = window.PreviewLogic.detectReuploadConflicts(
        analysis.weeklyByAgent, paidPayments || [], weekStart, this.agents
      );

      this.previewState = {
        rows: fileData,
        analysis,
        conflicts,
        weekStart,
        weekEnd,
        fileName: document.getElementById('playerActivityFileName').textContent || '(unnamed)',
      };

      this._renderPreviewModal();
    },
```

- [ ] **Step 5: Update the Import button onclick**

Change the button at ~line 2992 from:

```html
<button id="processActivityBtn" onclick="AgentManager.processPlayerActivityUpload()"
```

to:

```html
<button id="processActivityBtn" onclick="AgentManager.previewPlayerActivityUpload()"
```

- [ ] **Step 6: Stage and commit (preview not yet rendering — done in Task 8)**

```bash
cd "C:/Users/USER/Desktop/Claude projects/bwanabet-crm-overview"
git add index.html
git commit -m "$(cat <<'EOF'
Split player-activity upload into preview + confirm phases

Renames processPlayerActivityUpload -> confirmPlayerActivityUpload
(unchanged body for now). New previewPlayerActivityUpload reads file
data, runs PreviewLogic.analyzeUpload, fetches paid agent_payments
for the target week, runs detectReuploadConflicts, and stores the
result in this.previewState for the modal renderer (next task).
Import button now calls preview.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Render the preview modal

**Files:**
- Modify: `bwanabet-crm-overview/index.html` — add `_renderPreviewModal()` method on `AgentManager`.

**Goal:** Populate every modal section from `this.previewState` and show the modal.

- [ ] **Step 1: Add the renderer**

Insert inside the `AgentManager` object, before `confirmPlayerActivityUpload`:

```javascript
    _renderPreviewModal() {
      const s = this.previewState;
      if (!s) return;
      const a = s.analysis;

      // Meta strip
      document.getElementById('previewMeta').innerHTML = `
        <div><span class="text-slate-500">File:</span> <span class="font-medium">${escapeHtml(s.fileName)}</span></div>
        <div><span class="text-slate-500">Week start:</span> <span class="font-medium">${escapeHtml(s.weekStart)}</span></div>
        <div><span class="text-slate-500">Rows parsed:</span> <span class="font-medium">${s.rows.length}</span></div>
      `;

      // Match summary
      const skippedByReason = {};
      for (const row of a.skipped) {
        skippedByReason[row.reason] = (skippedByReason[row.reason] || 0) + 1;
      }
      const skippedDetail = Object.entries(skippedByReason)
        .map(([reason, n]) => `${n} ${reason.replace(/_/g, ' ')}`)
        .join(', ') || 'none';
      document.getElementById('previewMatchSummary').innerHTML = `
        <div class="flex items-center gap-2 text-emerald-700">
          <i data-lucide="check" class="h-4 w-4"></i>
          <span><strong>${a.matched.length}</strong> player rows matched to known agents</span>
        </div>
        ${a.skipped.length > 0 ? `
          <div class="flex items-center gap-2 text-amber-700 mt-1">
            <i data-lucide="alert-circle" class="h-4 w-4"></i>
            <span><strong>${a.skipped.length}</strong> rows skipped — ${escapeHtml(skippedDetail)}</span>
          </div>
        ` : ''}
      `;

      // Per-plan cards
      const planCard = (label, data, payable) => `
        <div class="rounded-xl border bg-white px-4 py-3">
          <div class="text-xs font-semibold text-slate-500 uppercase tracking-wide">${label}</div>
          <div class="mt-2 text-sm text-slate-700 space-y-1">
            <div><strong>${data.qualifyingAgentsCount}</strong> of ${data.agentsCount} agents qualifying</div>
            <div><strong>${data.totalQualifyingClients}</strong> qualifying clients</div>
            <div class="font-semibold text-emerald-700">K${payable.toLocaleString()} payable</div>
          </div>
        </div>
      `;
      document.getElementById('previewPerPlan').innerHTML = `
        ${planCard('Plan A · Per-Client K100', a.perPlan.A, a.perPlan.A.totalEarnings)}
        ${planCard('Plan B · Loss-Based 20%', a.perPlan.B, a.perPlan.B.totalEarnings)}
        ${planCard('Plan C · Tracking Only', a.perPlan.C, 0)}
      `;

      // Conflicts
      const conflictsBox = document.getElementById('previewConflicts');
      const conflictsList = document.getElementById('previewConflictsList');
      if (s.conflicts.length === 0) {
        conflictsBox.classList.add('hidden');
        conflictsList.innerHTML = '';
      } else {
        conflictsBox.classList.remove('hidden');
        conflictsList.innerHTML = s.conflicts.map(c => {
          const tag = c.status === 'match' ? '✓ Still matches'
                    : c.status === 'underpaid' ? `+ K${(c.newEarnings - c.paid).toFixed(2)} extra owed`
                    : `⚠ Overpaid by K${(c.paid - c.newEarnings).toFixed(2)}`;
          const colour = c.status === 'overpaid' ? 'text-red-700' : c.status === 'underpaid' ? 'text-amber-800' : 'text-slate-600';
          return `<div class="${colour}">• ${escapeHtml(c.agent_name)} — paid K${c.paid.toFixed(2)}; new earnings K${c.newEarnings.toFixed(2)}. ${tag}</div>`;
        }).join('');
      }

      // Future-date warning
      const futureWarn = document.getElementById('previewFutureDateWarning');
      const today = new Date().toISOString().slice(0, 10);
      if (s.weekStart > today) futureWarn.classList.remove('hidden');
      else futureWarn.classList.add('hidden');

      // Gating checkboxes
      const overpaidCount = s.conflicts.filter(c => c.status === 'overpaid').length;
      const isFuture = s.weekStart > today;
      const gatesBox = document.getElementById('previewGates');
      const gates = [];
      if (overpaidCount > 0) {
        gates.push(`
          <label class="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" class="preview-gate mt-0.5" data-gate="overpaid" onchange="AgentManager._refreshConfirmButton()">
            <span>I understand <strong>${overpaidCount}</strong> agent${overpaidCount === 1 ? ' will be' : 's will be'} overpaid — proceed anyway</span>
          </label>
        `);
      }
      if (isFuture) {
        gates.push(`
          <label class="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" class="preview-gate mt-0.5" data-gate="future" onchange="AgentManager._refreshConfirmButton()">
            <span>The week start date is intentionally in the future</span>
          </label>
        `);
      }
      gatesBox.innerHTML = gates.join('');

      this._refreshConfirmButton();
      document.getElementById('playerActivityPreviewModal').classList.remove('hidden');
      if (typeof refreshIcons === 'function') refreshIcons();
    },

    _refreshConfirmButton() {
      const btn = document.getElementById('confirmPlayerActivityBtn');
      const gates = document.querySelectorAll('.preview-gate');
      const allChecked = Array.from(gates).every(g => g.checked);
      btn.disabled = !allChecked;
    },
```

- [ ] **Step 2: Verify `escapeHtml` exists**

Search the file for `function escapeHtml`. If it does not exist, add this near the top of the global script block:

```javascript
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
```

If it exists, do nothing.

- [ ] **Step 3: Manual smoke test (browser)**

Open `index.html` in a browser. Open DevTools console.

```javascript
AgentManager.previewState = {
  fileName: 'test.xlsx',
  weekStart: '2026-04-27',
  weekEnd: '2026-05-03',
  rows: [{}, {}, {}],
  analysis: {
    matched: [{},{}],
    skipped: [{reason:'unknown_agent_code'}],
    weeklyByAgent: [],
    perPlan: {
      A: { agentsCount: 10, qualifyingAgentsCount: 4, totalQualifyingClients: 8, totalEarnings: 800 },
      B: { agentsCount: 0, qualifyingAgentsCount: 0, totalQualifyingClients: 0, totalEarnings: 0 },
      C: { agentsCount: 1, qualifyingAgentsCount: 0, totalQualifyingClients: 0, totalEarnings: 0 },
    },
  },
  conflicts: [],
};
AgentManager._renderPreviewModal();
```

Expected: modal opens, shows file `test.xlsx`, week 2026-04-27, 3 rows parsed, 2 matched + 1 skipped, three plan cards. Confirm button is enabled (no gates).

Close the modal. Reload page.

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/USER/Desktop/Claude projects/bwanabet-crm-overview"
git add index.html
git commit -m "$(cat <<'EOF'
Render preview modal with meta, match counts, per-plan cards, gates

_renderPreviewModal populates every section of the modal from
previewState — file/week meta, matched/skipped row counts with
reason breakdown, three per-plan summary cards, optional conflicts
list with overpaid/underpaid classification, optional future-date
warning, and conditional gating checkboxes that disable the Confirm
button until checked. _refreshConfirmButton wires the disable logic.
escapeHtml helper added if not already present.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Wire up Confirm to call existing UPSERT logic

**Files:**
- Modify: `bwanabet-crm-overview/index.html` — adapt `confirmPlayerActivityUpload` to read from `previewState` instead of recomputing.

**Goal:** Confirm button uses already-analysed data; no duplicate computation. Lands on Overview after success.

- [ ] **Step 1: Edit `confirmPlayerActivityUpload`**

The function (renamed in Task 7) currently re-parses rows and re-calculates commissions. Replace its input handling so it reads from `this.previewState`. Specifically:
- Replace `const rows = ...` and the row-iteration commission-calc block with: `const { weeklyByAgent, matched } = this.previewState.analysis;`.
- Replace the per-row UPSERT loop into `agent_player_activity` to iterate over `matched` (which already has agent + row paired).
- Replace the per-agent UPSERT loop into `agent_weekly_data` to iterate over `weeklyByAgent`.
- The Telegram-notification + tier-promotion blocks stay unchanged.

Concretely, find the line `for (const row of fileData) {` (or similar — the start of the per-row loop) and replace from there to the `// upsert weekly summary` block with this exact replacement:

```javascript
      const { weeklyByAgent, matched } = this.previewState.analysis;
      const weekStart = this.previewState.weekStart;
      const weekEnd = this.previewState.weekEnd;

      // Upsert per-player activity rows
      for (const { row, agent } of matched) {
        const deposit = Number(row['First Deposit Amount']) || 0;
        const sports = Number(row['Total Bet Sports']) || 0;
        const casino = Number(row['Total Bet Casino']) || 0;
        const totalLosses = Number(row['Losses']) || 0;
        const qualifies = deposit >= 100 && (sports >= 100 || casino >= 100);
        const { error: actErr } = await App.db.from('agent_player_activity').upsert({
          agent_id: agent.id,
          user_id: row['User ID'],
          phone: row['Phone Number'] || null,
          week_start_date: weekStart,
          week_end_date: weekEnd,
          first_deposit: deposit,
          total_deposit: Number(row['Total Deposit Amount']) || 0,
          sports_bet: sports,
          casino_bet: casino,
          total_bet: Number(row['Total Bet']) || 0,
          total_losses: totalLosses,
          qualifies,
        }, { onConflict: 'agent_id,user_id,week_start_date' });
        if (actErr) console.warn('player activity upsert failed', actErr);
      }

      // Upsert per-agent weekly summaries
      for (const wd of weeklyByAgent) {
        const agent = this.agents.find(a => a.id === wd.agent_id);
        const { error: wdErr } = await App.db.from('agent_weekly_data').upsert({
          agent_id: wd.agent_id,
          week_start_date: weekStart,
          week_end_date: weekEnd,
          total_clients: wd.total_clients,
          qualifying_clients: wd.qualifying_clients,
          total_losses: wd.total_losses,
          total_earnings: wd.total_earnings,
          plan_at_import: agent ? agent.commission_plan : wd.plan,
        }, { onConflict: 'agent_id,week_start_date' });
        if (wdErr) console.warn('weekly data upsert failed', wdErr);
      }
```

- [ ] **Step 2: At the end of `confirmPlayerActivityUpload`, replace the existing alert with a notification + landing**

Find the trailing `alert('Imported successfully...')` (or similar) and replace with:

```javascript
      // Close modal, show notification, navigate to Overview
      document.getElementById('playerActivityPreviewModal').classList.add('hidden');
      this.playerActivityFileData = null;
      document.getElementById('playerActivityFile').value = '';
      document.getElementById('playerActivityFileName').textContent = '';
      this.previewState = null;
      const a = window.PreviewLogic.summarizePerPlan(weeklyByAgent);
      const totalAgents = a.A.qualifyingAgentsCount + a.B.qualifyingAgentsCount;
      const totalQualifying = a.A.totalQualifyingClients + a.B.totalQualifyingClients;
      showNotification(
        `Imported ${totalQualifying} qualifying clients across ${totalAgents} agents. Pay period ${weekStart} is now current.`,
        'success'
      );
      if (typeof this.switchSubTab === 'function') {
        this.switchSubTab('overview');
        if (typeof this.loadAgentData === 'function') await this.loadAgentData();
      }
```

(`loadAgentData` may have a different name — search for the function that refreshes the Overview's data. Use the actual name; if no such function exists, omit the second line.)

- [ ] **Step 3: Run unit tests — should still all pass (no logic in pure-functions changed)**

```bash
cd "C:/Users/USER/Desktop/Claude projects/bwanabet-crm-overview"
npm test
```

Expected: 14 passing.

- [ ] **Step 4: Manual end-to-end browser test**

1. Open `index.html` in a browser. Sign in as a manager.
2. Go to Agents → Upload subtab.
3. Pick a small test file (or create a 2-row CSV).
4. Pick week start and end dates.
5. Click Import. Modal opens with preview.
6. Click Confirm.
7. Verify: notification appears, modal closes, Overview tab is now active, the new period appears in the per-plan cards (assuming Plan 2 is in place; if Plan 2 hasn't shipped yet, just confirm Overview is loaded with no errors in the console).

If anything fails, capture the console error and fix before committing.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/USER/Desktop/Claude projects/bwanabet-crm-overview"
git add index.html
git commit -m "$(cat <<'EOF'
Wire Confirm button to existing UPSERT path; land on Overview

confirmPlayerActivityUpload now reads pre-computed weeklyByAgent and
matched arrays from previewState instead of re-parsing rows. The
agent_player_activity and agent_weekly_data UPSERTs use the same
schema as before, plus the new plan_at_import column from Plan 1.
After success, the modal closes, file inputs reset, a notification
is shown, and the user is navigated to the Overview subtab.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Mobile-viewport verification + push

**Files:** none modified

**Goal:** Confirm the preview modal renders usably on a phone-sized viewport per CLAUDE.md mobile-first rule. Final push of all Plan 4 commits.

- [ ] **Step 1: Verify on 375px width**

Open Chrome DevTools, set device toolbar to iPhone 12 Pro (390×844) or "Responsive" at 375×667.

Trigger the preview modal (use the in-console trigger from Task 8 Step 3 if no real upload data is at hand).

Confirm:
- Modal fits the viewport (no horizontal scroll).
- Per-plan cards stack vertically (`grid-cols-1`).
- Cancel and Confirm buttons are reachable, not clipped.
- Conflicts list (if visible) wraps text; no overflow.

If anything overflows, fix the Tailwind classes inline in `index.html` and commit a small follow-up: `git commit -m "Tighten preview modal on small viewport"`.

- [ ] **Step 2: Run unit tests one last time**

```bash
cd "C:/Users/USER/Desktop/Claude projects/bwanabet-crm-overview"
npm test
```

Expected: 14 passing.

- [ ] **Step 3: Verify git status is clean**

```bash
cd "C:/Users/USER/Desktop/Claude projects/bwanabet-crm-overview"
git status
git log --oneline -10
```

Expected: clean working tree (or only untracked CLAUDE.md). Recent commits include the Plan 4 series in order: test harness → preview module skeleton → summarizePerPlan → analyzeUpload → detectReuploadConflicts → modal markup → previewPlayerActivityUpload → modal renderer → Confirm wiring → optional mobile fix.

- [ ] **Step 4: Push everything**

```bash
cd "C:/Users/USER/Desktop/Claude projects/bwanabet-crm-overview"
git push origin main
```

Expected: push succeeds.

- [ ] **Step 5: Verify on GitHub**

Open `https://github.com/crmbwanabet/bwanabet-crm/commits/main` in a browser. Confirm the Plan 4 commits are visible at the top.

---

## Acceptance criteria

After this plan executes:

- [ ] `assets/js/preview.js` exists and exports `summarizePerPlan`, `analyzeUpload`, `detectReuploadConflicts`.
- [ ] `tests/preview.test.js` has at least 13 tests covering the three pure functions.
- [ ] `npm test` exits 0 with all tests passing.
- [ ] `index.html` includes `<script src="assets/js/preview.js"></script>`.
- [ ] The Player Activity Upload's Import button now opens a preview modal showing parsed file metadata, matched/skipped counts, per-plan summary, and (when applicable) re-upload conflicts and a future-date warning.
- [ ] If overpaid conflicts exist, the Confirm button is disabled until the user ticks the acknowledgement checkbox.
- [ ] If the week start is in the future, the Confirm button is disabled until the user ticks the acknowledgement checkbox.
- [ ] Clicking Confirm runs the same UPSERT logic against pre-computed analysis (`agent_player_activity` and `agent_weekly_data` rows are written with the same schema as before, plus `plan_at_import`).
- [ ] After successful Confirm: the modal closes, file inputs are reset, a success notification is shown, and the Overview subtab is now active.
- [ ] Modal renders usably at a 375px viewport width.
- [ ] All commits are pushed to `bwanabet-crm` `main`.

---

## What this plan does NOT do

- Does not change the **agent portal** (`crmbwanbetagentportal/index.html`) — that's Plan 6.
- Does not redesign the **manager Overview tab** — that's Plan 2.
- Does not add the **History tab** — that's Plan 3.
- Does not refactor the **Payments tab** — that's Plan 5.
- Does not touch the agent-list upload (the *separate* upload flow that adds new agents). That pipeline stays as-is.
- Does not add a confirmation step to the **manager batch-pay** action — Plan 2 introduces the batch action.
- Does not introduce a JS bundler or build step — the CDN/single-file architecture is preserved.

## Next plan

Plan 2 — Manager Overview redesign — is the natural next step. By the end of Plan 4, the upload pipeline is end-to-end ready (it writes the new `plan_at_import` column from Plan 1 and is gated by preview-and-confirm), so Plan 2 can be built confidently against the new data shape.
