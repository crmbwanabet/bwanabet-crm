# Plan 1: Data Model Migration — Pay Period Envelopes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the schema changes that enable locked pay-period envelopes — every payment row is tied to a specific week; every weekly-data row records the agent's plan at import time.

**Architecture:** Two ALTER TABLE migrations against the live CRM Supabase project. New columns are added with safe defaults, backfilled where needed, then constraints are tightened. No application-code changes in this plan; it unblocks the UI redesigns in Plans 2–6.

**Tech Stack:** Supabase Postgres 17, SQL migrations applied via the Supabase MCP `apply_migration` tool. Validation via `execute_sql`. Migration SQL is version-controlled in the CRM repo.

**Spec reference:** `docs/superpowers/specs/2026-05-04-affiliate-manager-redesign-design.md` Section 1.

**Target Supabase project:** `blrrcnrhixckfudiojwe` (named "CRM"). Confirmed via `SUPABASE_URL=https://blrrcnrhixckfudiojwe.supabase.co` in Vercel env.

---

## File Structure

### New files
- `migrations/0001_pay_period_envelopes.sql` (in `bwanabet-crm-overview` repo) — full migration SQL, idempotent, version-controlled. The CRM repo doesn't have a `migrations/` folder yet; this plan creates it.

### Modified files
None — this plan is pure schema migration with no application code changes.

### Database tables affected (`public` schema, project `blrrcnrhixckfudiojwe`)
- `agent_payments` — add `week_start_date date NOT NULL`, `recorded_by text NULLABLE`, two indexes.
- `agent_weekly_data` — add `plan_at_import text NOT NULL` (backfilled from `agents.commission_plan`).
- `agent_weekly_data.agent_id` FK — verify `ON DELETE RESTRICT`; alter if not.

---

## Task 1: Capture baseline

**Files:** none (read-only verification via Supabase MCP)

**Goal:** Snapshot the current schema and data state so post-migration validation has something to compare against.

- [ ] **Step 1: Capture row counts for affected tables**

Use Supabase MCP `execute_sql` against project `blrrcnrhixckfudiojwe`:

```sql
SELECT 'agents' AS tbl, COUNT(*) AS rows FROM public.agents
UNION ALL SELECT 'agent_weekly_data', COUNT(*) FROM public.agent_weekly_data
UNION ALL SELECT 'agent_payments', COUNT(*) FROM public.agent_payments;
```

Expected: three rows. Record values in a working note. Used as a regression check — counts must be unchanged after migration.

- [ ] **Step 2: Inspect existing columns to confirm migration hasn't been partially applied**

```sql
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('agent_payments', 'agent_weekly_data')
ORDER BY table_name, ordinal_position;
```

Expected: `agent_payments` has no `week_start_date` and no `recorded_by`. `agent_weekly_data` has no `plan_at_import`.

If any of those three columns already exist, **STOP**: migration was partially applied previously. Inspect manually before proceeding.

- [ ] **Step 3: Capture current FK behavior on `agent_weekly_data.agent_id`**

```sql
SELECT
  tc.constraint_name,
  rc.delete_rule
FROM information_schema.referential_constraints rc
JOIN information_schema.table_constraints tc
  ON rc.constraint_name = tc.constraint_name
WHERE tc.table_name = 'agent_weekly_data'
  AND tc.constraint_type = 'FOREIGN KEY';
```

Expected: at least one row, `delete_rule` is one of `RESTRICT`, `NO ACTION`, `CASCADE`, `SET NULL`. Record the value. Task 5 uses this.

---

## Task 2: Create the migration file

**Files:**
- Create: `bwanabet-crm-overview/migrations/0001_pay_period_envelopes.sql`

**Goal:** Author the full migration as a single idempotent SQL file checked into the CRM repo. This file is the single source of truth — when run via `apply_migration`, Supabase records the same SQL in its migration history.

- [ ] **Step 1: Create the `migrations/` folder in the CRM repo**

```bash
cd "C:/Users/USER/Desktop/Claude projects/bwanabet-crm-overview"
mkdir -p migrations
```

- [ ] **Step 2: Write the migration SQL**

Create `migrations/0001_pay_period_envelopes.sql` with this exact content:

