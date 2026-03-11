---
status: complete
priority: p2
issue_id: "007"
tags: [code-review, architecture]
dependencies: []
---

# Multi-agent routing always picks agents[0]

## Problem Statement

`SandboxAgentExecutor.execute()` calls `loadA2aAgents()` and always uses `agents[0]` (line 293). When a tenant has multiple A2A-enabled agents, the wrong agent will be selected. The TODO comment acknowledges this, but there's no guard.

## Findings

- **Architecture Strategist**: Flagged as MEDIUM RISK — wrong agent selected silently

## Proposed Solutions

### Option A: Guard with single-agent check (Recommended)
Throw a clear error if `agents.length > 1`: "Phase 1 supports one A2A-enabled agent per tenant."

**Effort**: Small | **Risk**: Low

### Option B: Match by skill ID
Use the A2A skill ID (agent name) to select the correct agent from the list.

**Effort**: Medium | **Risk**: Low

## Technical Details

- **Affected files**: `src/lib/a2a.ts` line 293

## Acceptance Criteria

- [ ] Clear error or correct routing when multiple A2A-enabled agents exist per tenant

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-10 | Created from code review | Silent wrong-agent selection |
