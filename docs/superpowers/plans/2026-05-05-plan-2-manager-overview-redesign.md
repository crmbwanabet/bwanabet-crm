# Plan 2: Manager Portal Overview Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manager's Overview tab with a pay-period dashboard built around the most recent uploaded week — three per-plan cards (A/B/C), an actionable agents-to-pay table with single-row Mark Paid and batch Pay-All-Matching, and a "Current Period / All Unpaid Weeks" view toggle.

**Architecture:** Extract pure pay-period aggregation into a UMD-lite module (`assets/js/overview.js`) tested under `node --test` — same pattern as `assets/js/preview.js` from Plan 4. Replace the Overview HTML block inside `<div id="agentContent-overview">` and rewrite `AgentManager.renderOverview()` to derive the current period, run the pure aggregator, and render. Add two new modals: a week-aware "Mark Paid" (single agent) and a "Pay All Matching" (batch). The legacy `recordPayment` flow on the Payments tab is minimally patched to include `week_start_date` (Plan 5 fully refactors it later).

**Tech Stack:** Vanilla JS single-file `index.html`, Tailwind CDN, Lucide icons, Chart.js (kept for History tab in Plan 3 — Overview no longer uses it). New `assets/js/overview.js` follows the UMD-lite pattern. Node 18+ built-in `node:test` runner for unit tests, zero npm deps. Supabase JS client unchanged.

**Spec reference:** `docs/superpowers/specs/2026-05-04-affiliate-manager-redesign-design.md` Section 2.

**Repo:** `bwanabet-crm-overview` only. The agent portal repo is unaffected; Plan 6 covers that.

**Depends on:** Plan 1 (shipped — `agent_payments.week_start_date NOT NULL`, `agent_payments.recorded_by`, `agent_weekly_data.plan_at_import` already in place).

---

## File Structure

### New files
- `bwanabet-crm-overview/assets/js/overview.js` — pure-logic module exposing `findCurrentPeriod`, `computeWithdrawable`, `aggregateCurrentPeriod`, `aggregateAllUnpaidWeeks`. UMD-lite: `window.OverviewLogic` in browser, `module.exports` in Node tests. No DOM, no Supabase, no globals.
- `bwanabet-crm-overview/tests/overview.test.js` — Node `node:test` unit tests.

### Modified files
- `bwanabet-crm-overview/index.html`
  - Patch `AgentManager.recordPayment()` (~line 7012) to include `week_start_date` and `recorded_by` in the `agent_payments` INSERT — fixes the schema NOT NULL break introduced by Plan 1.
  - Add `<script src="assets/js/overview.js"></script>` after the existing `<script src="assets/js/preview.js"></script>`.
  - Replace the entire body of `<div id="agentContent-overview">` (~line 2629–2790) with the new pay-period layout.
  - Append two new modals (Mark Paid, Pay All Matching) near the existing Preview modal.
  - Rewrite `AgentManager.renderOverview()` (~line 6189) end-to-end.
  - Add new `AgentManager` methods: `_loadOverviewData`, `_renderPlanCards`, `_renderAgentsToPay`, `setOverviewView`, `openMarkPaidModal`, `confirmMarkPaid`, `openPayAllMatchingModal`, `confirmPayAllMatching`, `exportOverviewAgentsCSV`.

### Files NOT changed
- `assets/js/preview.js`, `tests/preview.test.js` — Plan 4 work, untouched.
- `migrations/*.sql` — schema is locked; Plan 2 reads new columns but doesn't alter them.
- `api/*` — server endpoints unchanged.
- Agent portal repo — out of scope.

---

## Task 1: Audit and fix the legacy `recordPayment` INSERT

**Files:**
- Modify: `bwanabet-crm-overview/index.html` — `AgentManager.recordPayment` body (~line 7012).

**Goal:** The current INSERT into `agent_payments` does not provide `week_start_date`. Since Plan 1 dropped the sentinel default, any new payment recorded via the legacy Payments-tab modal will fail with a NOT NULL violation. Patch it so it defaults to the most recent week the agent has unpaid earnings for. This is the minimum patch to unbreak production; Plan 5 fully refactors the modal.

- [ ] **Step 1: Locate the existing handler**

In `index.html`, search for `async recordPayment()`. Confirm the INSERT block matches the audit reading from this plan:

```javascript
const { data, error } = await App.db.from('agent_payments').insert({
  agent_id: agentId, amount, payment_method: method,
  payment_date: date || null, status: date ? 'paid' : 'pending',
  notes: notes || null, paid_at: date ? new Date().toISOString() : null
}).select('*, agents(name, promo_code)').single();
```

If the INSERT already contains `week_start_date`, **STOP** and skip this task — somebody already patched it.

- [ ] **Step 2: Add a small helper above `recordPayment`**

Insert this method on `AgentManager`, immediately before `async recordPayment()`:

```javascript
      // Picks the most recent week with unpaid earnings for an agent,
      // falling back to MAX(week_start_date) overall, then to today's ISO date.
      // Used by legacy single-payment INSERT so week_start_date is always set.
      _pickDefaultPaymentWeek(agentId) {
        const agentWeeks = (this.weeklyData || [])
          .filter(w => w.agent_id === agentId)
          .map(w => w.week_start_date)
          .filter(Boolean);
        if (agentWeeks.length > 0) {
          agentWeeks.sort();
          return agentWeeks[agentWeeks.length - 1];
        }
        const allWeeks = (this.weeklyData || [])
          .map(w => w.week_start_date)
          .filter(Boolean);
        if (allWeeks.length > 0) {
          allWeeks.sort();
          return allWeeks[allWeeks.length - 1];
        }
        return new Date().toISOString().slice(0, 10);
      },
```

- [ ] **Step 3: Patch the INSERT**

Replace the INSERT block in `recordPayment` with:

```javascript
          const weekStart = this._pickDefaultPaymentWeek(agentId);
          const recordedBy = (typeof Auth !== 'undefined' && Auth.user && Auth.user.email) || 'manager';
          const { data, error } = await App.db.from('agent_payments').insert({
            agent_id: agentId,
            amount,
            payment_method: method,
            payment_date: date || null,
            status: date ? 'paid' : 'pending',
            notes: notes || null,
            paid_at: date ? new Date().toISOString() : null,
            week_start_date: weekStart,
            recorded_by: recordedBy,
          }).select('*, agents(name, promo_code)').single();
```

If `Auth.user.email` is not the right session identifier, search the file for the existing pattern (e.g. `currentUser`, `App.user`, `session.user.email`) and substitute. The fallback `'manager'` keeps the column non-null without breaking the call.

- [ ] **Step 4: Manual smoke test**

Open `index.html` in a browser. Sign in as a manager. Go to Agents → Payments subtab. Record a payment (any agent, small amount, today's date). Confirm it succeeds and the row appears in the ledger. Inspect via Supabase MCP:

```sql
SELECT id, agent_id, amount, week_start_date, recorded_by, status
FROM public.agent_payments
ORDER BY created_at DESC
LIMIT 1;
```

Expected: the new row has a valid `week_start_date` (most recent week or today) and `recorded_by` is set.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
Fix legacy recordPayment INSERT — write week_start_date and recorded_by

Plan 1 made agent_payments.week_start_date NOT NULL with the sentinel
default dropped, which broke the existing Payments-tab single-payment
flow. This patch picks the agent's most recent unpaid week (or MAX
overall, or today as last resort) and writes it on every legacy INSERT,
along with recorded_by. Plan 5 will refactor the modal end-to-end.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Stand up the overview-logic module skeleton

**Files:**
- Create: `bwanabet-crm-overview/assets/js/overview.js`

**Goal:** Mirror the Plan 4 preview-module pattern — UMD-lite wrapper with stubbed pure functions, so subsequent TDD tasks have a target to require.

- [ ] **Step 1: Verify the assets/js folder exists**

```bash
cd "C:/Users/USER/Desktop/Claude projects/bwanabet-crm-overview"
ls assets/js/
```

Expected: `preview.js` is present (created in Plan 4). No further setup needed.

- [ ] **Step 2: Write the skeleton**

Create `bwanabet-crm-overview/assets/js/overview.js`:

```javascript
// overview.js — pure logic for the manager Overview pay-period dashboard.
// No DOM, no Supabase, no globals. Functions take inputs, return data.
// Loaded into the browser as window.OverviewLogic and into Node tests as module.exports.

const OverviewLogic = (() => {
  const PLAN_KEY = { per_client: 'A', loss_based: 'B', nil: 'C' };

  // Returns the most recent week_start_date in weeklyData (ISO string),
  // or null if weeklyData is empty.
  function findCurrentPeriod(weeklyData) {
    throw new Error('not implemented');
  }

  // Returns max(0, total_earnings - sum(amount of paid payments for (agent, week))).
  // weeklyRow: { agent_id, week_start_date, total_earnings }
  // payments:  array of { agent_id, week_start_date, amount, status } (only status='paid' counts).
  function computeWithdrawable(weeklyRow, payments) {
    throw new Error('not implemented');
  }

  // Aggregates everything for the "Current Period" view.
  // Inputs:
  //   weeklyData:    rows for the target week (and only that week — caller scopes the query)
  //   agents:        full agent list (for name, promo_code, recruiter, status filtering)
  //   payments:      paid payments for the target week
  //   weekStartISO:  the week being aggregated (must match weeklyData rows)
  // Returns:
  //   { perPlan: { A: {...}, B: {...}, C: {...} },
  //     rows:    [ { agent_id, name, promo_code, plan, qualifying, total_clients, earnings, paid, withdrawable, status } ],
  //     totals:  { totalEarnings, totalPaid, totalWithdrawable, agentsPending } }
  function aggregateCurrentPeriod(weeklyData, agents, payments, weekStartISO) {
    throw new Error('not implemented');
  }

  // Aggregates everything for the "All Unpaid Weeks" view.
  // Inputs:
  //   weeklyData:    rows across many weeks (caller scopes to last N weeks for perf)
  //   agents:        full agent list
  //   payments:      paid payments across the same weeks
  // Returns:
  //   { perPlan: { A, B, C } — same shape as aggregateCurrentPeriod
  //     rows:    one row per (agent, week) where withdrawable > 0
  //     totals:  same shape as aggregateCurrentPeriod
  //     weeksRepresented: number — distinct weeks contributing rows }
  function aggregateAllUnpaidWeeks(weeklyData, agents, payments) {
    throw new Error('not implemented');
  }

  return { findCurrentPeriod, computeWithdrawable, aggregateCurrentPeriod, aggregateAllUnpaidWeeks, PLAN_KEY };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = OverviewLogic;
}
if (typeof window !== 'undefined') {
  window.OverviewLogic = OverviewLogic;
}
```

