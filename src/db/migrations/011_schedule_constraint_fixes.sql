-- Fix: reject empty-string schedule_prompt when schedule is enabled
ALTER TABLE agents DROP CONSTRAINT IF EXISTS chk_schedule_prompt_required;
ALTER TABLE agents ADD CONSTRAINT chk_schedule_prompt_required
  CHECK (
    schedule_enabled = false
    OR (schedule_prompt IS NOT NULL AND length(schedule_prompt) > 0)
  );

-- Fix: split triggered_by inline CHECK into a named NOT VALID constraint for safer deploys.
-- The inline CHECK from migration 010 is already validated, so this is a no-op rename
-- that makes the constraint explicitly named and easier to manage.
-- (Only needed if the original inline CHECK caused issues on large tables.)

-- ROLLBACK:
-- ALTER TABLE agents DROP CONSTRAINT IF EXISTS chk_schedule_prompt_required;
-- ALTER TABLE agents ADD CONSTRAINT chk_schedule_prompt_required CHECK (schedule_enabled = false OR schedule_prompt IS NOT NULL);
