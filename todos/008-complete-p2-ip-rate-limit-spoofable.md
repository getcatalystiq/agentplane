---
status: complete
priority: p2
issue_id: "008"
tags: [code-review, security]
dependencies: []
---

# IP-based rate limiting spoofable via x-forwarded-for

## Problem Statement

The Agent Card endpoint uses `x-forwarded-for` first entry for IP-based rate limiting (line 29). This is trivially spoofable by the client. On Vercel, the trustworthy IP is from `x-real-ip` or the rightmost `x-forwarded-for` entry.

## Findings

- **Security Sentinel**: Flagged as Medium — rate limit bypass enables DoS against Agent Card endpoint

## Proposed Solutions

### Option A: Use request.ip or x-real-ip (Recommended)
```typescript
const clientIp = request.ip || request.headers.get("x-real-ip") || "unknown";
```

**Effort**: Small | **Risk**: Low

## Technical Details

- **Affected files**: `src/app/api/a2a/[slug]/.well-known/agent-card.json/route.ts` line 29

## Acceptance Criteria

- [ ] Rate limiting uses trustworthy IP source

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-10 | Created from code review | x-forwarded-for[0] is client-controlled |
