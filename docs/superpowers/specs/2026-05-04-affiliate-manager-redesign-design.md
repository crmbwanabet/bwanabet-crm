# Affiliate Manager Portal Redesign — Design Spec

**Date:** 2026-05-04
**Status:** Awaiting user review
**Scope:** Both repos — `bwanabet-crm` (manager portal) and `crmbwanbetagentportal` (agent portal)

## Summary

Replace the current lifetime-balance affiliate management dashboard with a **pay-period model** built around weekly CSV/Excel uploads. Each upload is a self-contained "envelope" of agent earnings; payments are tied to a specific week, not a lifetime running balance. The manager's daily question becomes "who do I owe this period?" rather than "what's everyone's running total?"

The redesign covers both portals:
- **Manager (CRM)** — new pay-period Overview, new History tab, upload flow with preview/confirm, Payments tab refactored to a per-week ledger.
- **Agent portal** — view-only display of withdrawable balance, current pay period detail, performance history with per-week payment status.

## Background

The current affiliate dashboard mixes "this week" and "lifetime" stats in one screen, has no link between payments and the week they settle, and the agent portal shows lifetime totals that aren't actionable for either party. The owner stated the priority metric for the manager is *"how many agents are registered, for plan A, how many agents have onboarded clients meeting the requirements"* — a per-period operational view that today's UI doesn't surface cleanly.

Existing pipeline already in place (preserved):
- Manager uploads CSV/Excel of weekly player activity → writes to `agent_weekly_data` (UPSERT keyed by `(agent_id, week_start_date)`) and `agent_player_activity` (per-player, UPSERT keyed by `(agent_id, user_id, week_start_date)`).
- Plan A qualifying rule: `deposit ≥ K100 AND (sports_bet ≥ K100 OR casino_bet ≥ K100)` → K100 per qualifying client.
- Plan B: 20% of player losses.
- Plan C: tracking only, no commission.
- Tiers (Bronze/Silver/Gold/Platinum) layer on top as activity bonuses.

What's missing today: payments aren't tied to weeks; agent portal shows lifetime totals only; manager Overview mixes operational and strategic views.

## Goals

1. Manager opens Overview and immediately sees what they owe for the just-uploaded period, broken down per plan.
2. New uploads automatically become the "current period" without manual selection.
3. Unpaid amounts from prior weeks remain visible and actionable (toggle on Overview, dedicated rows in History/Payments).
4. Agents see their withdrawable balance and per-week status without any "request" interaction — pure display.
5. Historical/lifetime views remain accessible but are out of the default operational flow.
6. Mobile-first: all new screens render usably on a 375px viewport.

## Non-goals

- Auto-import from upstream betting platform (uploads stay manual).
- Mobile money / bank API integration for actual payment dispatch.
- Push notifications to agents on payment received.
- Multi-currency (ZMW only).
- Agent-initiated withdrawal request flow (explicitly removed).
- Tier (Bronze/Silver/Gold/Platinum) restructure — existing logic preserved.
- Per-customer audit trail in agent portal.

## Architecture overview

```
                ┌──────────────────────────────┐
                │  Manager portal (CRM repo)   │
                │  - Overview (pay period)     │
                │  - History (lifetime)        │
                │  - Upload (preview+confirm)  │
                │  - Payments (per-week ledger)│
                └──────────────┬───────────────┘
                               │
                               ▼
                ┌──────────────────────────────┐
                │   Shared Supabase backend    │
                │   - agents                   │
                │   - agent_weekly_data        │
                │   - agent_player_activity    │
                │   - agent_payments  (NEW:    │
                │       week_start_date,       │
                │       recorded_by)           │
                │   - commission_tiers         │
                └──────────────┬───────────────┘
                               │
                               ▼
                ┌──────────────────────────────┐
                │ Agent portal (this repo)     │
                │ - Withdrawable + Period card │
                │ - Performance history table  │
                │ - Earnings trend / payments  │
                │ - Period leaderboard         │
                └──────────────────────────────┘
```

## 1 — Data model changes

### `agent_payments` — link to weeks; track who recorded

