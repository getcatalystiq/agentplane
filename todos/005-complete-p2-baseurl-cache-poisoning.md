---
status: complete
priority: p2
issue_id: "005"
tags: [code-review, security]
dependencies: []
---

# Agent Card baseUrl derived from attacker-controlled headers

## Problem Statement

Both A2A routes construct `baseUrl` from `x-forwarded-proto` and `host` request headers. If the application is accessed directly (bypassing Vercel's edge proxy), an attacker can forge these headers to inject a malicious URL into the Agent Card's `url` field. The card is cached for 60s (process-level) and 300s (HTTP cache), so a single poisoned request could redirect all A2A consumers to an attacker-controlled endpoint.

## Findings

- **Security Sentinel**: Flagged as Medium — cache poisoning could redirect consumers to attacker-controlled JSON-RPC endpoint, enabling credential theft

## Proposed Solutions

### Option A: Use trusted env var (Recommended)
Derive `baseUrl` from `VERCEL_PROJECT_PRODUCTION_URL` or a new `BASE_URL` env var.

**Pros**: Eliminates header-based attack vector entirely
**Cons**: Needs env var configured
**Effort**: Small
**Risk**: Low

## Technical Details

- **Affected files**:
  - `src/app/api/a2a/[slug]/.well-known/agent-card.json/route.ts` lines 76-78
  - `src/app/api/a2a/[slug]/jsonrpc/route.ts` lines 159-161

## Acceptance Criteria

- [ ] `baseUrl` derived from trusted environment variable, not request headers

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-10 | Created from code review | Header-based cache poisoning vector |
