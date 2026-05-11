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
  assert.equal(result.A.qualifyingAgentsCount, 2);
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

const { analyzeUpload } = require('../assets/js/preview.js');

const sampleAgents = [
  { id: 'agent-a', promo_code: 'A100', name: 'Alice', commission_plan: 'per_client' },
  { id: 'agent-b', promo_code: 'A200', name: 'Bob',   commission_plan: 'loss_based' },
  { id: 'agent-c', promo_code: 'A300', name: 'Carol', commission_plan: 'nil' },
];

test('analyzeUpload: matched and skipped row counts', () => {
  const rows = [
    { agent_code: 'A100', user_id: 'u1', first_deposit: 200, sports_bet: 200, casino_bet: 0, total_deposit: 50, total_withdrawals: 0, current_balance: 0 },
    { agent_code: 'A100', user_id: 'u2', first_deposit: 50,  sports_bet: 50,  casino_bet: 0, total_deposit: 10, total_withdrawals: 0, current_balance: 0 },
    { agent_code: 'XXX',  user_id: 'u3', first_deposit: 200, sports_bet: 200, casino_bet: 0, total_deposit: 50, total_withdrawals: 0, current_balance: 0 },
    { agent_code: '',     user_id: 'u4', first_deposit: 200, sports_bet: 200, casino_bet: 0, total_deposit: 50, total_withdrawals: 0, current_balance: 0 },
  ];
  const result = analyzeUpload(rows, sampleAgents, '2026-04-27');
  assert.equal(result.matched.length, 2);
  assert.equal(result.skipped.length, 2);
  assert.equal(result.skipped[0].reason, 'unknown_agent_code');
  assert.equal(result.skipped[1].reason, 'missing_agent_code');
});

test('analyzeUpload: Plan A qualifying logic — total_deposit ≥ 100 AND (sports + casino) ≥ 100', () => {
  // Plan A pays K100 per *active depositing player*: a player who deposited at least K100
  // in total during the period AND placed at least K100 of bets (sports + casino combined).
  // The BwanaBet weekly export has a 'First Deposit Amount' column too, but that's the size
  // of the first deposit transaction (often K2–K30) — not the right metric for this rule.
  const rows = [
    { agent_code: 'A100', user_id: 'u1', first_deposit: 5,   sports_bet: 100, casino_bet: 0,   total_deposit: 100, total_withdrawals: 0, current_balance: 0 }, // qualifies
    { agent_code: 'A100', user_id: 'u2', first_deposit: 200, sports_bet: 0,   casino_bet: 100, total_deposit: 500, total_withdrawals: 0, current_balance: 0 }, // qualifies
    { agent_code: 'A100', user_id: 'u3', first_deposit: 200, sports_bet: 50,  casino_bet: 50,  total_deposit: 200, total_withdrawals: 0, current_balance: 0 }, // qualifies (sum = 100)
    { agent_code: 'A100', user_id: 'u4', first_deposit: 200, sports_bet: 49,  casino_bet: 50,  total_deposit: 200, total_withdrawals: 0, current_balance: 0 }, // fails (bets sum = 99)
    { agent_code: 'A100', user_id: 'u5', first_deposit: 200, sports_bet: 200, casino_bet: 0,   total_deposit: 99,  total_withdrawals: 0, current_balance: 0 }, // fails (deposit < 100)
  ];
  const result = analyzeUpload(rows, sampleAgents, '2026-04-27');
  const aliceWeekly = result.weeklyByAgent.find(r => r.agent_id === 'agent-a');
  assert.equal(aliceWeekly.total_clients, 5);
  assert.equal(aliceWeekly.qualifying_clients, 3);
  assert.equal(aliceWeekly.total_earnings, 300);
});

test('analyzeUpload: Plan B earns 20% of losses regardless of qualifying', () => {
  const rows = [
    { agent_code: 'A200', user_id: 'u1', first_deposit: 50,  sports_bet: 50,  casino_bet: 0, total_deposit: 1000, total_withdrawals: 0, current_balance: 0 },
    { agent_code: 'A200', user_id: 'u2', first_deposit: 200, sports_bet: 200, casino_bet: 0, total_deposit: 500,  total_withdrawals: 0, current_balance: 0 },
  ];
  const result = analyzeUpload(rows, sampleAgents, '2026-04-27');
  const bobWeekly = result.weeklyByAgent.find(r => r.agent_id === 'agent-b');
  assert.equal(bobWeekly.total_clients, 2);
  assert.equal(bobWeekly.total_losses, 1500);
  assert.equal(bobWeekly.total_earnings, 300);
});