```sql
-- Migration 0001: Pay period envelopes
-- Adds week_start_date + recorded_by to agent_payments
-- Adds plan_at_import to agent_weekly_data (backfilled from agents.commission_plan)
-- Hardens FK on agent_weekly_data.agent_id to ON DELETE RESTRICT
-- Idempotent: safe to re-run; uses IF NOT EXISTS guards.

BEGIN;

-- 1. agent_payments: add week_start_date (sentinel default to satisfy NOT NULL on existing rows)
ALTER TABLE public.agent_payments
  ADD COLUMN IF NOT EXISTS week_start_date date NOT NULL DEFAULT '1970-01-01';

-- 2. agent_payments: add recorded_by (manager identifier; NULLABLE — pre-redesign rows have none)
ALTER TABLE public.agent_payments
  ADD COLUMN IF NOT EXISTS recorded_by text;

-- 3. agent_payments: indexes for the new lookup patterns
CREATE INDEX IF NOT EXISTS idx_agent_payments_week
  ON public.agent_payments(week_start_date);

CREATE INDEX IF NOT EXISTS idx_agent_payments_agent_week
  ON public.agent_payments(agent_id, week_start_date);

-- 4. agent_weekly_data: add plan_at_import (NULLABLE during backfill, NOT NULL after)
ALTER TABLE public.agent_weekly_data
  ADD COLUMN IF NOT EXISTS plan_at_import text;

-- 5. agent_weekly_data: backfill plan_at_import from current agents.commission_plan
UPDATE public.agent_weekly_data wd
SET plan_at_import = a.commission_plan
FROM public.agents a
WHERE wd.agent_id = a.id
  AND wd.plan_at_import IS NULL;

-- 6. agent_weekly_data: enforce NOT NULL after backfill
ALTER TABLE public.agent_weekly_data
  ALTER COLUMN plan_at_import SET NOT NULL;

-- 7. agent_payments: drop the sentinel default (only after rows exist; '1970-01-01' rows would
--    indicate pre-migration legacy data; production has 0 rows so this is a no-op).
ALTER TABLE public.agent_payments
  ALTER COLUMN week_start_date DROP DEFAULT;

COMMIT;
```

- [ ] **Step 3: Verify the file was written correctly**

```bash
cd "C:/Users/USER/Desktop/Claude projects/bwanabet-crm-overview"
wc -l migrations/0001_pay_period_envelopes.sql
```

Expected: ~40 lines (comments + SQL).

---

## Task 3: Apply the migration

**Files:** none (executes against live DB)

**Goal:** Run the migration on the CRM Supabase project and confirm it succeeded.

- [ ] **Step 1: Apply via Supabase MCP**

Use `mcp__supabase__apply_migration` with:
- `project_id`: `blrrcnrhixckfudiojwe`
- `name`: `0001_pay_period_envelopes`
- `query`: the full SQL file contents from Task 2 Step 2

Expected: success response. If any step inside the BEGIN/COMMIT fails, the whole transaction rolls back and no partial state is left.

- [ ] **Step 2: Verify columns exist with expected types and constraints**

```sql
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name = 'agent_payments' AND column_name IN ('week_start_date', 'recorded_by'))
    OR (table_name = 'agent_weekly_data' AND column_name = 'plan_at_import'))
ORDER BY table_name, column_name;
```