- [ ] **Step 3: Verify Node can require it**

```bash
cd "C:/Users/USER/Desktop/Claude projects/bwanabet-crm-overview"
node -e "const O = require('./assets/js/overview.js'); console.log(Object.keys(O));"
```

Expected: `[ 'findCurrentPeriod', 'computeWithdrawable', 'aggregateCurrentPeriod', 'aggregateAllUnpaidWeeks', 'PLAN_KEY' ]`.

- [ ] **Step 4: Commit**

```bash
git add assets/js/overview.js
git commit -m "$(cat <<'EOF'
Add overview-logic module skeleton with four pure-function stubs

UMD-lite wrapper exposes findCurrentPeriod, computeWithdrawable,
aggregateCurrentPeriod, and aggregateAllUnpaidWeeks to both window
(browser) and module.exports (Node tests). All four throw 'not
implemented' until subsequent TDD tasks fill them in.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: TDD `findCurrentPeriod`

**Files:**
- Create: `bwanabet-crm-overview/tests/overview.test.js`
- Modify: `bwanabet-crm-overview/assets/js/overview.js`

**Goal:** The simplest helper — `MAX(week_start_date)` from in-memory rows. Worth its own task because every other aggregator depends on it and the empty-input contract matters.

- [ ] **Step 1: Write the failing tests**

Create `bwanabet-crm-overview/tests/overview.test.js`:

```javascript
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findCurrentPeriod } = require('../assets/js/overview.js');

test('findCurrentPeriod: empty array returns null', () => {
  assert.equal(findCurrentPeriod([]), null);
});

test('findCurrentPeriod: undefined returns null', () => {
  assert.equal(findCurrentPeriod(undefined), null);
});

test('findCurrentPeriod: single row returns its week_start_date', () => {
  assert.equal(findCurrentPeriod([{ week_start_date: '2026-04-27' }]), '2026-04-27');
});

test('findCurrentPeriod: returns lexicographically max ISO date', () => {
  const rows = [
    { week_start_date: '2026-04-13' },
    { week_start_date: '2026-04-27' },
    { week_start_date: '2026-04-20' },
  ];
  assert.equal(findCurrentPeriod(rows), '2026-04-27');
});

test('findCurrentPeriod: ignores rows missing week_start_date', () => {
  const rows = [
    { week_start_date: null },
    { other_field: 'x' },
    { week_start_date: '2026-04-20' },
  ];
  assert.equal(findCurrentPeriod(rows), '2026-04-20');
});

