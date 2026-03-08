-- Add tenant timezone
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS timezone VARCHAR(100) NOT NULL DEFAULT 'UTC';

-- Add schedule columns to agents
ALTER TABLE agents ADD COLUMN IF NOT EXISTS schedule_frequency VARCHAR(20) DEFAULT 'manual'
  CHECK (schedule_frequency IN ('manual', 'hourly', 'daily', 'weekdays', 'weekly'));
ALTER TABLE agents ADD COLUMN IF NOT EXISTS schedule_time TIME;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS schedule_day_of_week SMALLINT
  CHECK (schedule_day_of_week BETWEEN 0 AND 6);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS schedule_prompt TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS schedule_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS schedule_last_run_at TIMESTAMPTZ;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS schedule_next_run_at TIMESTAMPTZ;

-- Cross-column constraints
ALTER TABLE agents ADD CONSTRAINT chk_schedule_time_required
  CHECK (
    (schedule_frequency IN ('daily', 'weekdays', 'weekly') AND schedule_time IS NOT NULL)
    OR schedule_frequency IN ('manual', 'hourly')
    OR schedule_frequency IS NULL
  );

ALTER TABLE agents ADD CONSTRAINT chk_schedule_day_of_week_weekly
  CHECK (
    (schedule_frequency = 'weekly' AND schedule_day_of_week IS NOT NULL)
    OR (schedule_frequency != 'weekly' AND schedule_day_of_week IS NULL)
    OR schedule_frequency IS NULL
  );

ALTER TABLE agents ADD CONSTRAINT chk_schedule_prompt_required
  CHECK (
    schedule_enabled = false
    OR schedule_prompt IS NOT NULL
  );

ALTER TABLE agents ADD CONSTRAINT chk_schedule_enabled_not_manual
  CHECK (
    schedule_enabled = false
    OR schedule_frequency != 'manual'
  );

-- Add triggered_by to runs
ALTER TABLE runs ADD COLUMN IF NOT EXISTS triggered_by VARCHAR(20) NOT NULL DEFAULT 'api'
  CHECK (triggered_by IN ('api', 'schedule', 'playground'));

-- Partial index for efficient cron queries
CREATE INDEX IF NOT EXISTS idx_agents_schedule_due
  ON agents (schedule_next_run_at)
  WHERE schedule_enabled = true;

-- ROLLBACK (manual, forward migration):
-- ALTER TABLE agents DROP CONSTRAINT IF EXISTS chk_schedule_time_required;
-- ALTER TABLE agents DROP CONSTRAINT IF EXISTS chk_schedule_day_of_week_weekly;
-- ALTER TABLE agents DROP CONSTRAINT IF EXISTS chk_schedule_prompt_required;
-- ALTER TABLE agents DROP CONSTRAINT IF EXISTS chk_schedule_enabled_not_manual;
-- DROP INDEX IF EXISTS idx_agents_schedule_due;
-- ALTER TABLE agents DROP COLUMN IF EXISTS schedule_frequency, schedule_time, schedule_day_of_week, schedule_prompt, schedule_enabled, schedule_last_run_at, schedule_next_run_at;
-- ALTER TABLE tenants DROP COLUMN IF EXISTS timezone;
-- ALTER TABLE runs DROP COLUMN IF EXISTS triggered_by;
