// preview.js — pure logic for the player-activity upload preview-and-confirm flow.
// No DOM, no Supabase, no globals. Functions take inputs, return data.
// Loaded into the browser as window.PreviewLogic and into Node tests as module.exports.

const PreviewLogic = (() => {
  // Business rules — single source of truth for commission math and float tolerances.
  const PLAN_A_RATE = 100;        // ZMW per qualifying client
  const PLAN_B_RATE = 0.20;       // 20% of losses
  const MATCH_TOLERANCE = 0.005;  // treat |paid - newEarnings| < half-ngwe as float match

  // Aggregates parsed rows into per-plan totals.
  // weeklyByAgent: array of { agent_id, plan, total_clients, qualifying_clients, total_losses, total_earnings }
  // Returns: { A: {...}, B: {...}, C: {...} } where each value is { agentsCount, qualifyingAgentsCount, totalClients, totalQualifyingClients, totalLosses, totalEarnings }
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

  // Computes per-player client loss using the GGR-style formula:
  //   loss = max(0, total_deposit − total_withdrawals − current_balance)
  // Returns 0 when any of the three inputs is null/undefined — under-counting is
  // safer than over-counting commission for Plan B.
  function deriveLoss(totalDeposit, totalWithdrawals, currentBalance) {
    if (totalDeposit == null || totalWithdrawals == null || currentBalance == null) return 0;
    const loss = Number(totalDeposit) - Number(totalWithdrawals) - Number(currentBalance);
    return loss > 0 ? loss : 0;
  }

  // Reads parsed CSV/XLSX rows + agent list + week start, computes:
  //   matched: array of { row, agent, qualifies, losses } whose agent_code resolves
  //   skipped: array of { row, reason } for unmatched / invalid rows
  //   weeklyByAgent: per-agent aggregated weekly summary (input to summarizePerPlan)
  //   perPlan: result of summarizePerPlan(weeklyByAgent)
  // Pure: no DB calls.
  function analyzeUpload(rows, agents, weekStartISO) {
    const codeIndex = new Map();
    for (const a of agents) {
      if (a.promo_code) codeIndex.set(String(a.promo_code).toUpperCase().trim(), a);
    }

    const matched = [];
    const skipped = [];
    const perAgent = new Map();
    const seen = new Set();  // tracks 'agent_id:user_id' to dedupe within this upload

    for (const row of rows) {
      const code = (row.agent_code == null ? '' : String(row.agent_code)).toUpperCase().trim();
      if (!code) {
        skipped.push({ row, reason: 'missing_agent_code' });
        continue;
      }
      // Bwanabet convention is 'A' + numeric (A100, A365). Spreadsheets often emit
      // bare numbers, so when the file gives us a numeric code, prefer the
      // 'A'-prefixed agent if one exists. Falls back to bare match.
      const isNumeric = /^\d+$/.test(code);
      const agent = isNumeric
        ? (codeIndex.get('A' + code) || codeIndex.get(code))
        : codeIndex.get(code);
      if (!agent) {
        skipped.push({ row, reason: 'unknown_agent_code' });
        continue;
      }

      const userId = row.user_id != null ? String(row.user_id) : '';
      const seenKey = agent.id + ' ' + userId;
      if (userId && seen.has(seenKey)) {
        // Already counted this player for this agent in this upload
        skipped.push({ row, reason: 'duplicate_user_id' });
        continue;
      }
      if (userId) seen.add(seenKey);

      const firstDeposit = Number(row.first_deposit) || 0;
      const sports = Number(row.sports_bet) || 0;
      const casino = Number(row.casino_bet) || 0;
      const losses = deriveLoss(row.total_deposit, row.total_withdrawals, row.current_balance);
      const qualifies = firstDeposit >= 100 && (sports >= 100 || casino >= 100);

      matched.push({ row, agent, qualifies, losses });

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

  // Compares newly-computed per-agent earnings against existing paid agent_payments rows
  // for the same week. Returns array of conflicts:
  //   { agent_id, agent_name, paid: number, newEarnings: number, status: 'match'|'underpaid'|'overpaid' }
  // Only rows where there's a paid payment AND a new earnings calc are returned (no-op cases skipped).
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
      if (paid === undefined) continue;
      const newEarnings = Number(wd.total_earnings) || 0;
      let status;
      if (Math.abs(paid - newEarnings) < MATCH_TOLERANCE) status = 'match';
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

  return { summarizePerPlan, analyzeUpload, detectReuploadConflicts };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PreviewLogic;
}
if (typeof window !== 'undefined') {
  window.PreviewLogic = PreviewLogic;
}
