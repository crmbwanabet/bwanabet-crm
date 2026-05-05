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

  return { findCurrentPeriod, computeWithdrawable, aggregateCurrentPeriod, aggregateAllUnpaidWeeks, PLAN_KEY };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = OverviewLogic;
}
if (typeof window !== 'undefined') {
  window.OverviewLogic = OverviewLogic;
}