test('analyzeUpload: Plan C tracks clients, pays zero', () => {
  const rows = [
    { agent_code: 'A300', user_id: 'u1', first_deposit: 200, sports_bet: 200, casino_bet: 0, total_deposit: 100, total_withdrawals: 0, current_balance: 0 },
  ];
  const result = analyzeUpload(rows, sampleAgents, '2026-04-27');
  const carolWeekly = result.weeklyByAgent.find(r => r.agent_id === 'agent-c');
  assert.equal(carolWeekly.total_clients, 1);
  assert.equal(carolWeekly.total_earnings, 0);
});

test('analyzeUpload: perPlan summary is included', () => {
  const rows = [
    { agent_code: 'A100', user_id: 'u1', first_deposit: 200, sports_bet: 200, casino_bet: 0, total_deposit: 300, total_withdrawals: 0, current_balance: 0 },
  ];
  const result = analyzeUpload(rows, sampleAgents, '2026-04-27');
  assert.ok(result.perPlan);
  assert.equal(result.perPlan.A.qualifyingAgentsCount, 1);
  assert.equal(result.perPlan.A.totalEarnings, 100);
});

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
    { agent_id: 'agent-a', total_earnings: 400 },
    { agent_id: 'agent-b', total_earnings: 600 },
    { agent_id: 'agent-c', total_earnings: 200 },
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

test('analyzeUpload: duplicate user_id for same agent is deduplicated', () => {
  const rows = [
    { agent_code: 'A100', user_id: 'u1', first_deposit: 200, sports_bet: 200, casino_bet: 0, total_deposit: 500, total_withdrawals: 0, current_balance: 0 },
    { agent_code: 'A100', user_id: 'u1', first_deposit: 200, sports_bet: 200, casino_bet: 0, total_deposit: 500, total_withdrawals: 0, current_balance: 0 }, // duplicate
    { agent_code: 'A100', user_id: 'u2', first_deposit: 200, sports_bet: 200, casino_bet: 0, total_deposit: 300, total_withdrawals: 0, current_balance: 0 },
  ];
  const result = analyzeUpload(rows, sampleAgents, '2026-04-27');
  assert.equal(result.matched.length, 2);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, 'duplicate_user_id');
  const aliceWeekly = result.weeklyByAgent.find(r => r.agent_id === 'agent-a');
  assert.equal(aliceWeekly.total_clients, 2);
  assert.equal(aliceWeekly.qualifying_clients, 2);
  assert.equal(aliceWeekly.total_earnings, 200);
});

test('analyzeUpload: numeric agent_code resolves to "A"-prefixed agent', () => {
  // Spreadsheet exports agent codes as bare numbers (365). The DB stores them as A365.
  const rows = [
    { agent_code: 365, user_id: 'u1', first_deposit: 200, sports_bet: 200, casino_bet: 0, total_deposit: 0, total_withdrawals: 0, current_balance: 0 },
    { agent_code: '100', user_id: 'u2', first_deposit: 200, sports_bet: 200, casino_bet: 0, total_deposit: 0, total_withdrawals: 0, current_balance: 0 },
  ];
  const agents = [
    { id: 'agent-a', promo_code: 'A100', name: 'Alice', commission_plan: 'per_client' },
    { id: 'agent-b', promo_code: 'A365', name: 'Evaristo', commission_plan: 'per_client' },
  ];
  const result = analyzeUpload(rows, agents, '2026-04-27');
  assert.equal(result.matched.length, 2);
  assert.equal(result.skipped.length, 0);
  assert.equal(result.matched[0].agent.id, 'agent-b');
  assert.equal(result.matched[1].agent.id, 'agent-a');
});

test('analyzeUpload: numeric agent_code prefers "A"-prefixed when both bare and prefixed exist', () => {
  // The DB has both '365' (a stale/garbage agent) and 'A365' (the real agent).
  // The file's bare '365' should resolve to A365, not the bare 365 row.
  const rows = [
    { agent_code: 365, user_id: 'u1', first_deposit: 200, sports_bet: 200, casino_bet: 0, total_deposit: 0, total_withdrawals: 0, current_balance: 0 },
  ];
  const agents = [
    { id: 'garbage', promo_code: '365', name: '63', commission_plan: 'per_client' },
    { id: 'real',    promo_code: 'A365', name: 'Evaristo', commission_plan: 'per_client' },
  ];
  const result = analyzeUpload(rows, agents, '2026-04-27');
  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0].agent.id, 'real');
});

test('analyzeUpload: numeric agent_code falls back to bare match when no prefixed exists', () => {
  const rows = [
    { agent_code: '999', user_id: 'u1', first_deposit: 200, sports_bet: 200, casino_bet: 0, total_deposit: 0, total_withdrawals: 0, current_balance: 0 },
  ];
  const agents = [
    { id: 'only', promo_code: '999', name: 'OnlyBare', commission_plan: 'per_client' },
  ];
  const result = analyzeUpload(rows, agents, '2026-04-27');
  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0].agent.id, 'only');
});