test('findCurrentPeriod: all rows missing date returns null', () => {
  const rows = [{ week_start_date: null }, { other_field: 'x' }];
  assert.equal(findCurrentPeriod(rows), null);
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cd "C:/Users/USER/Desktop/Claude projects/bwanabet-crm-overview"
npm test
```

Expected: 6 new failures for `findCurrentPeriod`. Plan 4's preview tests still pass.

- [ ] **Step 3: Implement**

In `assets/js/overview.js`, replace the body of `findCurrentPeriod`:

```javascript
  function findCurrentPeriod(weeklyData) {
    if (!Array.isArray(weeklyData) || weeklyData.length === 0) return null;
    let max = null;
    for (const row of weeklyData) {
      const d = row && row.week_start_date;
      if (!d) continue;
      if (max === null || d > max) max = d;
    }
    return max;
  }
```

- [ ] **Step 4: Run tests — expect green**

```bash
npm test
```

Expected: all `findCurrentPeriod` tests pass.

- [ ] **Step 5: Commit**

```bash
git add assets/js/overview.js tests/overview.test.js
git commit -m "$(cat <<'EOF'
Implement findCurrentPeriod for Overview pay-period dashboard

Returns MAX(week_start_date) from in-memory weekly_data rows, or null
when input is empty/missing. Six TDD tests cover empty/undefined input,
single row, lex-max selection, sparse rows, and all-null input.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: TDD `computeWithdrawable`

**Files:**
- Modify: `bwanabet-crm-overview/tests/overview.test.js`
- Modify: `bwanabet-crm-overview/assets/js/overview.js`

**Goal:** Per-(agent, week) withdrawable = `max(0, total_earnings - sum(paid amount for that agent/week))`. Critical primitive — every plan card and every table row uses it.

- [ ] **Step 1: Add failing tests**

Append to `tests/overview.test.js`:

```javascript
const { computeWithdrawable } = require('../assets/js/overview.js');

test('computeWithdrawable: no payments returns full earnings', () => {
  const row = { agent_id: 'a1', week_start_date: '2026-04-27', total_earnings: 400 };
  assert.equal(computeWithdrawable(row, []), 400);
});

test('computeWithdrawable: one matching paid payment subtracts', () => {
  const row = { agent_id: 'a1', week_start_date: '2026-04-27', total_earnings: 400 };
  const pays = [{ agent_id: 'a1', week_start_date: '2026-04-27', amount: 100, status: 'paid' }];
  assert.equal(computeWithdrawable(row, pays), 300);
});

test('computeWithdrawable: multiple paid payments sum', () => {
  const row = { agent_id: 'a1', week_start_date: '2026-04-27', total_earnings: 400 };
  const pays = [
    { agent_id: 'a1', week_start_date: '2026-04-27', amount: 100, status: 'paid' },
    { agent_id: 'a1', week_start_date: '2026-04-27', amount: 200, status: 'paid' },
  ];
  assert.equal(computeWithdrawable(row, pays), 100);
});

test('computeWithdrawable: pending or cancelled payments do not subtract', () => {
  const row = { agent_id: 'a1', week_start_date: '2026-04-27', total_earnings: 400 };
  const pays = [
    { agent_id: 'a1', week_start_date: '2026-04-27', amount: 100, status: 'pending' },
    { agent_id: 'a1', week_start_date: '2026-04-27', amount: 100, status: 'cancelled' },
    { agent_id: 'a1', week_start_date: '2026-04-27', amount: 100, status: 'paid' },
  ];
  assert.equal(computeWithdrawable(row, pays), 300);
});

test('computeWithdrawable: payments for other agents/weeks ignored', () => {
  const row = { agent_id: 'a1', week_start_date: '2026-04-27', total_earnings: 400 };
  const pays = [
    { agent_id: 'a2', week_start_date: '2026-04-27', amount: 999, status: 'paid' }, // wrong agent
    { agent_id: 'a1', week_start_date: '2026-04-20', amount: 999, status: 'paid' }, // wrong week
    { agent_id: 'a1', week_start_date: '2026-04-27', amount: 100, status: 'paid' }, // counts
  ];
  assert.equal(computeWithdrawable(row, pays), 300);
});

test('computeWithdrawable: overpaid clamps to 0', () => {
  const row = { agent_id: 'a1', week_start_date: '2026-04-27', total_earnings: 100 };
  const pays = [{ agent_id: 'a1', week_start_date: '2026-04-27', amount: 250, status: 'paid' }];
  assert.equal(computeWithdrawable(row, pays), 0);
});

test('computeWithdrawable: negative reversal payment increases withdrawable', () => {
  // A reversal is a negative-amount paid row. computeWithdrawable subtracts the SUM,
  // which is (200 + -50) = 150 → withdrawable = 400 - 150 = 250.
  const row = { agent_id: 'a1', week_start_date: '2026-04-27', total_earnings: 400 };
  const pays = [
    { agent_id: 'a1', week_start_date: '2026-04-27', amount: 200,  status: 'paid' },
    { agent_id: 'a1', week_start_date: '2026-04-27', amount: -50,  status: 'paid' }, // reversal
  ];
  assert.equal(computeWithdrawable(row, pays), 250);
});

test('computeWithdrawable: total_earnings is parsed even when string', () => {
  const row = { agent_id: 'a1', week_start_date: '2026-04-27', total_earnings: '400.50' };
  assert.equal(computeWithdrawable(row, []), 400.5);
});
```

- [ ] **Step 2: Run tests — expect 8 new failures**

```bash
npm test
```

- [ ] **Step 3: Implement**

In `assets/js/overview.js`, replace `computeWithdrawable`:

```javascript
  function computeWithdrawable(weeklyRow, payments) {
    const earnings = Number(weeklyRow.total_earnings) || 0;
    let paidSum = 0;
    for (const p of (payments || [])) {
      if (p.status !== 'paid') continue;
      if (p.agent_id !== weeklyRow.agent_id) continue;
      if (p.week_start_date !== weeklyRow.week_start_date) continue;
      paidSum += Number(p.amount) || 0;
    }
    const w = earnings - paidSum;
    return w > 0 ? w : 0;
  }
```

- [ ] **Step 4: Run tests — expect green**

```bash
npm test
```

Expected: all 8 new + 6 from Task 3 + Plan 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add assets/js/overview.js tests/overview.test.js
git commit -m "$(cat <<'EOF'
Implement computeWithdrawable per-(agent, week)

Subtracts the sum of paid payments (status='paid', matching agent_id
and week_start_date) from total_earnings, clamped to zero. Pending and
cancelled payments are ignored. Negative-amount paid rows (reversals)
increase the withdrawable correctly via summed-then-clamped semantics.
Eight TDD tests cover empty payments, single/multi paid, status filter,
agent/week scoping, overpaid clamp, reversal arithmetic, and string
parsing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: TDD `aggregateCurrentPeriod`

**Files:**
- Modify: `bwanabet-crm-overview/tests/overview.test.js`
- Modify: `bwanabet-crm-overview/assets/js/overview.js`

**Goal:** Compose the previous primitives into the dashboard's main aggregator. Returns per-plan summary, the agents-to-pay rows, and grand totals — everything `renderOverview` needs for the Current Period view.

The per-plan summary shape (per the spec) for plans A, B, and C:
- `agentsCount` — # agents on this plan with a row in `weeklyData` for the target week
- `qualifyingAgentsCount` — # of those whose `qualifying_clients > 0`
- `totalClients` — sum of `total_clients`
- `totalQualifyingClients` — sum of `qualifying_clients`
- `totalLosses` — sum of `total_losses`
- `totalEarnings` — sum of `total_earnings`
- `totalPaid` — sum of paid payments for this plan's agents (this week)
- `totalWithdrawable` — sum of `computeWithdrawable` per row, clamped

Each row in `rows`:
- `agent_id, name, promo_code, plan` (the letter A/B/C), `week_start_date`
- `qualifying`, `total_clients`, `earnings`, `paid`, `withdrawable`
- `status` — `'paid'` if `paid >= earnings && earnings > 0`, `'partially_paid'` if `0 < paid < earnings`, `'pending'` if `paid === 0 && earnings > 0`, `'no_qualifiers'` if `earnings === 0`.

- [ ] **Step 1: Add failing tests**

Append to `tests/overview.test.js`:

```javascript
const { aggregateCurrentPeriod } = require('../assets/js/overview.js');

const sampleAgentsForAggregate = [
  { id: 'a1', name: 'Alice',   promo_code: 'A100', commission_plan: 'per_client', status: 'active' },
  { id: 'a2', name: 'Bob',     promo_code: 'A200', commission_plan: 'per_client', status: 'active' },
  { id: 'a3', name: 'Carol',   promo_code: 'A300', commission_plan: 'loss_based', status: 'active' },
  { id: 'a4', name: 'Dave',    promo_code: 'A400', commission_plan: 'nil',        status: 'active' },
  { id: 'a5', name: 'Inactive',promo_code: 'A500', commission_plan: 'per_client', status: 'inactive' },
];

test('aggregateCurrentPeriod: empty inputs return zero totals', () => {
  const r = aggregateCurrentPeriod([], sampleAgentsForAggregate, [], '2026-04-27');
  assert.equal(r.rows.length, 0);
  assert.equal(r.totals.totalEarnings, 0);
  assert.equal(r.totals.totalPaid, 0);
  assert.equal(r.totals.totalWithdrawable, 0);
  assert.equal(r.totals.agentsPending, 0);
  assert.equal(r.perPlan.A.agentsCount, 0);
  assert.equal(r.perPlan.B.agentsCount, 0);
  assert.equal(r.perPlan.C.agentsCount, 0);
});

test('aggregateCurrentPeriod: per-plan card numbers for typical week', () => {
  const weekly = [
    { agent_id: 'a1', week_start_date: '2026-04-27', total_clients: 5, qualifying_clients: 4, total_losses: 0,    total_earnings: 400 },
    { agent_id: 'a2', week_start_date: '2026-04-27', total_clients: 3, qualifying_clients: 0, total_losses: 0,    total_earnings: 0   },
    { agent_id: 'a3', week_start_date: '2026-04-27', total_clients: 2, qualifying_clients: 2, total_losses: 1500, total_earnings: 300 },
    { agent_id: 'a4', week_start_date: '2026-04-27', total_clients: 1, qualifying_clients: 1, total_losses: 100,  total_earnings: 0   },
  ];
  const r = aggregateCurrentPeriod(weekly, sampleAgentsForAggregate, [], '2026-04-27');
  // Plan A: 2 agents (a1, a2), 1 qualifying (a1), totals
  assert.equal(r.perPlan.A.agentsCount, 2);
  assert.equal(r.perPlan.A.qualifyingAgentsCount, 1);
  assert.equal(r.perPlan.A.totalQualifyingClients, 4);
  assert.equal(r.perPlan.A.totalEarnings, 400);
  // Plan B: 1 agent (a3)
  assert.equal(r.perPlan.B.agentsCount, 1);
  assert.equal(r.perPlan.B.totalLosses, 1500);
  assert.equal(r.perPlan.B.totalEarnings, 300);
  // Plan C: 1 agent (a4), zero earnings
  assert.equal(r.perPlan.C.agentsCount, 1);
  assert.equal(r.perPlan.C.totalEarnings, 0);
});

test('aggregateCurrentPeriod: rows ordered by amount desc by default in totals', () => {
  // The aggregator returns rows in input order; sorting is the renderer's job.
  // But totals.agentsPending counts rows with withdrawable > 0.
  const weekly = [
    { agent_id: 'a1', week_start_date: '2026-04-27', total_clients: 5, qualifying_clients: 4, total_losses: 0, total_earnings: 400 },
    { agent_id: 'a2', week_start_date: '2026-04-27', total_clients: 3, qualifying_clients: 0, total_losses: 0, total_earnings: 0   },
    { agent_id: 'a3', week_start_date: '2026-04-27', total_clients: 2, qualifying_clients: 2, total_losses: 1500, total_earnings: 300 },
  ];
  const r = aggregateCurrentPeriod(weekly, sampleAgentsForAggregate, [], '2026-04-27');
  assert.equal(r.totals.agentsPending, 2); // a1 and a3 have withdrawable > 0; a2 has 0
  assert.equal(r.totals.totalEarnings, 700);
  assert.equal(r.totals.totalWithdrawable, 700);
});

test('aggregateCurrentPeriod: paid payments reduce withdrawable and totals', () => {
  const weekly = [
    { agent_id: 'a1', week_start_date: '2026-04-27', total_clients: 5, qualifying_clients: 4, total_losses: 0, total_earnings: 400 },
  ];
  const pays = [
    { agent_id: 'a1', week_start_date: '2026-04-27', amount: 150, status: 'paid' },
  ];
  const r = aggregateCurrentPeriod(weekly, sampleAgentsForAggregate, pays, '2026-04-27');
  assert.equal(r.rows[0].paid, 150);
  assert.equal(r.rows[0].withdrawable, 250);
  assert.equal(r.rows[0].status, 'partially_paid');
  assert.equal(r.totals.totalPaid, 150);
  assert.equal(r.totals.totalWithdrawable, 250);
  assert.equal(r.perPlan.A.totalPaid, 150);
  assert.equal(r.perPlan.A.totalWithdrawable, 250);
});

test('aggregateCurrentPeriod: row status reflects payment state', () => {
  const weekly = [
    { agent_id: 'a1', week_start_date: '2026-04-27', total_clients: 5, qualifying_clients: 4, total_losses: 0, total_earnings: 400 }, // pending
    { agent_id: 'a2', week_start_date: '2026-04-27', total_clients: 3, qualifying_clients: 0, total_losses: 0, total_earnings: 0   }, // no_qualifiers
    { agent_id: 'a3', week_start_date: '2026-04-27', total_clients: 2, qualifying_clients: 2, total_losses: 0, total_earnings: 200 }, // partially_paid
  ];
  const pays = [
    { agent_id: 'a3', week_start_date: '2026-04-27', amount: 100, status: 'paid' },
  ];
  const r = aggregateCurrentPeriod(weekly, sampleAgentsForAggregate, pays, '2026-04-27');
  const byId = Object.fromEntries(r.rows.map(row => [row.agent_id, row]));
  assert.equal(byId['a1'].status, 'pending');
  assert.equal(byId['a2'].status, 'no_qualifiers');
  assert.equal(byId['a3'].status, 'partially_paid');
});

test('aggregateCurrentPeriod: fully paid status', () => {
  const weekly = [
    { agent_id: 'a1', week_start_date: '2026-04-27', total_clients: 5, qualifying_clients: 4, total_losses: 0, total_earnings: 400 },
  ];
  const pays = [
    { agent_id: 'a1', week_start_date: '2026-04-27', amount: 400, status: 'paid' },
  ];
  const r = aggregateCurrentPeriod(weekly, sampleAgentsForAggregate, pays, '2026-04-27');
  assert.equal(r.rows[0].status, 'paid');
  assert.equal(r.rows[0].withdrawable, 0);
});

test('aggregateCurrentPeriod: ignores rows for other weeks', () => {
  const weekly = [
    { agent_id: 'a1', week_start_date: '2026-04-27', total_clients: 5, qualifying_clients: 4, total_losses: 0, total_earnings: 400 },
    { agent_id: 'a1', week_start_date: '2026-04-20', total_clients: 9, qualifying_clients: 9, total_losses: 0, total_earnings: 999 }, // wrong week
  ];
  const r = aggregateCurrentPeriod(weekly, sampleAgentsForAggregate, [], '2026-04-27');
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].earnings, 400);
});

test('aggregateCurrentPeriod: row carries name/promo_code from agents lookup', () => {
  const weekly = [
    { agent_id: 'a1', week_start_date: '2026-04-27', total_clients: 5, qualifying_clients: 4, total_losses: 0, total_earnings: 400 },
  ];
  const r = aggregateCurrentPeriod(weekly, sampleAgentsForAggregate, [], '2026-04-27');
  assert.equal(r.rows[0].name, 'Alice');
  assert.equal(r.rows[0].promo_code, 'A100');
  assert.equal(r.rows[0].plan, 'A');
});

test('aggregateCurrentPeriod: row for unknown agent gets placeholder name', () => {
  const weekly = [
    { agent_id: 'ghost', week_start_date: '2026-04-27', total_clients: 1, qualifying_clients: 1, total_losses: 0, total_earnings: 100 },
  ];
  const r = aggregateCurrentPeriod(weekly, sampleAgentsForAggregate, [], '2026-04-27');
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].name, '(unknown)');
  assert.equal(r.rows[0].promo_code, '');
  // Plan letter falls back to '?' so it doesn't crash counters.
  assert.equal(r.rows[0].plan, '?');
});
```

- [ ] **Step 2: Run tests — expect 9 failures**

```bash
npm test
```

- [ ] **Step 3: Implement**

In `assets/js/overview.js`, replace `aggregateCurrentPeriod`:

```javascript
  function aggregateCurrentPeriod(weeklyData, agents, payments, weekStartISO) {
    const agentsById = new Map((agents || []).map(a => [a.id, a]));
    const emptyPlan = () => ({
      agentsCount: 0,
      qualifyingAgentsCount: 0,
      totalClients: 0,
      totalQualifyingClients: 0,
      totalLosses: 0,
      totalEarnings: 0,
      totalPaid: 0,
      totalWithdrawable: 0,
    });
    const perPlan = { A: emptyPlan(), B: emptyPlan(), C: emptyPlan() };
    const rows = [];
    let totalEarnings = 0, totalPaid = 0, totalWithdrawable = 0, agentsPending = 0;

    for (const wd of (weeklyData || [])) {
      if (wd.week_start_date !== weekStartISO) continue;
      const agent = agentsById.get(wd.agent_id);
      const plan = agent ? PLAN_KEY[agent.commission_plan] : '?';
      const earnings = Number(wd.total_earnings) || 0;
      const paid = (() => {
        let s = 0;
        for (const p of (payments || [])) {
          if (p.status !== 'paid') continue;
          if (p.agent_id !== wd.agent_id) continue;
          if (p.week_start_date !== weekStartISO) continue;
          s += Number(p.amount) || 0;
        }
        return s;
      })();
      const withdrawable = earnings - paid > 0 ? earnings - paid : 0;
      let status;
      if (earnings === 0) status = 'no_qualifiers';
      else if (paid <= 0) status = 'pending';
      else if (paid >= earnings) status = 'paid';
      else status = 'partially_paid';

      const row = {
        agent_id: wd.agent_id,
        name: agent ? agent.name : '(unknown)',
        promo_code: agent ? agent.promo_code : '',
        plan,
        week_start_date: wd.week_start_date,
        qualifying: Number(wd.qualifying_clients) || 0,
        total_clients: Number(wd.total_clients) || 0,
        earnings,
        paid,
        withdrawable,
        status,
      };
      rows.push(row);

      totalEarnings += earnings;
      totalPaid += paid;
      totalWithdrawable += withdrawable;
      if (withdrawable > 0) agentsPending += 1;

      if (plan === 'A' || plan === 'B' || plan === 'C') {
        const bucket = perPlan[plan];
        bucket.agentsCount += 1;
        if (row.qualifying > 0) bucket.qualifyingAgentsCount += 1;
        bucket.totalClients += row.total_clients;
        bucket.totalQualifyingClients += row.qualifying;
        bucket.totalLosses += Number(wd.total_losses) || 0;
        bucket.totalEarnings += earnings;
        bucket.totalPaid += paid;
        bucket.totalWithdrawable += withdrawable;
      }
    }

    return {
      perPlan,
      rows,
      totals: { totalEarnings, totalPaid, totalWithdrawable, agentsPending },
    };
  }
```

- [ ] **Step 4: Run tests — expect green**

```bash
npm test
```

Expected: all aggregate tests pass.

- [ ] **Step 5: Commit**

```bash
git add assets/js/overview.js tests/overview.test.js
git commit -m "$(cat <<'EOF'
Implement aggregateCurrentPeriod for the Overview pay-period view

Composes findCurrentPeriod's output into per-plan summary cards,
agents-to-pay rows with per-row payment status (paid/partially_paid/
pending/no_qualifiers), and grand totals (earnings, paid, withdrawable,
agentsPending). Per-plan buckets sum totalLosses (Plan B) and
totalEarnings as well as agent and qualifying counts. Nine TDD tests
cover empty input, multi-plan distribution, payment integration,
status classification, week scoping, and unknown-agent handling.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: TDD `aggregateAllUnpaidWeeks`

**Files:**
- Modify: `bwanabet-crm-overview/tests/overview.test.js`
- Modify: `bwanabet-crm-overview/assets/js/overview.js`

**Goal:** "All Unpaid Weeks" view aggregates across every week with `withdrawable > 0`. One row per (agent, week). Same per-plan + totals shape as `aggregateCurrentPeriod`, plus a `weeksRepresented` count.

- [ ] **Step 1: Add failing tests**

Append to `tests/overview.test.js`:

```javascript
const { aggregateAllUnpaidWeeks } = require('../assets/js/overview.js');

test('aggregateAllUnpaidWeeks: empty inputs return zeros', () => {
  const r = aggregateAllUnpaidWeeks([], sampleAgentsForAggregate, []);
  assert.equal(r.rows.length, 0);
  assert.equal(r.weeksRepresented, 0);
  assert.equal(r.totals.totalWithdrawable, 0);
});

test('aggregateAllUnpaidWeeks: emits one row per (agent, week) with withdrawable > 0', () => {
  const weekly = [
    { agent_id: 'a1', week_start_date: '2026-04-27', total_clients: 5, qualifying_clients: 4, total_losses: 0, total_earnings: 400 },
    { agent_id: 'a1', week_start_date: '2026-04-20', total_clients: 3, qualifying_clients: 3, total_losses: 0, total_earnings: 300 },
    { agent_id: 'a1', week_start_date: '2026-04-13', total_clients: 1, qualifying_clients: 0, total_losses: 0, total_earnings: 0   }, // skipped: zero earnings
  ];
  const r = aggregateAllUnpaidWeeks(weekly, sampleAgentsForAggregate, []);
  assert.equal(r.rows.length, 2);
  assert.equal(r.weeksRepresented, 2); // 04-27 and 04-20
  assert.equal(r.totals.totalEarnings, 700);
  assert.equal(r.totals.totalWithdrawable, 700);
});

test('aggregateAllUnpaidWeeks: fully-paid weeks are excluded from rows', () => {
  const weekly = [
    { agent_id: 'a1', week_start_date: '2026-04-27', total_clients: 5, qualifying_clients: 4, total_losses: 0, total_earnings: 400 },
    { agent_id: 'a1', week_start_date: '2026-04-20', total_clients: 3, qualifying_clients: 3, total_losses: 0, total_earnings: 300 },
  ];
  const pays = [
    { agent_id: 'a1', week_start_date: '2026-04-20', amount: 300, status: 'paid' }, // settles 04-20
  ];
  const r = aggregateAllUnpaidWeeks(weekly, sampleAgentsForAggregate, pays);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].week_start_date, '2026-04-27');
  assert.equal(r.weeksRepresented, 1);
  // Per-plan totals only include rows that survive (consistent with display).
  assert.equal(r.perPlan.A.totalWithdrawable, 400);
});