```sql
ALTER TABLE public.agent_payments
  ADD COLUMN week_start_date date NOT NULL DEFAULT '1970-01-01',
  ADD COLUMN recorded_by text;

CREATE INDEX idx_agent_payments_week ON public.agent_payments(week_start_date);
CREATE INDEX idx_agent_payments_agent_week ON public.agent_payments(agent_id, week_start_date);

-- After deploy (no rows have the sentinel default in production):
ALTER TABLE public.agent_payments ALTER COLUMN week_start_date DROP DEFAULT;
```

**No UNIQUE constraint** on `(agent_id, week_start_date)` — multiple payment rows per envelope are allowed to support partial payments and reversals (negative amounts).

`recorded_by` stores the manager identifier (CRM user email or id) who recorded the payment, for audit. Free-text initially; can be hardened to a UUID FK once user accounts are formalised.

### `agent_weekly_data` — record plan at import time

```sql
ALTER TABLE public.agent_weekly_data
  ADD COLUMN plan_at_import text;

UPDATE public.agent_weekly_data SET plan_at_import = (
  SELECT commission_plan FROM public.agents
  WHERE agents.id = agent_weekly_data.agent_id
);

ALTER TABLE public.agent_weekly_data
  ALTER COLUMN plan_at_import SET NOT NULL;
```

Captures the agent's plan at the moment of import so retroactive plan changes don't recalculate historical earnings. New rows: written by the upload handler from the agent's current `commission_plan`.

### `agents` — no change

`commission_plan` (`per_client` / `loss_based` / `nil`) stays the source of truth for current plan assignment.

### "Current pay period" — derived

```sql
SELECT MAX(week_start_date) FROM agent_weekly_data;
```

Computed each page load. No cached pointer column. If the table is empty, no current period → empty state shown.

### "Withdrawable" — derived

For any (agent, week):
```
withdrawable(a, w) = total_earnings(a, w)
                   − COALESCE(SUM(amount FOR all paid rows in (a, w)), 0)
```

Clamped to 0 in display (never shown as negative); overpaid cases are flagged separately.

For agent's total unpaid: sum the above across all weeks where it's > 0.

## 2 — Manager portal: Overview tab redesign

Pay-period focused dashboard. Replaces the current Overview entirely.

### Layout

```
Pay Period: 27 Apr – 3 May 2026   [uploaded 4 May 14:27]
Showing: My Agents (Steven Zulu) ▼   View: Current Period ▼

┌── PLAN A ─────────────┐ ┌── PLAN B ─────────────┐ ┌── PLAN C ─────────────┐
│ Per-Client · K100      │ │ Loss-Based · 20%       │ │ Nil · Tracking only    │
│                        │ │                        │ │                        │
│ 42 of 275 qualifying   │ │ 0 of 0 earning         │ │ 1 agent tracked        │
│ (15%)                  │ │                        │ │                        │
│ 87 qualifying clients  │ │ K0 in player losses    │ │ 0 clients onboarded    │
│ K8,700 payable         │ │ K0 payable             │ │ — not payable —        │
└────────────────────────┘ └────────────────────────┘ └────────────────────────┘

Total to pay out this period: K8,700  ·  42 agents pending
[Pay all matching filters ▾]   [Export CSV]

┌── Agents to pay (this period) ────────────────────────────────────────┐
│ Plan: All ▼  Status: Pending ▼  Search: ___  Sort: Amount desc ▼     │
├───────────────────────────────────────────────────────────────────────┤
│ Agent              Plan  Qualifying  Earnings  Status    Action       │
│ Evaristo Musonda   A     4           K400      Pending   [Mark Paid] │
│ ...                                                                   │
└───────────────────────────────────────────────────────────────────────┘
```

### Header strip

- **Pay period indicator** — read-only, reflects `MAX(week_start_date)`.
- **My Agents / All Agents** filter — existing recruiter filter, kept.
- **View toggle (NEW)** — `Current Period` (default) / `All Unpaid Weeks`. When set to All Unpaid Weeks, every card and the table aggregate across every week with `withdrawable > 0`; period indicator shows "All unpaid weeks (N weeks)" instead of a date.

