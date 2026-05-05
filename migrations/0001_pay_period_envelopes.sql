-- Migration 0001: Pay period envelopes
-- Adds week_start_date + recorded_by to agent_payments
-- Adds plan_at_import to agent_weekly_data (backfilled from agents.commission_plan)
-- Hardens FK on agent_weekly_data.agent_id to ON DELETE RESTRICT
-- Idempotent: additive operations use IF NOT EXISTS; the FK rewrite is guarded by
-- a conditional DO block that only fires when the current delete_rule is CASCADE.

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

-- 5. agent_weekly_data: backfill plan_at_import from current agents.commission_plan.
--    Note: any orphaned wd row (agent_id with no matching agents.id) keeps NULL and
--    will trip the NOT NULL enforcement at step 6. To diagnose, run:
--      SELECT COUNT(*) FROM agent_weekly_data WHERE plan_at_import IS NULL;
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

-- 8. Harden FK on agent_weekly_data.agent_id to ON DELETE RESTRICT.
--    Constraint name 'agent_weekly_data_agent_id_fkey' is the Postgres auto-generated
--    default and was verified against baseline. The DO block makes this idempotent:
--    the rewrite only fires when the current rule is CASCADE; replays on a DB that
--    already has RESTRICT (or where the FK was never created with CASCADE) are no-ops.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.referential_constraints rc
    JOIN information_schema.table_constraints tc
      ON rc.constraint_name = tc.constraint_name
    WHERE tc.table_name = 'agent_weekly_data'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND tc.constraint_name = 'agent_weekly_data_agent_id_fkey'
      AND rc.delete_rule = 'CASCADE'
  ) THEN
    ALTER TABLE public.agent_weekly_data
      DROP CONSTRAINT agent_weekly_data_agent_id_fkey;

    ALTER TABLE public.agent_weekly_data
      ADD CONSTRAINT agent_weekly_data_agent_id_fkey
      FOREIGN KEY (agent_id) REFERENCES public.agents(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

COMMIT;