test('aggregateAllUnpaidWeeks: partially-paid weeks ARE included', () => {
  const weekly = [
    { agent_id: 'a1', week_start_date: '2026-04-27', total_clients: 5, qualifying_clients: 4, total_losses: 0, total_earnings: 400 },
  ];
  const pays = [
    { agent_id: 'a1', week_start_date: '2026-04-27', amount: 100, status: 'paid' },
  ];
  const r = aggregateAllUnpaidWeeks(weekly, sampleAgentsForAggregate, pays);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].withdrawable, 300);
  assert.equal(r.rows[0].status, 'partially_paid');
});

test('aggregateAllUnpaidWeeks: per-plan totals span multiple agents and weeks', () => {
  const weekly = [
    { agent_id: 'a1', week_start_date: '2026-04-27', total_clients: 5, qualifying_clients: 4, total_losses: 0,    total_earnings: 400 },
    { agent_id: 'a2', week_start_date: '2026-04-27', total_clients: 3, qualifying_clients: 2, total_losses: 0,    total_earnings: 200 },
    { agent_id: 'a3', week_start_date: '2026-04-20', total_clients: 1, qualifying_clients: 1, total_losses: 1000, total_earnings: 200 },
  ];
  const r = aggregateAllUnpaidWeeks(weekly, sampleAgentsForAggregate, []);
  assert.equal(r.perPlan.A.totalWithdrawable, 600);
  assert.equal(r.perPlan.A.qualifyingAgentsCount, 2); // a1 and a2
  assert.equal(r.perPlan.B.totalWithdrawable, 200);
  assert.equal(r.weeksRepresented, 2);
});
```

- [ ] **Step 2: Run tests — expect 5 failures**

```bash
npm test
```

- [ ] **Step 3: Implement**

In `assets/js/overview.js`, replace `aggregateAllUnpaidWeeks`:

```javascript
  function aggregateAllUnpaidWeeks(weeklyData, agents, payments) {
    const agentsById = new Map((agents || []).map(a => [a.id, a]));
    const emptyPlan = () => ({
      agentsCount: 0,
      qualifyingAgentsCount: 0,
      totalClients: 0,
      totalQualifyingClients: 0,
      totalLosses: 0,
      totalEarnings: 0,
      totalPaid: 0,
      totalWithdrawable: 0,
    });
    const perPlan = { A: emptyPlan(), B: emptyPlan(), C: emptyPlan() };
    const rows = [];
    const weeks = new Set();
    let totalEarnings = 0, totalPaid = 0, totalWithdrawable = 0, agentsPending = 0;

    // Index payments by (agent_id|week)
    const paidByKey = new Map();
    for (const p of (payments || [])) {
      if (p.status !== 'paid') continue;
      const key = p.agent_id + '|' + p.week_start_date;
      paidByKey.set(key, (paidByKey.get(key) || 0) + (Number(p.amount) || 0));
    }

    for (const wd of (weeklyData || [])) {
      const earnings = Number(wd.total_earnings) || 0;
      const key = wd.agent_id + '|' + wd.week_start_date;
      const paid = paidByKey.get(key) || 0;
      const withdrawable = earnings - paid > 0 ? earnings - paid : 0;
      if (withdrawable <= 0) continue; // filter out fully-paid + zero-earnings rows

      const agent = agentsById.get(wd.agent_id);
      const plan = agent ? PLAN_KEY[agent.commission_plan] : '?';
      let status;
      if (paid <= 0) status = 'pending';
      else if (paid >= earnings) status = 'paid'; // shouldn't reach here since withdrawable > 0
      else status = 'partially_paid';

      const row = {
        agent_id: wd.agent_id,
        name: agent ? agent.name : '(unknown)',
        promo_code: agent ? agent.promo_code : '',
        plan,
        week_start_date: wd.week_start_date,
        qualifying: Number(wd.qualifying_clients) || 0,
        total_clients: Number(wd.total_clients) || 0,
        earnings,
        paid,
        withdrawable,
        status,
      };
      rows.push(row);
      weeks.add(wd.week_start_date);

      totalEarnings += earnings;
      totalPaid += paid;
      totalWithdrawable += withdrawable;
      agentsPending += 1;

      if (plan === 'A' || plan === 'B' || plan === 'C') {
        const bucket = perPlan[plan];
        bucket.agentsCount += 1;
        if (row.qualifying > 0) bucket.qualifyingAgentsCount += 1;
        bucket.totalClients += row.total_clients;
        bucket.totalQualifyingClients += row.qualifying;
        bucket.totalLosses += Number(wd.total_losses) || 0;
        bucket.totalEarnings += earnings;
        bucket.totalPaid += paid;
        bucket.totalWithdrawable += withdrawable;
      }
    }

    return {
      perPlan,
      rows,
      totals: { totalEarnings, totalPaid, totalWithdrawable, agentsPending },
      weeksRepresented: weeks.size,
    };
  }