Expected: three rows.
- `agent_payments.recorded_by` — text, nullable, no default.
- `agent_payments.week_start_date` — date, NOT NULL, **no default** (default was dropped in Task 2 Step 2's SQL).
- `agent_weekly_data.plan_at_import` — text, NOT NULL, no default.

- [ ] **Step 3: Verify indexes exist**

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'agent_payments'
  AND indexname IN ('idx_agent_payments_week', 'idx_agent_payments_agent_week');
```

Expected: two rows; both indexdef strings reference `agent_payments`.

---

## Task 4: Validate backfill

**Files:** none (read-only verification)

**Goal:** Confirm `plan_at_import` was populated for every existing `agent_weekly_data` row, and matches the agent's current `commission_plan`.

- [ ] **Step 1: Confirm zero NULL `plan_at_import` rows**

```sql
SELECT COUNT(*) AS null_plan_rows
FROM public.agent_weekly_data
WHERE plan_at_import IS NULL;
```

Expected: 0. If non-zero, the NOT NULL constraint in Task 2 Step 2 should have failed; investigate.

- [ ] **Step 2: Spot-check backfilled values match `agents.commission_plan`**

```sql
SELECT
  wd.id,
  wd.agent_id,
  wd.plan_at_import,
  a.commission_plan
FROM public.agent_weekly_data wd
JOIN public.agents a ON a.id = wd.agent_id
WHERE wd.plan_at_import != a.commission_plan
LIMIT 10;
```

Expected: 0 rows (all backfilled rows match their agent's current plan, since the migration ran moments ago and no plan changes have occurred since).

- [ ] **Step 3: Confirm row counts unchanged from baseline**

Re-run the Task 1 Step 1 query and compare against the baseline counts captured then.

```sql
SELECT 'agents' AS tbl, COUNT(*) AS rows FROM public.agents
UNION ALL SELECT 'agent_weekly_data', COUNT(*) FROM public.agent_weekly_data
UNION ALL SELECT 'agent_payments', COUNT(*) FROM public.agent_payments;
```

Expected: identical counts to baseline. If any row count changed, the migration is suspect — investigate.

---

## Task 5: Harden FK on `agent_weekly_data.agent_id` (conditional)

**Files:** none (DB-only)

**Goal:** Ensure the FK from `agent_weekly_data.agent_id` to `agents.id` is `ON DELETE RESTRICT`, so a DELETE on `agents` does not silently orphan or destroy weekly-data rows.

**Skip this task if** Task 1 Step 3 reported the FK's `delete_rule` is already `RESTRICT` or `NO ACTION` (the default — both behave equivalently here). Proceed only if it's `CASCADE` or `SET NULL`.

- [ ] **Step 1: Identify the constraint name**

Use the value from Task 1 Step 3. Call it `<FK_NAME>` below.

- [ ] **Step 2: Drop and re-create the FK with RESTRICT**

```sql
ALTER TABLE public.agent_weekly_data
  DROP CONSTRAINT <FK_NAME>;

ALTER TABLE public.agent_weekly_data
  ADD CONSTRAINT <FK_NAME>
  FOREIGN KEY (agent_id) REFERENCES public.agents(id)
  ON DELETE RESTRICT;
```

- [ ] **Step 3: Verify the constraint now restricts**

Re-run the Task 1 Step 3 query. Expected: `delete_rule = 'RESTRICT'`.

- [ ] **Step 4: Append the change to the migration file for future replays**

Edit `migrations/0001_pay_period_envelopes.sql` — add the DROP/ADD statements before the `COMMIT;` line, wrapped in a comment block explaining why the conditional change was needed. This keeps the file replayable on a fresh DB.

---

## Task 6: Commit the migration file

**Files:**
- Add to git: `bwanabet-crm-overview/migrations/0001_pay_period_envelopes.sql`

**Goal:** Version-control the migration so future developers can reproduce the schema state on a fresh Supabase project, and so we have a record of what was applied.

- [ ] **Step 1: Verify git status in CRM repo**

```bash
cd "C:/Users/USER/Desktop/Claude projects/bwanabet-crm-overview"
git status
```

Expected: `migrations/0001_pay_period_envelopes.sql` is listed as untracked. (`CLAUDE.md` may also be untracked — leave it alone, not part of this work.)

- [ ] **Step 2: Stage only the migration file**

```bash
git add migrations/0001_pay_period_envelopes.sql
git status
```

Expected: only the migration file under "Changes to be committed".

- [ ] **Step 3: Commit with a descriptive message**

```bash
git commit -m "$(cat <<'EOF'
Add pay-period envelope schema migration (0001)

agent_payments gains week_start_date (NOT NULL) and recorded_by columns
plus indexes for per-week lookups. agent_weekly_data gains plan_at_import
(NOT NULL after backfill) so retroactive plan changes don't recalculate
historical earnings. Migration is idempotent and applied to project
blrrcnrhixckfudiojwe via Supabase MCP.

Foundation for the affiliate manager portal redesign — see
docs/superpowers/specs/2026-05-04-affiliate-manager-redesign-design.md
Section 1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Push to origin/main**

```bash
git push origin main
```

Expected: push succeeds, no conflicts.

- [ ] **Step 5: Verify**

```bash
git log --oneline -3
```

Expected: top commit is the migration commit; second is the prior spec commit (`79f4e4d`).

---

## Acceptance criteria

After this plan is fully executed:

- [ ] `agent_payments.week_start_date` exists, is `date NOT NULL`, has no default.
- [ ] `agent_payments.recorded_by` exists, is `text NULLABLE`.
- [ ] `idx_agent_payments_week` and `idx_agent_payments_agent_week` exist.
- [ ] `agent_weekly_data.plan_at_import` exists, is `text NOT NULL`.
- [ ] Every `agent_weekly_data` row has a non-null `plan_at_import` matching its agent's `commission_plan`.
- [ ] Row counts for `agents`, `agent_weekly_data`, `agent_payments` are unchanged from baseline.
- [ ] FK on `agent_weekly_data.agent_id` is `ON DELETE RESTRICT` (or `NO ACTION`).
- [ ] `migrations/0001_pay_period_envelopes.sql` is committed to `bwanabet-crm-overview` `main` and pushed.

---

## What this plan does NOT do

- **No application-code changes.** The CRM and agent portal `index.html` files are untouched. New columns are present but not yet read or written by any UI.
- **No RLS policy changes.** CLAUDE.md flags permissive RLS as a known gap — addressing it is out of scope for this plan and recommended as a separate workstream before launch.
- **No tests against the redesigned UI.** Plans 2–6 add UI tests as they introduce UI.
- **No agent portal changes.** The agent portal repo is unaffected by this plan; Plan 6 will reference these schema columns when rebuilding the agent dashboard.

## Next plan

Plan 4 (Upload preview/confirm) is the recommended next step — it closes the upload loop end-to-end before the manager-facing Overview redesign in Plan 2 lands. Alternative: jump straight to Plan 2 if you'd rather see the dashboard first. Either is unblocked by Plan 1.
