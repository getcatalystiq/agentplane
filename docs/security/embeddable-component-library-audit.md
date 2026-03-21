# Security Audit: Embeddable React Component Library

**Date:** 2026-03-20
**Scope:** Planned embeddable React component library for AgentCo integration
**Severity Scale:** Critical / High / Medium / Low / Informational

---

## Executive Summary

The planned architecture has a **Critical** risk from browser-side API key exposure and a **High** risk from the absence of origin validation infrastructure for postMessage-based OAuth. The existing server-side security posture (RLS, HMAC-signed OAuth state, HTTPS enforcement, timing-safe comparisons) is solid, but the shift to browser-based SDK usage introduces new attack surfaces that require mitigation before shipping.

---

## Finding 1: Browser-Exposed API Key (CRITICAL)

**Location:** `sdk/src/client.ts` lines 27-37, planned `<AgentPlaneProvider apiKey={...}>`

**Issue:** The SDK currently accepts an `apiKey` option and sends it as `Authorization: Bearer <key>` on every request. When this SDK runs in a browser bundle:

- The API key is visible in JavaScript source (even minified, trivially extractable)
- The key appears in every outgoing request visible in DevTools Network tab
- The key grants full tenant-scoped access: create/cancel runs, list agents, create sessions, manage connectors

**Impact:** Any visitor to a page embedding these components can extract the tenant API key and impersonate the tenant, create unbounded runs (consuming budget), exfiltrate agent configurations, or abuse connected services.

**Remediation (required before launch):**

1. **Introduce scoped, short-lived tokens.** AgentCo's backend should call AgentPlane's API (server-to-server with the full API key) to mint a session-scoped JWT or opaque token with:
   - Limited permissions (e.g., `runs:create` only, or specific agent IDs)
   - Short TTL (5-15 minutes), renewable via AgentCo backend
   - Audience claim bound to the embedding origin
2. **Add a `/api/tokens` endpoint** that accepts a full API key and returns a scoped browser token. The SDK `AgentPlane` constructor should accept either `apiKey` (server) or `token` (browser) with different permission models.
3. **Rate-limit per-token**, not just per-tenant, so a leaked browser token has bounded blast radius.

**Note:** The existing `generateRunToken` / `verifyRunToken` HMAC pattern in `crypto.ts` (lines 127-143) could be extended for this purpose.

---

## Finding 2: Missing postMessage Origin Validation (HIGH)

**Location:** No postMessage handling exists yet -- this is a design-phase finding.

**Issue:** The planned popup OAuth flow (window.open to AgentPlane, postMessage back to host) requires strict origin validation on both sides:

- **Receiver (AgentCo/host app):** Must validate `event.origin` against a known AgentPlane origin before trusting message data. Without this, any window can postMessage forged OAuth results.
- **Sender (AgentPlane popup):** Must use explicit `targetOrigin` parameter (NOT `"*"`) in `window.opener.postMessage(data, targetOrigin)`. The target origin must come from the signed OAuth state, not from user-controllable input.

**Remediation:**

```typescript
// AgentPlane popup (sender) -- MUST specify exact origin
window.opener.postMessage(
  { type: 'oauth_callback', code, state },
  'https://agentco.example.com'  // from signed state, NOT "*"
);

// Host app (receiver) -- MUST validate origin
window.addEventListener('message', (event) => {
  if (event.origin !== 'https://agentplane.example.com') return;
  if (event.data?.type !== 'oauth_callback') return;
  // process event.data
});
```

Additionally:
- The `redirect_uri` registered with OAuth providers must be on AgentPlane's domain (already the case for Composio callbacks at `/api/agents/[agentId]/connectors/[toolkit]/callback`)
- The popup callback page should include `Content-Security-Policy: frame-ancestors 'none'` to prevent clickjacking

---

## Finding 3: CSRF in Popup OAuth Flow (MEDIUM)

**Location:** `src/lib/oauth-state.ts` (existing signed state), planned popup flow

**Issue:** The existing HMAC-signed state parameter with 10-minute TTL (`STATE_TTL_MS`) provides good CSRF protection for server-side OAuth callbacks. However, the popup flow introduces a new vector:

- If the popup's callback page does not verify that it was opened by a legitimate parent window, an attacker could open the callback URL directly and capture tokens.
- The `state` parameter must survive the popup round-trip and be validated by the host app component, not just the server callback.

**Current strength:** The signed state in `oauth-state.ts` binds `agentId + tenantId + toolkit` with HMAC-SHA256 and expiry. This is well-implemented.

**Remediation:**
- Add a `nonce` field to the OAuth state payload, generated client-side and stored in component state (not localStorage). The popup callback must return this nonce, and the host component must verify it matches.
- Verify `window.opener !== null` in the popup before posting message.

---

## Finding 4: XSS via Markdown Rendering (MEDIUM)

**Location:** Currently uses `react-markdown` + `remark-gfm` + `dompurify` (server admin UI). The component library will reuse this pattern.

**Issue:** The existing sanitization stack is appropriate, but the component library adds risk:

1. **DOMPurify configuration matters.** Default DOMPurify strips `<script>` but allows `<a href="javascript:...">` unless configured with `FORBID_ATTR: ['onerror', 'onload']` and `ALLOWED_URI_REGEXP`.
2. **react-markdown with `rehype-raw`** (if enabled) passes raw HTML through, making DOMPurify the sole defense. If `rehype-raw` is NOT used, react-markdown itself prevents HTML injection.
3. **Link targets:** Markdown `[text](url)` links should open with `rel="noopener noreferrer"` and validate URL schemes (block `javascript:`, `data:`, `vbscript:`).