### Per-plan cards

Three cards driving Plan A, B, C. Numbers are scoped to the active toggle (current period or all-unpaid).

- Plan A surfaces the **conversion ratio** (`X of N agents qualifying, X%`) prominently — that's the program-health signal the owner identified as most important.
- Plan B shows agents earning + total losses + payable amount.
- Plan C is non-actionable (no payable amount), shows tracking counts only.

### Totals strip

Single sum of per-plan payables. Two actions:
- **Pay all matching filters** — batch action; loops the rows currently matching the table filters and creates `agent_payments` rows in a single transaction. One prompt for date/method/notes/amount-strategy ("Full outstanding" / "Custom amount").
- **Export CSV** — paper trail before paying.

### Agents-to-pay table

The actionable list. Default sort: Amount desc. Default status filter: Pending (`withdrawable > 0`). Each row's **Mark Paid** opens the same payment modal used in Payments tab (Section 5), pre-filled with the agent + week. In All-Unpaid mode, clicking a row expands it to show per-week breakdown so the manager can settle one specific week without paying everything.

### Removed from current Overview

| Removed | Where it lives now |
|---|---|
| "Clients / Losses / Earnings This Week" cards | Gone (owner said unnecessary) |
| "New Agents (30D)" | History tab |
| Weekly Trend chart | History tab |
| "Agents / Pending / Signups / Losses / Owed" 5-card row | Gone (folded into per-plan cards or other tabs) |
| "Top by Clients / Losses / Earnings" leaderboards | History tab as lifetime leaderboards |
| "Commission Plans" Plan A/B/C distribution row | Folded into per-plan cards |

### Empty / partial states

- **No upload yet:** illustrated empty state with CTA to Upload tab.
- **Period uploaded but no qualifiers:** per-plan cards show 0 with a hint explaining the qualifying threshold ("deposit ≥ K100 AND (sports bet ≥ K100 OR casino bet ≥ K100)").
- **All paid:** Pending filter shows empty table with "All agents settled for this period" message; flip to Status: Paid to see receipts.

## 3 — Manager portal: new History tab

A sibling to Overview. Holds everything lifetime / multi-week / strategic. Inserted between Overview and Approvals so the tab strip becomes:

```
Overview | History | Approvals | Manage | Upload | Payments | Tiers | Team | Chat
```

The "My Agents / All Agents" filter persists across both tabs.

### Layout

- **Range selector** — Last 4 weeks / Last 8 weeks (default) / Last 12 weeks / Last 6 months / All time / Custom range. Drives every range-scoped element below.
- **At-a-glance row** — four KPIs:
  - Weeks recorded
  - Lifetime earnings (within range)
  - New agents (30D)
  - Active rate — % of registered agents who had ≥1 qualifying client at any point in the range
- **Weekly Trend chart** — bars = earnings, line = qualifying clients (changed from "clients" in current chart). Bars are clickable → drills into that week's read-only Pay Period view.
- **Per-week archive** — table, one row per uploaded week:
  - Week | Qualifying | Earnings | Paid out | Outstanding | Drill in
  - Sortable, surfaces per-week outstanding so the manager spots old unpaid weeks.
- **Lifetime leaderboards** — Top by Clients / Top by Losses / Top Earners (range-scoped). Agent names clickable → opens agent profile drawer with full per-week history.
- **Plan distribution snapshot** — current registration counts (not range-scoped). Replaces today's Overview "Commission Plans" row.

### Empty / partial states

- **No data yet:** "No history yet — upload your first pay period" CTA to Upload.
- **Range with no data:** chart and archive show a placeholder; leaderboards fall back to all-time with banner.

### Out of scope for History

- Agents-to-pay actionable table (lives only on Overview).
- Payment-method breakdown / cashflow charts.
- Customer-level (per-player) drill-down.

## 4 — Upload flow integration

Existing Upload subtab gets three additions. No changes to file format, column expectations, sheet name "BWANABET", or manual `week_start_date` entry.

### Change 1 — Preview-and-confirm step

After the manager picks a file and date, parse in-memory and show a preview before any DB writes. Preview displays:

