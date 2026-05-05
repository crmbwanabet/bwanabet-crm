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
