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
