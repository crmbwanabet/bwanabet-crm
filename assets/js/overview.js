// overview.js — pure logic for the manager Overview pay-period dashboard.
// No DOM, no Supabase, no globals. Functions take inputs, return data.
// Loaded into the browser as window.OverviewLogic and into Node tests as module.exports.

const OverviewLogic = (() => {
  const PLAN_KEY = { per_client: 'A', loss_based: 'B', nil: 'C' };

  // Returns the most recent week_start_date in weeklyData (ISO string),
  // or null if weeklyData is empty.
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