test('analyzeUpload: derives client loss as deposit − withdrawals − balance', () => {
  const rows = [
    { agent_code: 'A200', user_id: 'u1', first_deposit: 100, sports_bet: 100, casino_bet: 0, total_deposit: 1000, total_withdrawals: 200, current_balance: 100 },
  ];
  const result = analyzeUpload(rows, sampleAgents, '2026-04-27');
  // Plan B agent — earns 20% of derived loss (1000 - 200 - 100 = 700) → 140
  const bobWeekly = result.weeklyByAgent.find(r => r.agent_id === 'agent-b');
  assert.equal(bobWeekly.total_losses, 700);
  assert.equal(bobWeekly.total_earnings, 140);
});

test('analyzeUpload: derived loss clamps to 0 when player won net', () => {
  // Player deposited 100, withdrew 500 (won money), and still has 200 in balance.
  // House lost on this player: deposit − (withdrawal + balance) = 100 - 700 = -600 → clamp to 0.
  const rows = [
    { agent_code: 'A200', user_id: 'u1', first_deposit: 100, sports_bet: 100, casino_bet: 0, total_deposit: 100, total_withdrawals: 500, current_balance: 200 },
  ];
  const result = analyzeUpload(rows, sampleAgents, '2026-04-27');
  const bobWeekly = result.weeklyByAgent.find(r => r.agent_id === 'agent-b');
  assert.equal(bobWeekly.total_losses, 0);
  assert.equal(bobWeekly.total_earnings, 0);
});

test('analyzeUpload: missing total_withdrawals or current_balance yields zero loss (safe default)', () => {
  // Old-format file lacks the new columns. Better to under-count than over-pay Plan B.
  const rows = [
    { agent_code: 'A200', user_id: 'u1', first_deposit: 100, sports_bet: 100, casino_bet: 0, total_deposit: 1000 /* no withdrawals/balance */ },
    { agent_code: 'A200', user_id: 'u2', first_deposit: 100, sports_bet: 100, casino_bet: 0, total_deposit: 1000, total_withdrawals: 200 /* no balance */ },
    { agent_code: 'A200', user_id: 'u3', first_deposit: 100, sports_bet: 100, casino_bet: 0, total_deposit: 1000, current_balance: 100 /* no withdrawals */ },
  ];
  const result = analyzeUpload(rows, sampleAgents, '2026-04-27');
  const bobWeekly = result.weeklyByAgent.find(r => r.agent_id === 'agent-b');
  assert.equal(bobWeekly.total_losses, 0);
  assert.equal(bobWeekly.total_earnings, 0);
});

test('analyzeUpload: matched entries include qualifies and losses', () => {
  // The confirm step writes per-player rows into agent_player_activity; the matched array carries
  // pre-computed qualifies + losses so confirm doesn't reapply the same business logic.
  const rows = [
    { agent_code: 'A100', user_id: 'u1', first_deposit: 200, sports_bet: 200, casino_bet: 0, total_deposit: 1000, total_withdrawals: 200, current_balance: 100 },
    { agent_code: 'A100', user_id: 'u2', first_deposit: 50, sports_bet: 50, casino_bet: 0, total_deposit: 100, total_withdrawals: 0, current_balance: 0 },
  ];
  const result = analyzeUpload(rows, sampleAgents, '2026-04-27');
  assert.equal(result.matched.length, 2);
  assert.equal(result.matched[0].qualifies, true);
  assert.equal(result.matched[0].losses, 700);
  assert.equal(result.matched[1].qualifies, false);
  assert.equal(result.matched[1].losses, 100);
});

test('analyzeUpload: agents with null promo_code are excluded from matching', () => {
  const agentsWithNull = [
    { id: 'agent-a', promo_code: 'A100', name: 'Alice', commission_plan: 'per_client' },
    { id: 'agent-null', promo_code: null, name: 'NoCode', commission_plan: 'per_client' },
  ];
  const rows = [
    { agent_code: '', user_id: 'u1', first_deposit: 200, sports_bet: 200, casino_bet: 0, total_deposit: 0, total_withdrawals: 0, current_balance: 0 },
    { agent_code: 'A100', user_id: 'u2', first_deposit: 200, sports_bet: 200, casino_bet: 0, total_deposit: 0, total_withdrawals: 0, current_balance: 0 },
  ];
  const result = analyzeUpload(rows, agentsWithNull, '2026-04-27');
  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0].agent.id, 'agent-a');
  // The empty-code row goes to skipped.missing_agent_code, never silently matches the null-code agent.
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, 'missing_agent_code');
});