- File metadata (name, parsed row count, week start)
- Match summary: `✓ N matched`, `⚠ M skipped — code not found` (skipped codes shown in a collapsible)
- Per-plan summary for this upload (qualifying agents, qualifying clients, payable amount)
- Re-upload check (Change 2 below)

[Cancel] / [Confirm & Import] buttons. Confirm wraps both UPSERTs (`agent_weekly_data` and `agent_player_activity`) in a single transaction.

### Change 2 — Re-upload conflict detection

When the parsed `week_start_date` matches a week with existing `agent_payments` rows where `status='paid'`, the preview lists each affected agent with comparison:

| State | New earnings vs Paid | Behaviour |
|---|---|---|
| **Match** | new = paid | UPSERT writes new row; balance still settled |
| **Underpaid** | new > paid | Difference becomes withdrawable for that week |
| **Overpaid** | new < paid | Manager paid more than new earnings warrant. UPSERT proceeds; withdrawable clamps to 0; row tagged `⚠ Overpaid by KX`. Manager resolves via reversal payment. |

A required checkbox — `☐ I understand 1 agent will be overpaid — proceed anyway` — gates Confirm if any overpaid case exists.

### Change 3 — Post-upload landing

Replace today's "Imported successfully" toast with a screen showing:
- Imported counts
- "Pay period {date} is now the current period" message
- Primary CTA: **Open Overview →** (default focus)
- Secondary: **Upload another file**

Closes the loop: upload → see who needs paying → pay.

### Edge cases handled

| Scenario | Behaviour |
|---|---|
| Upload before any agents exist | Preview shows "0 of N matched"; abort with error |
| Identical re-upload | Preview shows "0 changes"; UPSERT no-op |
| New agent added in re-upload | Preview shows new qualifying counts; existing paid agents flagged correctly |
| Future-dated week | Preview flags `⚠ Future-dated` + checkbox required |
| Backdated upload | Allowed; appears in History + All-Unpaid toggle, doesn't change current period |

### Untouched

Agent List upload (separate flow that writes new agents to `agents` table) is independent and not affected.

## 5 — Manager portal: Payments tab redesign

The Payments tab becomes a **per-week ledger** focused on audit and historical record-keeping. Primary "who do I pay today?" workflow lives on Overview (Section 2).

### Layout

- **Header:** "Payment Ledger" title + [+ Record Payment] CTA.
- **Filter row:** Agent / Week / Status (Paid/Pending/All) / Method / Search.
- **Ledger table:** Date | Agent | Week | Earned | Paid | Status | Method | Notes. Paginated.

### Synthesised pending rows

Pending rows are **not stored** in `agent_payments` with `status='pending'`. They're computed on the fly from `agent_weekly_data` rows where `total_earnings > 0` and the (agent, week) has no matching paid `agent_payments` row. Show with `—` in Date and Method columns, "Pending" badge. Click → opens Record Payment modal pre-filled.

This avoids littering the ledger with thousands of placeholder pending rows.

### Record Payment modal

Opened from [+ Record Payment], from clicking a pending row, OR from Overview's [Mark Paid].

Fields:
- **Agent** (required) — typeahead/dropdown
- **Week** (required) — only weeks where selected agent has unpaid earnings; option labels show earned/paid summary
- **Amount** (required) — pre-filled to outstanding, editable to support partial payments
- **Method** — MoMo / Bank / Cash / Other
- **Date** — defaults to today
- **Notes** — free text

Submitting creates one `agent_payments` row with `status='paid'`, `paid_at` = now, `recorded_by` = current manager's identifier, all modal fields persisted.

### Partial payments

Multiple `agent_payments` rows per (agent, week) are permitted (no UNIQUE constraint — see Section 1). Withdrawable is computed by summing all paid amounts:

```
withdrawable(a, w) = total_earnings(a, w) − SUM(amount FOR all paid rows in (a, w))
```

### Reversals / corrections

Paid rows are immutable. To reverse, manager records a **negative payment** (e.g. -K100). Creates an offsetting row, audit trail intact, withdrawable goes back up. UI shows negative amounts in red with "Reversal" tag.

