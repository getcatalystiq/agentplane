# Cookie Parsing Edge Case

**Priority:** P3-MEDIUM
**Category:** reliability
**File:** src/lib/auth.ts
**Lines:** 103-108
**Blocks:** none

## Description

The cookie parsing logic splits on `=` which breaks for cookie values containing `=` characters (common in base64-encoded JWTs).

## Current Code

```typescript
const cookies = cookieHeader.split(';');
for (const cookie of cookies) {
  const [name, value] = cookie.trim().split('=');
  if (name === 'CF_Authorization') {
    return value;
  }
}
```

## Example Failure

```
Cookie: CF_Authorization=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWI=.sig; other=value
```

With `split('=')`, value becomes `eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWI` (truncated).

## Impact

- JWTs with base64 payload containing `=` are truncated
- Validation fails for valid tokens
- Intermittent auth failures

## Fix

Split only on first `=`:

```typescript
function extractTokenFromCookie(cookieHeader: string): string | null {
  const cookies = cookieHeader.split(';');
  for (const cookie of cookies) {
    const trimmed = cookie.trim();
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const name = trimmed.substring(0, eqIndex);
    const value = trimmed.substring(eqIndex + 1);

    if (name === 'CF_Authorization') {
      return value;
    }
  }
  return null;
}
```

## Alternative

Use a proper cookie parsing library, but for a single cookie extraction this is overkill.