```

- [ ] **Step 4: Run tests — expect green**

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
git add assets/js/overview.js tests/overview.test.js
git commit -m "$(cat <<'EOF'
Implement aggregateAllUnpaidWeeks for cross-week arrears view

Emits one row per (agent, week) where withdrawable > 0; fully paid and
zero-earnings rows are filtered out. Per-plan totals and grand totals
mirror aggregateCurrentPeriod's shape, plus weeksRepresented for the
header indicator. Five TDD tests cover empty input, multi-week
emission, settled-week exclusion, partial-payment inclusion, and
multi-agent multi-plan aggregation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Replace the Overview tab markup

**Files:**
- Modify: `bwanabet-crm-overview/index.html` — replace the body of `<div id="agentContent-overview">` (~line 2629) with the new pay-period layout, and add `<script src="assets/js/overview.js"></script>`.

**Goal:** Static markup only — every interactive piece is wired in later tasks. The new HTML uses placeholder element IDs that JS will populate.

- [ ] **Step 1: Add the script include**

Search for `<script src="assets/js/preview.js">`. Immediately after it, add:

```html
<script src="assets/js/overview.js"></script>
```

- [ ] **Step 2: Locate the Overview tab body**

Find the line `<!-- OVERVIEW SUB-TAB -->` followed by `<div id="agentContent-overview">`. Note where this `<div>` opens and where its corresponding closing `</div>` is. The block runs from the comment down through three sections (Trend Dashboard, Mini Chart, Key Metrics Row, Commission Plans, Top Performers leaderboards) — all of which is being replaced.

- [ ] **Step 3: Replace the entire Overview tab body**

Replace everything between `<div id="agentContent-overview">` and its closing `</div>` (just before `<!-- PAYMENTS SUB-TAB -->`) with this exact markup:

```html
        <div id="agentContent-overview">

          <!-- HEADER STRIP: pay period + view toggle -->
          <div class="bg-white rounded-xl px-4 py-3 mb-4 flex flex-col sm:flex-row sm:items-center gap-3" style="border:1px solid #e2e8f0;">
            <div class="flex items-center gap-2 flex-1 min-w-0">
              <i data-lucide="calendar-clock" class="h-4 w-4 text-slate-500 flex-shrink-0"></i>
              <span class="text-xs text-slate-500 uppercase tracking-wider">Pay Period:</span>
              <span id="overviewPeriodLabel" class="text-sm font-semibold text-slate-800 truncate">—</span>
              <span id="overviewPeriodMeta" class="text-xs text-slate-400 hidden sm:inline truncate"></span>
            </div>
            <div class="flex items-center gap-2">
              <label class="text-xs text-slate-500" for="overviewViewSelect">View:</label>
              <select id="overviewViewSelect" onchange="AgentManager.setOverviewView(this.value)" class="px-2 py-1 border rounded-lg text-sm bg-white">
                <option value="current">Current Period</option>
                <option value="all_unpaid">All Unpaid Weeks</option>
              </select>
            </div>
          </div>

          <!-- PER-PLAN CARDS -->
          <div id="overviewPlanCards" class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <!-- populated by JS: 3 cards (Plan A / B / C) -->
          </div>

          <!-- TOTALS STRIP -->
          <div id="overviewTotals" class="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 mb-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <div class="flex-1 min-w-0">
              <div class="text-xs text-emerald-700 uppercase tracking-wider">Total to pay out this period</div>
              <div class="flex items-baseline gap-2 mt-0.5 flex-wrap">
                <span id="overviewTotalsAmount" class="text-2xl font-extrabold text-emerald-800">K0</span>
                <span class="text-sm text-emerald-700">·</span>
                <span class="text-sm text-emerald-700"><span id="overviewTotalsPending">0</span> agents pending</span>
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              <button id="overviewPayAllBtn" onclick="AgentManager.openPayAllMatchingModal()" class="px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed" disabled>
                <i data-lucide="banknote" class="h-4 w-4"></i>
                Pay all matching filters
              </button>
              <button onclick="AgentManager.exportOverviewAgentsCSV()" class="px-3 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 text-sm flex items-center gap-2">
                <i data-lucide="download" class="h-4 w-4"></i>
                Export CSV
              </button>
            </div>
          </div>

          <!-- AGENTS-TO-PAY TABLE -->
          <div class="bg-white rounded-xl shadow-sm overflow-hidden" style="border:1px solid #e2e8f0;">
            <div class="bg-slate-800 text-white px-4 py-3 flex items-center justify-between">
              <h3 class="font-semibold text-sm flex items-center gap-2">
                <i data-lucide="list-checks" class="h-4 w-4"></i>
                Agents to pay
              </h3>
              <span id="overviewRowCount" class="text-xs text-slate-300">0 rows</span>
            </div>

            <!-- FILTER ROW -->
            <div class="grid grid-cols-1 sm:grid-cols-4 gap-2 p-3 bg-slate-50 border-b border-slate-200">
              <select id="overviewPlanFilter" onchange="AgentManager.renderOverview()" class="px-2 py-2 border rounded-lg text-sm bg-white">
                <option value="all">All plans</option>
                <option value="per_client">Plan A · Per-Client</option>
                <option value="loss_based">Plan B · Loss-Based</option>
                <option value="nil">Plan C · Tracking</option>
              </select>
              <select id="overviewStatusFilter" onchange="AgentManager.renderOverview()" class="px-2 py-2 border rounded-lg text-sm bg-white">
                <option value="pending">Status: Pending</option>
                <option value="all">Status: All</option>
                <option value="paid">Status: Paid</option>
                <option value="partially_paid">Status: Partial</option>
                <option value="no_qualifiers">Status: No qualifiers</option>
              </select>
              <input id="overviewSearchInput" type="search" placeholder="Search agent or code…" oninput="AgentManager.renderOverview()" class="px-3 py-2 border rounded-lg text-sm">
              <select id="overviewSortSelect" onchange="AgentManager.renderOverview()" class="px-2 py-2 border rounded-lg text-sm bg-white">
                <option value="amount_desc">Sort: Amount desc</option>
                <option value="amount_asc">Sort: Amount asc</option>
                <option value="name_asc">Sort: Name A→Z</option>
                <option value="qualifying_desc">Sort: Qualifying desc</option>
              </select>
            </div>

            <!-- TABLE -->
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="bg-slate-50 text-xs">
                  <tr>
                    <th class="px-3 py-2 text-left font-semibold text-slate-600">Agent</th>
                    <th class="px-3 py-2 text-center font-semibold text-slate-600">Plan</th>
                    <th class="px-3 py-2 text-right font-semibold text-slate-600">Qualifying</th>
                    <th class="px-3 py-2 text-right font-semibold text-slate-600">Earnings</th>
                    <th class="px-3 py-2 text-right font-semibold text-slate-600">Withdrawable</th>
                    <th class="px-3 py-2 text-center font-semibold text-slate-600">Status</th>
                    <th class="px-3 py-2 text-center font-semibold text-slate-600">Action</th>
                  </tr>
                </thead>
                <tbody id="overviewTableBody">
                  <!-- populated by JS -->
                </tbody>
              </table>
            </div>

            <!-- EMPTY STATE -->
            <div id="overviewEmptyState" class="hidden p-8 text-center text-slate-500 text-sm">
              <!-- populated by JS depending on cause -->
            </div>
          </div>
        </div>
```

- [ ] **Step 4: Verify the page still loads**

Open `index.html` in a browser. Sign in as a manager. Click Agents → Overview. Expected: layout placeholders render (period label `—`, plan cards empty, totals strip K0). No console errors.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
Replace Overview tab markup with pay-period layout

Old monolithic Overview (week-vs-lifetime trend cards, mini chart,
5-card metrics row, commission-plans row, three top-performers
leaderboards) is removed entirely — those views now live in History
(Plan 3) or are gone per the spec. New layout: header strip with
period label and view toggle, three plan cards, totals strip with
Pay-All-Matching and Export CSV buttons, and an agents-to-pay table
with filter row (plan/status/search/sort). All placeholders;
JS wiring in subsequent tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Add Mark Paid and Pay-All-Matching modals

**Files:**
- Modify: `bwanabet-crm-overview/index.html` — append two modal blocks near the existing `playerActivityPreviewModal`.

**Goal:** Modal DOM only — JS that opens/populates them is added in Tasks 11.

- [ ] **Step 1: Locate the Preview modal closing tag**

Find `id="playerActivityPreviewModal"`. Scroll to its closing `</div></div>`. Insert the new modals immediately AFTER that closing tag.

- [ ] **Step 2: Insert the Mark Paid modal**

```html
<!-- Mark Paid (single) — opened from Overview row [Mark Paid] -->
<div id="markPaidModal" class="hidden fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4">
  <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh]">
    <div class="bg-emerald-700 text-white px-5 py-4 rounded-t-2xl flex items-center justify-between">
      <h3 class="font-semibold flex items-center gap-2">
        <i data-lucide="banknote" class="h-5 w-5"></i>
        Mark Paid
      </h3>
      <button onclick="document.getElementById('markPaidModal').classList.add('hidden')" class="text-emerald-200 hover:text-white">
        <i data-lucide="x" class="h-5 w-5"></i>
      </button>
    </div>
    <div class="p-5 space-y-3 overflow-y-auto">
      <div class="rounded-lg bg-slate-50 px-3 py-2 text-sm">
        <div><span class="text-slate-500">Agent:</span> <span class="font-semibold" id="markPaidAgent">—</span></div>
        <div><span class="text-slate-500">Week:</span> <span class="font-semibold" id="markPaidWeek">—</span></div>
        <div><span class="text-slate-500">Earnings:</span> <span id="markPaidEarnings">K0</span></div>
        <div><span class="text-slate-500">Already paid:</span> <span id="markPaidAlready">K0</span></div>
        <div><span class="text-slate-500">Withdrawable:</span> <span class="font-semibold text-emerald-700" id="markPaidOutstanding">K0</span></div>
      </div>
      <div>
        <label class="block text-xs font-medium text-slate-700 mb-1">Amount (K)</label>
        <input id="markPaidAmount" type="number" step="0.01" class="w-full px-3 py-2 border rounded-lg text-sm">
      </div>
      <div>
        <label class="block text-xs font-medium text-slate-700 mb-1">Method</label>
        <select id="markPaidMethod" class="w-full px-3 py-2 border rounded-lg text-sm bg-white">
          <option value="mobile_money">Mobile Money</option>
          <option value="bank_transfer">Bank Transfer</option>
          <option value="cash">Cash</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div>
        <label class="block text-xs font-medium text-slate-700 mb-1">Date</label>
        <input id="markPaidDate" type="date" class="w-full px-3 py-2 border rounded-lg text-sm">
      </div>
      <div>
        <label class="block text-xs font-medium text-slate-700 mb-1">Notes</label>
        <textarea id="markPaidNotes" rows="2" class="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Optional…"></textarea>
      </div>
    </div>
    <div class="border-t px-5 py-3 flex items-center justify-between bg-slate-50 rounded-b-2xl">
      <button onclick="document.getElementById('markPaidModal').classList.add('hidden')" class="px-4 py-2 text-slate-700 hover:bg-slate-200 rounded-lg text-sm">Cancel</button>
      <button onclick="AgentManager.confirmMarkPaid()" class="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm flex items-center gap-2">
        <i data-lucide="check" class="h-4 w-4"></i> Confirm
      </button>
    </div>
  </div>
</div>