### Batch payment from Overview

When Overview's [Pay all matching filters] is triggered, the same modal logic runs in batch mode: one prompt for shared fields (date/method/notes/amount-strategy), creates N rows in a single transaction, all appear in the ledger immediately.

## 6 — Agent portal redesign

View-only display. No actions. Agent's question is "what am I owed and what did I earn?"

### Layout

```
Welcome, Evaristo Musonda · A365 · Plan A

┌─── Withdrawable ────────────────────────────────────┐
│           K400 awaiting payment                     │
│  From 1 unpaid week  ·  Last upload: 27 Apr 2026    │
│  Your manager records payment when sent.            │
└─────────────────────────────────────────────────────┘

┌─── Current Pay Period (27 Apr – 3 May 2026) ────────┐
│ Plan:                Plan A · K100 per qualifying    │
│ Total clients:       5                               │
│ Qualifying clients:  4                               │
│ Earnings:            K400                            │
│ Status:              Pending payment                 │
│ ⓘ Plan A pays K100 per client who deposits ≥K100     │
│   AND places sports bets ≥K100 OR casino bets ≥K100. │
└──────────────────────────────────────────────────────┘

┌─── My Performance History ──────────────────────────┐
│ Range: Last 8 weeks ▼                                │
│ Week        Total  Qualifying  Earnings  Status      │
│ 27 Apr 26   5      4           K400      Pending     │
│ 20 Apr 26   3      2           K200      Paid (3 May)│
│ ...                                                  │
└──────────────────────────────────────────────────────┘

┌─── Earnings Trend ────────┐ ┌─── Payment History ──┐
│ Bars + line, last 8 wks   │ │ Date  Week  Amt Method│
└───────────────────────────┘ └──────────────────────┘

┌─── This Period's Leaderboard ───────────────────────┐
│ Top performers — current pay period only            │
└──────────────────────────────────────────────────────┘
```

### Withdrawable card

The headline. Sum of all unpaid envelopes across all weeks (no current/arrears split for the agent — they want one number). Subhead shows count of unpaid weeks + date of most recent upload. Footer: "Your manager records payment when sent." No CTAs.

### Current Pay Period card

Most-recent-upload-week-only detail. Shows plan, total clients, qualifying clients, earnings, payment status, and the qualifying rule explanation in plain language. The qualifying-rule hint is critical — if an agent had clients but zero qualifying, this card immediately explains why their earnings are zero.

### Performance History table

Replaces today's Weekly Performance table. Range selector (default 8 weeks). Per-week rows with per-week payment status (Pending / Paid (date) / Partially paid / No qualifiers).

### Earnings Trend

Same chart as today's, but x-axis follows the Performance History range selector. Bars = earnings, line = qualifying clients.

### Payment History

Per-week-tied list. Each payment shows which week it settled.

### Leaderboard

Current-period-scoped. Shows top performers for the just-uploaded week only — motivating without long-tail demoralisation. Collapsible. (Lifetime ranking explicitly avoided to keep new agents from being permanently at the bottom.)

### Untouched

- Promo code claim flow.
- Authentication / login flow.
- Chat tab (agent ↔ manager).
- Telegram subscriber linking.

## 7 — Edge cases, error handling, and non-functional concerns

### Data integrity

| Scenario | Handling |
|---|---|
| Re-upload, agent already paid — overpaid | Section 4 preview flags, requires checkbox. Withdrawable clamps to 0. Row tagged "Overpaid by KX". Manager resolves via reversal. |
| Re-upload, agent already paid — underpaid | Difference becomes withdrawable for that week; no special UI. |
| Plan changed between upload and payment | `plan_at_import` column captures plan at import; later changes don't retroactively recalculate. |
| Backdated upload | Allowed; appears in History + All-Unpaid toggle; current period (`MAX(week_start_date)`) unchanged. |
| Future-dated upload (typo) | Preview flags + checkbox required. |
| Empty upload | Preview shows 0 matches; abort, no rows written. |
| Agent deleted from `agents` after upload | Verify `ON DELETE RESTRICT` on FK from `agent_weekly_data.agent_id` to `agents.id` is in place; alter if not. Recommend soft-delete via `agents.status` field rather than physical delete. |
| Two managers upload simultaneously | Postgres UPSERT atomic per row; last-writer-wins acceptable for low-concurrency manager portal. |

