// preview.js — pure logic for the player-activity upload preview-and-confirm flow.
// No DOM, no Supabase, no globals. Functions take inputs, return data.
// Loaded into the browser as window.PreviewLogic and into Node tests as module.exports.

const PreviewLogic = (() => {
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