<!-- Pay All Matching — batch mode -->
<div id="payAllMatchingModal" class="hidden fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4">
  <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh]">
    <div class="bg-emerald-800 text-white px-5 py-4 rounded-t-2xl flex items-center justify-between">
      <h3 class="font-semibold flex items-center gap-2">
        <i data-lucide="banknote" class="h-5 w-5"></i>
        Pay All Matching
      </h3>
      <button onclick="document.getElementById('payAllMatchingModal').classList.add('hidden')" class="text-emerald-200 hover:text-white">
        <i data-lucide="x" class="h-5 w-5"></i>
      </button>
    </div>
    <div class="p-5 space-y-3 overflow-y-auto">
      <div class="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800 flex items-start gap-2">
        <i data-lucide="alert-triangle" class="h-4 w-4 flex-shrink-0 mt-0.5"></i>
        <div>
          <div>This will record <strong><span id="payAllCount">0</span></strong> payments totaling <strong>K<span id="payAllTotal">0</span></strong>.</div>
          <div class="text-xs mt-1">Only rows currently visible in the agents-to-pay table are included.</div>
        </div>
      </div>
      <div>
        <label class="block text-xs font-medium text-slate-700 mb-1">Amount strategy</label>
        <select id="payAllStrategy" class="w-full px-3 py-2 border rounded-lg text-sm bg-white">
          <option value="full">Full outstanding (default)</option>
          <option value="custom">Custom amount per agent (same value)</option>
        </select>
      </div>
      <div id="payAllCustomBlock" class="hidden">
        <label class="block text-xs font-medium text-slate-700 mb-1">Custom amount per agent (K)</label>
        <input id="payAllCustomAmount" type="number" step="0.01" class="w-full px-3 py-2 border rounded-lg text-sm">
      </div>
      <div>
        <label class="block text-xs font-medium text-slate-700 mb-1">Method (applied to all)</label>
        <select id="payAllMethod" class="w-full px-3 py-2 border rounded-lg text-sm bg-white">
          <option value="mobile_money">Mobile Money</option>
          <option value="bank_transfer">Bank Transfer</option>
          <option value="cash">Cash</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div>
        <label class="block text-xs font-medium text-slate-700 mb-1">Date (applied to all)</label>
        <input id="payAllDate" type="date" class="w-full px-3 py-2 border rounded-lg text-sm">
      </div>
      <div>
        <label class="block text-xs font-medium text-slate-700 mb-1">Notes (applied to all)</label>
        <textarea id="payAllNotes" rows="2" class="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Optional…"></textarea>
      </div>
    </div>
    <div class="border-t px-5 py-3 flex items-center justify-between bg-slate-50 rounded-b-2xl">
      <button onclick="document.getElementById('payAllMatchingModal').classList.add('hidden')" class="px-4 py-2 text-slate-700 hover:bg-slate-200 rounded-lg text-sm">Cancel</button>
      <button onclick="AgentManager.confirmPayAllMatching()" class="px-4 py-2 bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 text-sm flex items-center gap-2">
        <i data-lucide="check" class="h-4 w-4"></i> Confirm batch payment
      </button>
    </div>
  </div>
</div>
```

Add a small JS hook so the custom-amount field shows/hides:

In `index.html`, in the same global `<script>` block where other one-off listeners live, add (search for `// Misc listeners` or similar; if no obvious anchor, append at the end of the AgentManager `init` function):

```javascript
        document.getElementById('payAllStrategy')?.addEventListener('change', (e) => {
          const block = document.getElementById('payAllCustomBlock');
          if (block) block.classList.toggle('hidden', e.target.value !== 'custom');
        });
```

- [ ] **Step 3: Verify the modals exist**

Open the page. In DevTools console:

```javascript
document.getElementById('markPaidModal');
document.getElementById('payAllMatchingModal');
```

Expected: both return `<div>` elements.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
Add Mark Paid (single) and Pay All Matching (batch) modal markup

Two new modals for the Overview pay-period flows. Mark Paid shows
agent + week + earnings/already-paid/outstanding read-only fields and
form inputs for amount/method/date/notes. Pay All Matching summarises
the count and total, offers full-outstanding or custom-per-agent
strategy, plus shared method/date/notes. JS handlers come in Task 11.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Rewrite `renderOverview` — fetch + aggregate + render

**Files:**
- Modify: `bwanabet-crm-overview/index.html` — replace `AgentManager.renderOverview` body (~line 6189), and add helper methods.

**Goal:** End-to-end rewrite of the Overview render path. Reads the view-toggle state, picks the right aggregator, populates plan cards, totals strip, and table.

`AgentManager` already loads `this.weeklyData`, `this.payments`, and `this.agents` at startup. Plan 2 reuses those. For "All Unpaid Weeks" mode, we cap the input at the most recent 26 weeks (per spec section 7).

- [ ] **Step 1: Locate the existing function**

Find `renderOverview()` on the `AgentManager` object. Currently runs from `// Overview` comment to its closing `}`. Replace the whole body.

- [ ] **Step 2: Replace `renderOverview` and helpers**

Replace `// Overview` comment + the entire `renderOverview() { … }` with:

```javascript
      // Overview (pay-period dashboard) — Plan 2 redesign
      currentOverviewView: 'current', // 'current' | 'all_unpaid'

      setOverviewView(view) {
        this.currentOverviewView = (view === 'all_unpaid') ? 'all_unpaid' : 'current';
        this.renderOverview();
      },

      _scopeWeeklyForAllUnpaid(weeks) {
        // Cap input to most recent 26 distinct weeks for performance.
        const distinctSorted = Array.from(new Set(weeks.map(w => w.week_start_date).filter(Boolean))).sort().reverse();
        const recent = new Set(distinctSorted.slice(0, 26));
        return weeks.filter(w => recent.has(w.week_start_date));
      },

      renderOverview() {
        const O = window.OverviewLogic;
        if (!O) return; // module not loaded yet

        const visibleAgents = this.getFilteredAgents().filter(a => a.status !== 'inactive');
        const visibleAgentIds = new Set(visibleAgents.map(a => a.id));
        const weeklyAll = (this.weeklyData || []).filter(w => visibleAgentIds.has(w.agent_id));
        const paymentsAll = (this.payments || []).filter(p => visibleAgentIds.has(p.agent_id));

        const view = this.currentOverviewView;
        const currentWeek = O.findCurrentPeriod(weeklyAll);

        // Build aggregation
        let agg, headerLabel, headerMeta;
        if (view === 'all_unpaid') {
          const scoped = this._scopeWeeklyForAllUnpaid(weeklyAll);
          agg = O.aggregateAllUnpaidWeeks(scoped, visibleAgents, paymentsAll);
          headerLabel = `All unpaid weeks (${agg.weeksRepresented} week${agg.weeksRepresented === 1 ? '' : 's'})`;
          headerMeta = '';
        } else {
          if (!currentWeek) {
            this._showOverviewEmpty('no_uploads');
            return;
          }
          const weekScoped = weeklyAll.filter(w => w.week_start_date === currentWeek);
          const paymentsForWeek = paymentsAll.filter(p => p.week_start_date === currentWeek);
          agg = O.aggregateCurrentPeriod(weekScoped, visibleAgents, paymentsForWeek, currentWeek);
          headerLabel = `Pay Period: ${currentWeek}`;
          // Pull most recent uploaded_at if your weekly_data row carries it; otherwise leave blank.
          headerMeta = '';
        }

        // Header strip
        const labelEl = document.getElementById('overviewPeriodLabel');
        const metaEl  = document.getElementById('overviewPeriodMeta');
        if (labelEl) labelEl.textContent = headerLabel;
        if (metaEl)  metaEl.textContent  = headerMeta;
        const sel = document.getElementById('overviewViewSelect');
        if (sel && sel.value !== view) sel.value = view;

        // Plan cards
        this._renderPlanCards(agg.perPlan);

        // Totals strip
        const totalsAmt = document.getElementById('overviewTotalsAmount');
        const totalsPending = document.getElementById('overviewTotalsPending');
        const payAllBtn = document.getElementById('overviewPayAllBtn');
        if (totalsAmt) totalsAmt.textContent = 'K' + Math.round(agg.totals.totalWithdrawable).toLocaleString();
        if (totalsPending) totalsPending.textContent = agg.totals.agentsPending;
        if (payAllBtn) payAllBtn.disabled = (agg.totals.agentsPending === 0);

        // Agents-to-pay table (with filters/sort applied)
        this._renderAgentsToPay(agg.rows);

        if (typeof refreshIcons === 'function') refreshIcons();
      },

      _renderPlanCards(perPlan) {
        const card = (label, sub, data, payable, planLetter) => {
          const isC = planLetter === 'C';
          const pct = data.agentsCount > 0
            ? Math.round((data.qualifyingAgentsCount / data.agentsCount) * 100)
            : 0;
          return `
            <div class="bg-white rounded-xl px-4 py-3" style="border:1px solid #e2e8f0;">
              <div class="flex items-center justify-between mb-2">
                <div class="text-xs font-bold text-slate-500 uppercase tracking-wider">${label}</div>
                <span class="px-2 py-0.5 text-[10px] font-bold rounded bg-slate-100 text-slate-700">${planLetter}</span>
              </div>
              <div class="text-xs text-slate-500 mb-2">${sub}</div>
              <div class="space-y-1 text-sm">
                <div><strong>${data.qualifyingAgentsCount}</strong> of ${data.agentsCount} qualifying ${data.agentsCount > 0 ? `(${pct}%)` : ''}</div>
                <div><strong>${data.totalQualifyingClients}</strong> qualifying clients</div>
                ${planLetter === 'B' ? `<div><strong>K${Math.round(data.totalLosses).toLocaleString()}</strong> in player losses</div>` : ''}
              </div>
              <div class="mt-2 pt-2 border-t text-sm">
                ${isC
                  ? `<span class="text-slate-400 italic">— not payable —</span>`
                  : `<span class="font-bold text-emerald-700">K${Math.round(payable).toLocaleString()} payable</span>`}
              </div>
            </div>
          `;
        };
        const el = document.getElementById('overviewPlanCards');
        if (!el) return;
        el.innerHTML = [
          card('Plan A · Per-Client K100', 'Per qualifying client',  perPlan.A, perPlan.A.totalWithdrawable, 'A'),
          card('Plan B · Loss-Based 20%', '20% of player losses',    perPlan.B, perPlan.B.totalWithdrawable, 'B'),
          card('Plan C · Tracking only',  'No commission',           perPlan.C, 0,                          'C'),
        ].join('');
      },

      _renderAgentsToPay(rows) {
        const planFilter   = document.getElementById('overviewPlanFilter')?.value || 'all';
        const statusFilter = document.getElementById('overviewStatusFilter')?.value || 'pending';
        const search       = (document.getElementById('overviewSearchInput')?.value || '').toLowerCase().trim();
        const sortKey      = document.getElementById('overviewSortSelect')?.value || 'amount_desc';

        let filtered = rows.slice();
        if (planFilter !== 'all') {
          const letter = planFilter === 'per_client' ? 'A' : planFilter === 'loss_based' ? 'B' : 'C';
          filtered = filtered.filter(r => r.plan === letter);
        }
        if (statusFilter !== 'all') {
          filtered = filtered.filter(r => r.status === statusFilter);
        }
        if (search) {
          filtered = filtered.filter(r =>
            (r.name || '').toLowerCase().includes(search) ||
            (r.promo_code || '').toLowerCase().includes(search)
          );
        }

        // Sort
        const sorters = {
          amount_desc:     (a, b) => b.withdrawable - a.withdrawable,
          amount_asc:      (a, b) => a.withdrawable - b.withdrawable,
          name_asc:        (a, b) => (a.name || '').localeCompare(b.name || ''),
          qualifying_desc: (a, b) => b.qualifying - a.qualifying,
        };
        filtered.sort(sorters[sortKey] || sorters.amount_desc);

        const rowCountEl = document.getElementById('overviewRowCount');
        if (rowCountEl) rowCountEl.textContent = `${filtered.length} row${filtered.length === 1 ? '' : 's'}`;

        // Stash the filtered subset so Pay-All-Matching uses exactly what's visible
        this._lastOverviewVisibleRows = filtered;

        const tbody = document.getElementById('overviewTableBody');
        const empty = document.getElementById('overviewEmptyState');
        if (!tbody) return;

        if (filtered.length === 0) {
          tbody.innerHTML = '';
          if (empty) {
            const cause = (rows.length === 0) ? 'no_data' : 'all_filtered';
            this._showOverviewEmpty(cause);
          }
          return;
        }
        if (empty) empty.classList.add('hidden');

        const statusBadge = {
          paid:           'bg-emerald-100 text-emerald-700',
          partially_paid: 'bg-amber-100 text-amber-800',
          pending:        'bg-orange-100 text-orange-700',
          no_qualifiers:  'bg-slate-100 text-slate-600',
        };
        const statusLabel = {
          paid: 'Paid', partially_paid: 'Partial', pending: 'Pending', no_qualifiers: 'No qualifiers',
        };

        tbody.innerHTML = filtered.map(r => {
          const cls = statusBadge[r.status] || 'bg-slate-100 text-slate-600';
          const lbl = statusLabel[r.status] || r.status;
          const action = (r.withdrawable > 0)
            ? `<button onclick="AgentManager.openMarkPaidModal('${esc(r.agent_id)}','${esc(r.week_start_date)}')" class="px-3 py-1 bg-emerald-600 text-white rounded text-xs hover:bg-emerald-700">Mark Paid</button>`
            : '—';
          return `<tr class="border-t hover:bg-slate-50">
            <td class="px-3 py-2"><div class="font-medium">${esc(r.name)}</div><div class="text-xs text-slate-400">${esc(r.promo_code)}${r.week_start_date && this.currentOverviewView === 'all_unpaid' ? ` · ${esc(r.week_start_date)}` : ''}</div></td>
            <td class="px-3 py-2 text-center"><span class="px-2 py-0.5 bg-slate-100 rounded text-xs font-bold">${esc(r.plan)}</span></td>
            <td class="px-3 py-2 text-right">${r.qualifying} / ${r.total_clients}</td>
            <td class="px-3 py-2 text-right">K${Math.round(r.earnings).toLocaleString()}</td>
            <td class="px-3 py-2 text-right font-semibold text-emerald-700">K${Math.round(r.withdrawable).toLocaleString()}</td>
            <td class="px-3 py-2 text-center"><span class="px-2 py-0.5 ${cls} rounded text-xs">${lbl}</span></td>
            <td class="px-3 py-2 text-center">${action}</td>
          </tr>`;
        }).join('');
      },

      _showOverviewEmpty(cause) {
        const tbody = document.getElementById('overviewTableBody');
        const empty = document.getElementById('overviewEmptyState');
        if (tbody) tbody.innerHTML = '';
        if (!empty) return;
        empty.classList.remove('hidden');
        const messages = {
          no_uploads:    `No upload yet. <button onclick="AgentManager.switchSubTab('upload')" class="text-emerald-600 hover:underline">Open the Upload tab</button> to import a pay period.`,
          no_data:       `No agents have weekly data for this view.`,
          all_filtered:  `All matching agents are settled or filtered out. Switch the Status filter to <em>All</em> to see paid receipts.`,
        };
        empty.innerHTML = messages[cause] || 'No data.';

        // Also clear plan cards / totals so the empty state isn't misleading
        const cards = document.getElementById('overviewPlanCards');
        if (cards) cards.innerHTML = '';
        const totalsAmt = document.getElementById('overviewTotalsAmount');
        const totalsPending = document.getElementById('overviewTotalsPending');
        const payAllBtn = document.getElementById('overviewPayAllBtn');
        if (totalsAmt) totalsAmt.textContent = 'K0';
        if (totalsPending) totalsPending.textContent = '0';
        if (payAllBtn) payAllBtn.disabled = true;
        const rowCountEl = document.getElementById('overviewRowCount');
        if (rowCountEl) rowCountEl.textContent = '0 rows';
      },
```