### Mobile-first

- Per-plan cards: `grid-cols-1 sm:grid-cols-3` to stack below ~640px.
- Agents-to-pay table: card-mode fallback on phones (reuse the pattern from existing Approvals tab).
- Mark Paid modal: dropdown picker for week (no date typing); large amount input.
- Agent leaderboard: single-column on phone.

### Performance

- `agent_weekly_data` ≈ 400 rows/week → 21k rows/year. Trivial for client-side aggregation.
- `agent_player_activity` larger; existing pagination preserved.
- Per-plan card aggregation: current-period only, ~400 rows max — fast.
- All-Unpaid toggle: cap aggregation at last 26 weeks; older unpaid debt flagged separately.

### Security gaps (existing, not introduced)

CLAUDE.md flags both:
- **Permissive RLS** — design depends on tightening RLS so only authenticated managers can write to `agent_payments`. Recommend before launch.
- **Plaintext passwords** — out of scope here, but should be addressed in lockstep with a future security pass.

This redesign adds `recorded_by` to `agent_payments` for audit, partially addressing the audit-trail gap.

### Testing

| Layer | Approach |
|---|---|
| Schema migration | Dry-run on a Supabase branch. Verify constraints + new columns. |
| Upload preview/import | Manual: 4 sample CSVs (clean / overpaid / underpaid / future-dated). Click through preview + confirm. Verify DB rows. |
| Per-plan card calculations | JS unit tests in `tests/` mirroring the existing `bwanabet-crm-overview/tests/` pattern (tape-style, run with Node). Mocked `agent_weekly_data` arrays → verify per-plan summary output. |
| Withdrawable computation | Unit test on the function computing per-(agent, week) withdrawable: partial payments, negative-clamp, multi-week aggregation. |
| Mobile rendering | Manual on 375px viewport (Chrome DevTools) before claiming done. CLAUDE.md hard rule. |

No automated end-to-end tests (existing app doesn't have them; out of scope to add Cypress/Playwright).

## Open decisions / risks

- **Where `recorded_by` gets its value** before user accounts are formalised — current CRM uses an email-based session (`steven.bwanabet@…`). Initial implementation: read from the same session source the rest of the app uses. Hardening to a UUID FK is a future migration.
- **RLS tightening before launch** is strongly recommended but technically separate work. The redesign exposes new write paths to `agent_payments` (the batch action and reversals) — without RLS, the anon key still allows arbitrary writes. Should be sequenced before this redesign goes to production.

## File-level scope (for downstream planning)

- `bwanabet-crm-overview/index.html` — Overview tab rewrite, History tab addition, Upload preview-and-confirm, Payments tab refactor.
- `bwanabet-crm-overview/tests/` — new JS unit tests for per-plan summary and withdrawable computation.
- `crmbwanbetagentportal/index.html` — agent dashboard rewrite (withdrawable card, current period card, performance history with status, leaderboard scope change).
- Supabase migration: add `agent_payments.week_start_date`, `agent_payments.recorded_by`, `agent_weekly_data.plan_at_import`; backfill `plan_at_import` from `agents.commission_plan`; create indexes.

## Acceptance criteria

- Manager Overview opens with three per-plan cards reflecting `MAX(week_start_date)` data; defaults to "Current Period" view.
- Manager can toggle to "All Unpaid Weeks" and see aggregated arrears.
- Manager can mark a single agent paid via Overview, batch-pay via filters, and record/reverse payments via Payments tab.
- Upload preview shows match counts, per-plan summary, and re-upload conflict detection before any DB writes.
- New uploads land the manager on Overview with the new period as current.
- Agent portal shows total withdrawable, current period detail with qualifying-rule hint, performance history with per-week payment status, and a current-period leaderboard.
- All new screens render usably at 375px viewport width.
- All `agent_payments` rows have a non-null `week_start_date` after migration.