**Remediation:**
- Do NOT enable `rehype-raw` in the component library. Let react-markdown escape HTML.
- Configure DOMPurify with `ALLOWED_URI_REGEXP` that blocks `javascript:` and `data:` schemes.
- Add `target="_blank" rel="noopener noreferrer"` to all rendered links via a custom component override.

---

## Finding 5: Tenant Isolation Bypass from Client-Side (LOW)

**Location:** `src/lib/auth.ts` lines 19-63, `src/db/index.ts` (RLS via `app.current_tenant_id`)

**Issue:** The existing RLS architecture is sound:

- API key authentication resolves `tenantId` server-side from the key hash (line 34-42)
- RLS is enforced via `SET app.current_tenant_id` on every query
- The fail-closed `NULLIF` pattern prevents empty tenant context from matching

**Residual risk:** If the planned browser token (Finding 1) includes `tenantId` as a client-readable claim (e.g., in a JWT), ensure the server ALWAYS derives tenant context from the token's DB lookup, never from a client-supplied header or parameter.

**No immediate action needed** -- the current design is correct. Maintain this pattern when adding browser token support.

---

## Finding 6: Content Security Policy Compatibility (MEDIUM)

**Location:** `next.config.ts` lines 13-25

**Issue:** The current security headers include HSTS, X-Content-Type-Options, X-Frame-Options DENY, and Referrer-Policy, but **no Content-Security-Policy header**. For the embeddable library:

1. **Host app CSP impact:**
   - `connect-src` must allow `https://agentplane.example.com` for API calls
   - `child-src` or `frame-src` must allow the popup origin for OAuth
   - If components use inline styles (common with CSS-in-JS or Tailwind runtime), host apps with `style-src` restrictions will break
2. **AgentPlane popup page CSP:** The OAuth callback popup page should set `Content-Security-Policy: frame-ancestors 'none'; script-src 'self'` to prevent framing and XSS.

**Remediation:**
- Use CSS custom properties for theming (planned), NOT inline styles via `style` attribute. This avoids `style-src 'unsafe-inline'` requirements.
- Document required CSP directives for host apps.
- Add CSP to the popup callback page specifically.
- Consider adding a base CSP to `next.config.ts` for AgentPlane itself.

---

## Finding 7: Token Storage and Transmission (MEDIUM)

**Location:** Planned `<AgentPlaneProvider>` component

**Issue:** How the host app stores and provides the API key/token affects security:

- Storing in `localStorage` -- accessible to any XSS in the host app
- Storing in a React context/prop -- only accessible to components in the tree, but still in JS memory
- Hardcoded in source -- shipped to every client

**Remediation:**
- The browser token (from Finding 1) should be fetched from AgentCo's backend on mount, NOT stored in localStorage or hardcoded.
- Token should be held in a React ref or closure (the SDK already uses closure pattern at `client.ts` line 71: `this._getAuthHeader = () => authHeader`), not in React state that could be logged by DevTools.
- On unmount or tab close, the token should be discarded.
- Document that the full `ap_live_*` API key must NEVER be passed to browser components.

---

## Finding 8: Supply Chain / Dependency Security (LOW)

**Issue:** The component library will be published to npm with bundled dependencies.

**Remediation:**
- `react`, `react-dom` -- MUST be peer dependencies (deduplication, host controls version)
- `react-markdown`, `remark-gfm`, `dompurify` -- bundle these (security-critical, pin exact versions)
- SDK (`@getcatalystiq/agent-plane`) -- bundle (controls API communication)
- UI primitives (Radix, cmdk) -- bundle if used, peer if host already uses them
- Run `npm audit` in CI; use Socket.dev or Snyk for supply chain monitoring
- Enable npm provenance (`--provenance` flag) on publish for SLSA attestation

---

## Risk Matrix

| # | Finding | Severity | Exploitability | Status |
|---|---------|----------|----------------|--------|
| 1 | Browser API key exposure | Critical | Trivial | Design-phase, must fix before launch |
| 2 | Missing postMessage origin validation | High | Moderate | Design-phase |
| 3 | CSRF in popup OAuth | Medium | Moderate | Partially mitigated by existing signed state |
| 4 | XSS via markdown | Medium | Low (with current stack) | Mitigated if rehype-raw avoided |
| 5 | Tenant isolation bypass | Low | Very Low | Current RLS design is sound |
| 6 | CSP compatibility | Medium | N/A (availability) | Documentation + implementation needed |
| 7 | Token storage | Medium | Requires XSS first | Design-phase |
| 8 | Supply chain | Low | Moderate | Standard npm practices |

---

## Remediation Roadmap (Priority Order)

1. **[BLOCK LAUNCH]** Implement scoped browser tokens (Finding 1) -- without this, shipping the library exposes full tenant API keys to the public internet.
2. **[BLOCK LAUNCH]** Implement strict postMessage origin validation (Finding 2) -- required for secure OAuth popup flow.
3. **[Pre-launch]** Add client-side nonce to OAuth state (Finding 3).
4. **[Pre-launch]** Configure DOMPurify and disable rehype-raw (Finding 4).
5. **[Pre-launch]** Add CSP to popup callback page, document host CSP requirements (Finding 6).
6. **[Pre-launch]** Document token handling best practices, add provider-level warnings (Finding 7).
7. **[Ongoing]** Supply chain monitoring (Finding 8).