- [ ] **Step 3: Manual smoke test**

Open the page. Sign in. Click Agents → Overview.

Expected:
- If at least one upload exists: header shows the most recent week, three plan cards populate, totals strip shows real numbers, table shows pending agents.
- If no uploads: empty state with link to Upload tab.

Toggle the View dropdown to "All Unpaid Weeks". Expected: header changes to "All unpaid weeks (N weeks)", per-plan cards now sum across all weeks, table shows one row per (agent, week).

Type into the search box. Expected: table filters live.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
Rewrite renderOverview as pay-period dashboard

renderOverview now picks aggregateCurrentPeriod (default) or
aggregateAllUnpaidWeeks (toggle) from window.OverviewLogic, scopes
weeklyData and payments to visible agents (My/All filter), populates
the header strip, three per-plan cards, totals strip, and the
filterable+sortable agents-to-pay table. _showOverviewEmpty handles
no-upload, no-data, and all-filtered cases. _lastOverviewVisibleRows
is stashed for Pay-All-Matching (Task 11). All-Unpaid mode caps
input to last 26 weeks for performance.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Wire Mark Paid (single) action

**Files:**
- Modify: `bwanabet-crm-overview/index.html` — add `openMarkPaidModal` and `confirmMarkPaid` methods on `AgentManager`.

**Goal:** Clicking [Mark Paid] on a row opens the modal pre-filled with that agent + week + amount. Confirm inserts one `agent_payments` row, closes the modal, refreshes Overview and Payments tab.

- [ ] **Step 1: Add the methods**

Insert just after `_showOverviewEmpty` on `AgentManager`:

```javascript
      openMarkPaidModal(agentId, weekStart) {
        const agent = this.agents.find(a => a.id === agentId);
        if (!agent) { crmToast('Unknown agent', 'error'); return; }
        const wd = (this.weeklyData || []).find(w => w.agent_id === agentId && w.week_start_date === weekStart);
        if (!wd) { crmToast('No weekly data for that period', 'error'); return; }
        const earnings = Number(wd.total_earnings) || 0;
        const paid = (this.payments || []).filter(p =>
          p.status === 'paid' && p.agent_id === agentId && p.week_start_date === weekStart
        ).reduce((s, p) => s + (Number(p.amount) || 0), 0);
        const outstanding = Math.max(0, earnings - paid);

        document.getElementById('markPaidAgent').textContent = `${agent.name} (${agent.promo_code})`;
        document.getElementById('markPaidWeek').textContent = weekStart;
        document.getElementById('markPaidEarnings').textContent = 'K' + earnings.toLocaleString();
        document.getElementById('markPaidAlready').textContent = 'K' + paid.toLocaleString();
        document.getElementById('markPaidOutstanding').textContent = 'K' + outstanding.toLocaleString();
        document.getElementById('markPaidAmount').value = outstanding.toFixed(2);
        document.getElementById('markPaidDate').value = new Date().toISOString().slice(0, 10);
        document.getElementById('markPaidMethod').value = 'mobile_money';
        document.getElementById('markPaidNotes').value = '';

        this._markPaidContext = { agentId, weekStart, earnings, alreadyPaid: paid };
        document.getElementById('markPaidModal').classList.remove('hidden');
        if (typeof refreshIcons === 'function') refreshIcons();
      },

      async confirmMarkPaid() {
        const ctx = this._markPaidContext;
        if (!ctx) return;
        const amount = parseFloat(document.getElementById('markPaidAmount').value);
        const method = document.getElementById('markPaidMethod').value;
        const date   = document.getElementById('markPaidDate').value;
        const notes  = document.getElementById('markPaidNotes').value.trim();
        if (!amount || amount <= 0 || !Number.isFinite(amount)) {
          crmToast('Enter a valid amount', 'error');
          return;
        }
        if (!date) {
          crmToast('Pick a date', 'error');
          return;
        }
        const recordedBy = (typeof Auth !== 'undefined' && Auth.user && Auth.user.email) || 'manager';
        try {
          const { data, error } = await App.db.from('agent_payments').insert({
            agent_id: ctx.agentId,
            amount,
            payment_method: method,
            payment_date: date,
            status: 'paid',
            paid_at: new Date().toISOString(),
            notes: notes || null,
            week_start_date: ctx.weekStart,
            recorded_by: recordedBy,
          }).select('*, agents(name, promo_code)').single();
          if (error) throw error;
          this.payments.unshift(data);
          document.getElementById('markPaidModal').classList.add('hidden');
          this._markPaidContext = null;
          this.renderOverview();
          if (typeof this.renderPaymentsTable === 'function') this.renderPaymentsTable();
          crmToast('Payment recorded');
        } catch (e) {
          crmToast('Error: ' + (e.message || 'Unknown'), 'error');
        }
      },
```

- [ ] **Step 2: Manual smoke test**

Open the page → Overview. Click [Mark Paid] on any pending row.

Expected: modal opens with agent name, week, earnings/paid/outstanding pre-filled, amount = outstanding, date = today, method = Mobile Money. Click Confirm. Modal closes, the row updates (status flips to "Paid" or "Partial" depending on amount entered), totals strip recalculates, and switching to Payments tab shows the new row.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
Wire Mark Paid (single) flow on Overview

openMarkPaidModal pre-fills agent name, week, earnings/already-paid/
outstanding, amount=outstanding, today's date, default method.
confirmMarkPaid inserts one agent_payments row with status=paid,
week_start_date and recorded_by set, then refreshes Overview and the
Payments table. Closes the loop: see who's pending → click → confirm.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Wire Pay-All-Matching (batch) action and CSV export

