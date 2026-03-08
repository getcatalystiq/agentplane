# Brainstorm: Scheduled Agent Runs

**Date:** 2026-03-07
**Status:** Ready for planning

## What We're Building

Scheduled agent runs — the ability to configure an agent to run automatically on a recurring schedule (hourly, daily, weekdays, or weekly) with a dedicated prompt. The schedule configuration lives on the agent detail page between the Skills editor and the Runs table.

### User-Facing Behavior

- **Frequency options:** Manual (no schedule), Hourly, Daily, Weekdays (Mon-Fri), Weekly
- **Time picker:** Shown for Daily, Weekdays, and Weekly (e.g. "09:00 AM")
- **Day picker:** Shown only for Weekly (Monday-Sunday dropdown)
- **Hourly:** Runs at the top of each hour, no extra options
- **Prompt:** Dedicated textarea — the prompt sent to the agent on each scheduled run
- **Enable/disable toggle:** Schedule can be saved but disabled without deleting config
- **Status display:** Shows last run time and computed next run time
- **Timezone:** Set at the tenant level (new field on tenants table, default UTC)

### UI Placement

Agent detail page section order:
1. Header + Stats Cards
2. AgentEditForm
3. ConnectorsManager
4. PluginsManager
5. SkillsEditor
6. **ScheduleEditor** (new)
7. Runs table

## Why This Approach

**Columns on agents table** rather than a separate schedules table:
- The UI shows a single schedule config per agent — no need for a many-to-many relationship
- Simpler queries for the cron job (single table scan)
- Follows the existing pattern of adding agent capabilities as columns (composio fields, skills, plugins)
- YAGNI — if multiple schedules are needed later, migration is straightforward

**Internal API call for execution** rather than direct sandbox creation:
- Reuses all existing run creation logic (budget checks, concurrency limits, MCP config, streaming, transcript capture)
- The cron handler stays thin — just determines which agents are due and fires requests
- Leverages the existing stream-detach pattern for long-running scheduled runs

**Tenant-level timezone** rather than per-schedule or UTC-only:
- More user-friendly than forcing UTC
- Avoids per-agent timezone complexity
- One timezone setting covers all agents for a tenant

## Key Decisions

1. **One schedule per agent** — stored as columns on the agents table, not a separate table
2. **Frequency options:** Manual, Hourly, Daily, Weekdays, Weekly (matches the reference screenshots)
3. **Dedicated prompt field** — each schedule has its own prompt, independent of the agent description
4. **Cron polling every minute** — new Vercel cron job checks for due schedules each minute
5. **Execution via internal API call** — cron triggers POST /api/runs internally, reusing all existing run infrastructure
6. **Tenant-level timezone** — new `timezone` column on tenants table (default UTC), used for all schedule calculations
7. **Last run + next run display** — schedule section shows when it last ran and when it will next run

## Database Changes

### Tenants table
- `timezone` VARCHAR(100) DEFAULT 'UTC' — IANA timezone string (e.g. "America/New_York")

### Agents table
- `schedule_frequency` VARCHAR(20) DEFAULT 'manual' — one of: manual, hourly, daily, weekdays, weekly
- `schedule_time` TIME — time of day for daily/weekdays/weekly (stored in tenant timezone)
- `schedule_day_of_week` SMALLINT — 0-6 (Sunday-Saturday) for weekly frequency
- `schedule_prompt` TEXT — the prompt to use for scheduled runs
- `schedule_enabled` BOOLEAN DEFAULT false — toggle without losing config
- `schedule_last_run_at` TIMESTAMPTZ — when the schedule last triggered a run

### New cron entry in vercel.json
- Path: `/api/cron/scheduled-runs`
- Schedule: `* * * * *` (every minute)

## Component Design

### ScheduleEditor (client component)
- Frequency dropdown (Manual/Hourly/Daily/Weekdays/Weekly)
- Conditionally shows time picker (Daily, Weekdays, Weekly)
- Conditionally shows day-of-week dropdown (Weekly only)
- Prompt textarea
- Enable/disable toggle
- Last run + next run display
- Save button (PATCH to agent endpoint)

### Cron handler (`/api/cron/scheduled-runs/route.ts`)
- Queries agents where `schedule_enabled = true` AND `schedule_frequency != 'manual'`
- For each, computes whether it's due based on frequency, time, day, tenant timezone, and last_run_at
- Fires internal POST to `/api/runs` with the schedule prompt
- Updates `schedule_last_run_at` on success

## Open Questions

None — all questions resolved during brainstorming.
