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
