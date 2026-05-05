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

-- 8. Harden FK: agent_weekly_data.agent_id was ON DELETE CASCADE; change to ON DELETE RESTRICT
--    so deleting an agent is blocked while weekly records exist (prevents silent data loss).
ALTER TABLE public.agent_weekly_data DROP CONSTRAINT agent_weekly_data_agent_id_fkey;
ALTER TABLE public.agent_weekly_data
  ADD CONSTRAINT agent_weekly_data_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE RESTRICT;

COMMIT;
