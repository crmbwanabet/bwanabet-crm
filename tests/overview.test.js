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