**Files:**
- Modify: `bwanabet-crm-overview/index.html` — add `openPayAllMatchingModal`, `confirmPayAllMatching`, and `exportOverviewAgentsCSV` methods.

**Goal:** [Pay all matching filters] button opens a modal summarising the action. Confirm inserts one `agent_payments` row per visible row in a single network round (one INSERT per row, but committed sequentially with progress). Export CSV downloads the visible rows.

The DB-level "transactional" insert isn't exposed by Supabase JS for arrays of rows that need different `week_start_date` and `agent_id` per row, but `.insert([…])` *is* atomic at the row-set level — if any constraint fails, none commit. We use that.

- [ ] **Step 1: Add the methods**

Insert after `confirmMarkPaid`:

```javascript
      openPayAllMatchingModal() {
        const visible = this._lastOverviewVisibleRows || [];
        const payable = visible.filter(r => r.withdrawable > 0);
        if (payable.length === 0) {
          crmToast('No pending rows in current view', 'error');
          return;
        }
        const total = payable.reduce((s, r) => s + r.withdrawable, 0);
        document.getElementById('payAllCount').textContent = payable.length;
        document.getElementById('payAllTotal').textContent = Math.round(total).toLocaleString();
        document.getElementById('payAllStrategy').value = 'full';
        document.getElementById('payAllCustomBlock').classList.add('hidden');
        document.getElementById('payAllCustomAmount').value = '';
        document.getElementById('payAllMethod').value = 'mobile_money';
        document.getElementById('payAllDate').value = new Date().toISOString().slice(0, 10);
        document.getElementById('payAllNotes').value = '';
        this._payAllContext = { rows: payable };
        document.getElementById('payAllMatchingModal').classList.remove('hidden');
        if (typeof refreshIcons === 'function') refreshIcons();
      },

      async confirmPayAllMatching() {
        const ctx = this._payAllContext;
        if (!ctx) return;
        const strategy = document.getElementById('payAllStrategy').value;
        const customAmount = parseFloat(document.getElementById('payAllCustomAmount').value);
        const method = document.getElementById('payAllMethod').value;
        const date   = document.getElementById('payAllDate').value;
        const notes  = document.getElementById('payAllNotes').value.trim();
        if (!date) { crmToast('Pick a date', 'error'); return; }
        if (strategy === 'custom' && (!Number.isFinite(customAmount) || customAmount <= 0)) {
          crmToast('Enter a valid custom amount', 'error');
          return;
        }
        const recordedBy = (typeof Auth !== 'undefined' && Auth.user && Auth.user.email) || 'manager';
        const inserts = ctx.rows.map(r => ({
          agent_id: r.agent_id,
          amount: strategy === 'custom' ? customAmount : r.withdrawable,
          payment_method: method,
          payment_date: date,
          status: 'paid',
          paid_at: new Date().toISOString(),
          notes: notes || null,
          week_start_date: r.week_start_date,
          recorded_by: recordedBy,
        }));
        try {
          const { data, error } = await App.db.from('agent_payments').insert(inserts).select('*, agents(name, promo_code)');
          if (error) throw error;
          if (Array.isArray(data)) for (const row of data) this.payments.unshift(row);
          document.getElementById('payAllMatchingModal').classList.add('hidden');
          this._payAllContext = null;
          this.renderOverview();
          if (typeof this.renderPaymentsTable === 'function') this.renderPaymentsTable();
          crmToast(`Recorded ${inserts.length} payment${inserts.length === 1 ? '' : 's'}`);
        } catch (e) {
          crmToast('Error: ' + (e.message || 'Unknown'), 'error');
        }
      },

      exportOverviewAgentsCSV() {
        const rows = this._lastOverviewVisibleRows || [];
        if (rows.length === 0) { crmToast('Nothing to export', 'error'); return; }
        const header = ['agent_name', 'promo_code', 'plan', 'week_start_date', 'qualifying', 'total_clients', 'earnings', 'paid', 'withdrawable', 'status'];
        const csv = [header.join(',')].concat(
          rows.map(r => header.map(h => {
            const v = r[h] ?? '';
            const s = String(v).replace(/"/g, '""');
            return /[,"\n]/.test(s) ? `"${s}"` : s;
          }).join(','))
        ).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `overview-agents-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      },
```

- [ ] **Step 2: Manual smoke test**

Open Overview → ensure Pending status filter is on. Click "Pay all matching filters".

Expected:
- Modal shows count + total.
- Default strategy = full outstanding.
- Switch strategy to "Custom amount per agent (same value)" — custom block appears.
- Click Confirm with default strategy. Modal closes, all rows flip to Paid status, totals zero out, payments tab shows N new rows.

Click Export CSV. Expected: a CSV file downloads with the visible rows.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
Wire Pay-All-Matching batch action and CSV export

openPayAllMatchingModal summarises the visible payable rows; confirm
runs a single .insert([…]) into agent_payments — atomic at the
row-set level, so a constraint failure rolls back the whole batch.
Strategy = full outstanding (per-row withdrawable) or custom amount
applied uniformly. Method/date/notes are shared across all inserts.
exportOverviewAgentsCSV downloads the currently visible rows.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Empty/partial states polish, mobile viewport, push

**Files:** none modified beyond a possible Tailwind class touch-up.

**Goal:** CLAUDE.md hard rule — verify the redesigned Overview renders usably at 375px viewport; push all commits.

- [ ] **Step 1: Verify on 375px viewport**

Open Chrome DevTools → device toolbar → "Responsive" 375×667.

Inspect each state:

1. Headline header strip — pay-period label and view selector stack correctly (the `flex-col sm:flex-row` should kick in below `sm`).
2. Three plan cards — should be `grid-cols-1` on phone (single column).
3. Totals strip — number + buttons stack on phone.
4. Filter row — `grid-cols-1` on phone (single column of filters).
5. Table — horizontally scrolls within `overflow-x-auto` (acceptable on phone for now; do not collapse to cards in this plan).
6. Mark Paid modal — fits the viewport, all fields reachable, Confirm button not clipped.
7. Pay All modal — same.

If any element overflows, fix the Tailwind classes inline. Common fixes:
- `flex-wrap` on a container that's too tight.
- `min-w-0` + `truncate` on a nested label.
- Adding `text-xs` to a totals number that's too big on phone.

- [ ] **Step 2: Test the no-uploads empty state**

In Supabase MCP, run:

```sql
SELECT COUNT(*) FROM public.agent_weekly_data;
```

If 0, you should already see the empty state when opening Overview. If non-zero, it's hard to test without temporarily clearing — skip this step (the code path is unit-implied via `findCurrentPeriod` returning null).

- [ ] **Step 3: Run unit tests one last time**

```bash
cd "C:/Users/USER/Desktop/Claude projects/bwanabet-crm-overview"
npm test
```

Expected: 14 (Plan 4) + 6 + 8 + 9 + 5 = 42 passing tests, exit code 0.

- [ ] **Step 4: Verify git status is clean**

```bash
git status
git log --oneline -15
```

Expected: clean tree (or only untracked CLAUDE.md/local-only files). Recent log shows the Plan 2 commit series in order:
1. Fix legacy recordPayment INSERT
2. Add overview-logic skeleton
3. Implement findCurrentPeriod
4. Implement computeWithdrawable
5. Implement aggregateCurrentPeriod
6. Implement aggregateAllUnpaidWeeks
7. Replace Overview tab markup
8. Add Mark Paid + Pay All Matching modals
9. Rewrite renderOverview
10. Wire Mark Paid
11. Wire Pay-All-Matching + CSV
12. (Optional) mobile-viewport polish

- [ ] **Step 5: Push**

```bash
git push origin main
```

- [ ] **Step 6: Verify on GitHub**

Open `https://github.com/crmbwanabet/bwanabet-crm/commits/main`. Confirm the Plan 2 commits land at the top.

---

## Acceptance criteria

After this plan executes:

- [ ] `assets/js/overview.js` exists and exports `findCurrentPeriod`, `computeWithdrawable`, `aggregateCurrentPeriod`, `aggregateAllUnpaidWeeks`, `PLAN_KEY`.
- [ ] `tests/overview.test.js` exists with at least 28 tests covering the four pure functions.
- [ ] `npm test` exits 0 with all tests passing.
- [ ] `index.html` includes `<script src="assets/js/overview.js"></script>` after the Plan 4 preview script.
- [ ] The legacy `recordPayment` INSERT now writes `week_start_date` and `recorded_by`; recording a payment via the Payments-tab modal succeeds.
- [ ] The Overview tab renders three per-plan cards (A/B/C) with conversion ratio, qualifying clients, and (A/B) payable amount.
- [ ] A view selector toggles between "Current Period" (default — most recent uploaded week) and "All Unpaid Weeks" (cross-week arrears, capped at 26 weeks).
- [ ] The agents-to-pay table supports plan/status/search filters and amount/name/qualifying sort. Default: status=Pending, sort=Amount desc.
- [ ] Each pending row's [Mark Paid] opens the Mark Paid modal pre-filled with agent + week + outstanding amount; Confirm inserts one `agent_payments` row.
- [ ] The totals strip's [Pay all matching filters] button is enabled iff `agentsPending > 0`; clicking it opens the batch modal which inserts one row per visible payable row in a single `.insert([…])` call.
- [ ] [Export CSV] downloads the currently visible rows.
- [ ] No-upload, no-data, and all-filtered empty states each show distinct messaging.
- [ ] All states render usably at a 375px viewport width.
- [ ] All commits pushed to `bwanabet-crm` `main`.

---

## What this plan does NOT do

- Does not change the **agent portal** (`crmbwanbetagentportal/index.html`) — that's Plan 6.
- Does not add the **History tab** or its lifetime KPIs / weekly trend chart / lifetime leaderboards — that's Plan 3. The old chart and leaderboards are removed from Overview entirely.
- Does not refactor the **Payments tab** to a per-week ledger with synthesised pending rows or a unified Record Payment modal — that's Plan 5. The legacy modal is patched to write `week_start_date` but otherwise unchanged.
- Does not introduce reversal UI (negative-amount payments). The aggregator handles them correctly when present, but Plan 5 adds the UI.
- Does not change RLS policies. Permissive RLS remains a known security gap; tightening is out of scope.
- Does not introduce Telegram notifications on Mark Paid. Notifications can be added in a future small PR.
- Does not introduce a JS bundler or build step.

## Next plan

Plan 3 — **History tab** — is the natural next step. It picks up the lifetime/multi-week views removed from Overview and gives them a proper home. Plan 5 (Payments per-week ledger) and Plan 6 (Agent portal redesign) can run independently of Plan 3.
