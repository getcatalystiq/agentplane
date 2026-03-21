# OAuth Popup Window Pattern for Embedded React Components

Research compiled March 2026. Focused on the scenario where a React component library
(embedded in a host app) initiates OAuth flows that redirect to the library's origin domain.

---

## 1. The Popup Pattern

### Core Flow

```
Host App (agentco.com)          AgentPlane Popup (agentplane.com)
---------------------           ---------------------------------
User clicks "Connect"
  |
  +-> window.open(authUrl)  --> Popup opens at agentplane.com
  |                              |
  |                              +-> Redirects to OAuth provider
  |                              |
  |                              +-> User authorizes
  |                              |
  |                              +-> Provider redirects back to
  |                              |   agentplane.com/callback
  |                              |
  |                              +-> Callback page calls
  |                              |   window.opener.postMessage()
  |                              |
  <-- message event -------------+
  |
  +-> Validate origin
  +-> Close popup
  +-> Update UI state
```

### Implementation: Parent (Embedded Component)

```typescript
// useOAuthPopup.ts -- React hook for the embedded component side

interface OAuthPopupOptions {
  /** URL on YOUR domain (agentplane.com) that starts the OAuth flow */
  authUrl: string;
  /** Your domain origin -- used to validate postMessage sender */
  expectedOrigin: string;
  /** Called when OAuth completes successfully */
  onSuccess: (data: Record<string, unknown>) => void;
  /** Called on error (auth failure, popup blocked, user closed) */
  onError: (error: string) => void;
  /** Popup window features */
  width?: number;
  height?: number;
}

export function useOAuthPopup() {
  const popupRef = useRef<Window | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    popupRef.current = null;
  }, []);

  const openPopup = useCallback((options: OAuthPopupOptions) => {
    const {
      authUrl,
      expectedOrigin,
      onSuccess,
      onError,
      width = 600,
      height = 700,
    } = options;

    // 1. Clean up any previous popup
    cleanup();

    // 2. Center the popup on screen
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    const features = [
      `width=${width}`,
      `height=${height}`,
      `left=${left}`,
      `top=${top}`,
      "toolbar=no",
      "menubar=no",
      "scrollbars=yes",
      "resizable=yes",
    ].join(",");

    // 3. Open popup -- MUST be synchronous in click handler
    const popup = window.open(authUrl, "oauth-popup", features);

    // 4. Detect popup blocker
    if (!popup || popup.closed) {
      onError("popup_blocked");
      return;
    }

    popupRef.current = popup;

    // 5. Listen for postMessage from callback page
    const messageHandler = (event: MessageEvent) => {
      // CRITICAL: Validate origin with exact match
      if (event.origin !== expectedOrigin) return;

      // Validate message shape
      if (!event.data || typeof event.data !== "object") return;
      if (event.data.type !== "oauth_callback") return;

      popup.close();
      cleanup();

      if (event.data.success) {
        onSuccess(event.data);
      } else {
        onError(event.data.error || "auth_failed");
      }
    };

    window.addEventListener("message", messageHandler);
    cleanupRef.current = () => {
      window.removeEventListener("message", messageHandler);
    };

    // 6. Poll for user-closed popup (no postMessage sent)
    timerRef.current = setInterval(() => {
      try {
        if (popup.closed) {
          cleanup();
          onError("popup_closed");
        }
      } catch {
        // Cross-origin access to popup.closed may throw with
        // strict COOP headers -- treat as still open
      }
    }, 500);
  }, [cleanup]);

  // Clean up on unmount
  useEffect(() => cleanup, [cleanup]);

  return { openPopup };
}
```

### Implementation: Callback Page (Your Domain)

```typescript
// app/oauth/callback/page.tsx -- runs on agentplane.com after OAuth redirect

"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

export default function OAuthCallbackPage() {
  const params = useSearchParams();

  useEffect(() => {
    const success = params.get("success") === "true";
    const error = params.get("error");

    // Get the allowed parent origin from server config or a signed param
    const parentOrigin = params.get("origin") || "*";

    if (window.opener) {
      // Send result to parent via postMessage
      // SECURITY: Use exact targetOrigin, never "*" with sensitive data
      window.opener.postMessage(
        {
          type: "oauth_callback",
          success,
          error: error || undefined,
          // Include a nonce/state that the parent can validate
          state: params.get("state"),
        },
        parentOrigin  // See security section for why this matters
      );

      // Auto-close after short delay (gives postMessage time to deliver)
      setTimeout(() => window.close(), 300);
    } else {
      // opener was lost (COOP headers, user navigated away)
      // Show manual close instructions via DOM text
      const el = document.getElementById("status");
      if (el) el.textContent = "Authentication complete. You can close this window.";
    }
  }, [params]);

  return <p id="status">Completing authentication...</p>;
}
```

---

## 2. Popup Blocker Detection and Fallback

### Detection

```typescript
function openOAuthPopup(url: string): Window | null {
  const popup = window.open(url, "oauth", "width=600,height=700");

  // Detection method 1: null or undefined return
  if (!popup) return null;

  // Detection method 2: immediately closed (some blockers do this)
  if (popup.closed) return null;

  // Detection method 3: zero dimensions (rare, IE-era)
  try {
    if (popup.outerHeight === 0 || popup.outerWidth === 0) {
      popup.close();
      return null;
    }
  } catch {
    // Cross-origin -- cannot check dimensions, assume open
  }

  return popup;
}
```

### Fallback Strategies

```typescript
type OAuthStrategy = "popup" | "redirect" | "new_tab";

function initiateOAuth(
  authUrl: string,
  returnUrl: string
): { strategy: OAuthStrategy } {
  // Strategy 1: Try popup first (best UX for embedded components)
  const popup = openOAuthPopup(authUrl);
  if (popup) {
    return { strategy: "popup" };
  }

  // Strategy 2: New tab (works when popups blocked, preserves parent state)
  // Append return_url so callback can redirect back
  const tabUrl = new URL(authUrl);
  tabUrl.searchParams.set("return_url", returnUrl);

  const tab = window.open(tabUrl.toString(), "_blank");
  if (tab) {
    return { strategy: "new_tab" };
  }

  // Strategy 3: Full redirect (last resort -- loses parent app state)
  // Store current state in sessionStorage before redirecting
  sessionStorage.setItem("oauth_return_state", JSON.stringify({
    returnUrl,
    timestamp: Date.now(),
  }));
  window.location.href = tabUrl.toString();
  return { strategy: "redirect" };
}
```

### UX for Blocked Popups

```tsx
function ConnectButton({ onConnect }: { onConnect: () => void }) {
  const [blocked, setBlocked] = useState(false);

  const handleClick = () => {
    const popup = openOAuthPopup(authUrl);
    if (!popup) {
      setBlocked(true);
      return;
    }
    // ... proceed with popup flow
  };

  return (
    <>
      <button onClick={handleClick}>Connect Account</button>
      {blocked && (
        <div role="alert">
          <p>
            Your browser blocked the authentication window.
            Please allow popups for this site, or{" "}
            <a href={authUrl} target="_blank" rel="noopener noreferrer">
              open authentication in a new tab
            </a>.
          </p>
        </div>
      )}
    </>
  );
}
```

### Key Rules to Avoid Popup Blocking

1. **Open in direct click handler** -- `window.open()` must be called synchronously
   inside a user gesture (click, keypress). Any `await` before it breaks the gesture chain.
2. **Pre-fetch the auth URL** -- if you need to call an API for the URL, fetch it
   before the click (on hover, on mount) or open a blank popup first then navigate it:

```typescript
// Pattern: open blank popup synchronously, then navigate after async work
async function handleConnectClick() {
  // Open immediately in click handler to preserve user gesture
  const popup = window.open("about:blank", "oauth", "width=600,height=700");
  if (!popup) {
    setBlocked(true);
    return;
  }

  try {
    // Now do async work -- popup is already open
    const res = await fetch("/api/oauth/initiate", { method: "POST" });
    const { authUrl } = await res.json();

    // Navigate the already-open popup
    popup.location.href = authUrl;
  } catch (err) {
    popup.close();
    setError("Failed to initiate authentication");
  }
}
```

---

## 3. Security

### Origin Validation (CRITICAL)

```typescript
// RECEIVER side -- the parent window
window.addEventListener("message", (event: MessageEvent) => {
  // 1. Exact origin match -- NEVER use substring/regex/includes
  //    Bad:  event.origin.includes("agentplane")
  //    Bad:  event.origin.endsWith(".agentplane.com")
  //    Good: exact match against allowlist
  const ALLOWED_ORIGINS = new Set([
    "https://app.agentplane.com",
    "https://staging.agentplane.com",
  ]);

  if (!ALLOWED_ORIGINS.has(event.origin)) return;

  // 2. Validate message structure (defense in depth)
  if (event.data?.type !== "oauth_callback") return;
  if (typeof event.data.state !== "string") return;

  // 3. Validate state/nonce matches what we generated
  if (event.data.state !== expectedState) return;

  // 4. Process the message
  handleOAuthResult(event.data);
});
```

```typescript
// SENDER side -- the callback page in the popup
// ALWAYS specify exact targetOrigin
window.opener.postMessage(payload, "https://hostapp.example.com");

// For embedded components where host origin varies:
// Pass the host origin as a signed parameter in the OAuth state
const hostOrigin = decryptAndValidate(stateParam).hostOrigin;
window.opener.postMessage(payload, hostOrigin);
```

### CSRF Prevention

```typescript
// Before opening popup, generate cryptographic state
function generateOAuthState(hostOrigin: string): string {
  const state = {
    nonce: crypto.randomUUID(),
    hostOrigin,
    timestamp: Date.now(),
  };
  // Store for validation when message comes back
  sessionStorage.setItem("oauth_state", JSON.stringify(state));
  return btoa(JSON.stringify(state));
}

// In message handler, validate state matches
function validateState(receivedState: string): boolean {
  const stored = sessionStorage.getItem("oauth_state");
  if (!stored) return false;

  const expected = JSON.parse(stored);
  const received = JSON.parse(atob(receivedState));

  // Validate nonce
  if (received.nonce !== expected.nonce) return false;

  // Validate freshness (5 minute window)
  if (Date.now() - expected.timestamp > 5 * 60 * 1000) return false;

  // Clean up
  sessionStorage.removeItem("oauth_state");
  return true;
}
```

### Token Handling

```
NEVER pass access tokens or refresh tokens via postMessage.

Correct flow:
  1. Popup completes OAuth, callback page sends tokens to YOUR server
  2. Server stores tokens (encrypted at rest)
  3. postMessage only sends { success: true, connectionId: "..." }
  4. Parent component fetches updated state from your API

This way, tokens never transit through the host app's JavaScript context.
```

### Content Security Policy

```
If the embedded component's host app has strict CSP, the popup
to your domain still works because window.open() is not restricted
by frame-src or connect-src -- it opens a new top-level browsing context.

However, ensure your callback page's CSP allows inline scripts or
use a separate JS file for the postMessage logic.
```

---

## 4. Cross-Origin Communication

### postMessage vs MessageChannel

```
postMessage (window.postMessage):
  - Works across windows/tabs/popups
  - Broadcast model -- any script in the target window can listen
  - Origin validation is manual (check event.origin)
  - USE THIS for popup OAuth flows

MessageChannel:
  - Port-based, point-to-point communication
  - More secure (only holders of the port can communicate)
  - Cannot be used with popups that navigate to external URLs
    (the port reference is lost on navigation)
  - USE THIS for iframe-to-parent communication (long-lived)
```

### Handling COOP (Cross-Origin-Opener-Policy)

```
Problem: If your callback page or the OAuth provider sets
  Cross-Origin-Opener-Policy: same-origin
then window.opener becomes null in the popup, breaking postMessage.

Solutions:

1. Set COOP on your callback route to "unsafe-none" (Stripe does this):
   Cross-Origin-Opener-Policy: unsafe-none

2. Use localStorage event as fallback (Auth0's approach):
   - Popup writes to localStorage on your domain
   - Parent polls localStorage or listens to 'storage' event
   - Note: 'storage' event only fires in OTHER tabs, not the one
     that wrote -- so this only works for same-origin parent

3. Use server polling as ultimate fallback:
   - Popup completes auth, server records success
   - Parent polls server for auth completion status
   - Works regardless of COOP, but adds latency
```

```typescript
// Robust callback that handles missing opener
function sendAuthResult(result: OAuthResult, targetOrigin: string) {
  if (window.opener) {
    // Happy path: postMessage to parent
    window.opener.postMessage(
      { type: "oauth_callback", ...result },
      targetOrigin
    );
    setTimeout(() => window.close(), 300);
    return;
  }

  // Fallback: write to localStorage (works if same-origin parent)
  try {
    localStorage.setItem(
      "oauth_result",
      JSON.stringify({ ...result, timestamp: Date.now() })
    );
    setTimeout(() => window.close(), 300);
    return;
  } catch {
    // localStorage may be unavailable in some contexts
  }

  // Last resort: show manual message
  const el = document.getElementById("status");
  if (el) el.textContent = "Authentication complete. Please close this window and refresh.";
}
```

---

## 5. Real-World Examples

### How Major Services Handle This

| Service | Popup Pattern | Fallback | COOP Header | Token Transfer |
|---------|--------------|----------|-------------|----------------|
| **Clerk** | postMessage to parent | Redirect with return URL | unsafe-none | Server-side session; postMessage sends session token |
| **Auth0** | loginWithPopup() via winchan | localStorage + redirect | same-origin (causes issues) | Tokens in popup, exchanged via postMessage |
| **Firebase** | signInWithPopup() | signInWithRedirect() | Issues reported with same-origin COOP | Token in postMessage (same-origin) |
| **Stripe Connect** | Popup for auth in embedded components | Cannot eliminate popup | **unsafe-none** (documented requirement) | Server-side; popup only signals completion |
| **Google Identity** | Popup via GIS SDK | Redirect mode | restrict-properties support | Authorization code via postMessage |

### Stripe Connect: Key Insight

Stripe explicitly documents that embedded components require:
```
Cross-Origin-Opener-Policy: unsafe-none
```
Other values such as `same-origin` **break user authentication** in Connect
embedded components. This is the most practical real-world validation that
`unsafe-none` is necessary for popup-based OAuth in embedded contexts.

### Auth0: Cautionary Tale

Auth0 has ongoing community issues with `loginWithPopup()` breaking when hosts
set `Cross-Origin-Opener-Policy: same-origin`. Their winchan library tries to
check `window.closed` on the popup, which is blocked by COOP. Auth0 now
recommends redirect-based flows for cross-origin isolation scenarios and
disabled cross-origin embedded login by default (October 2024).

### Firebase: Dual Strategy

Firebase offers both `signInWithPopup()` and `signInWithRedirect()`. Their
documentation recommends using redirect on mobile (popup blockers more aggressive)
and popup on desktop. They use same-origin postMessage, which avoids cross-origin
complications but limits the embedded component use case.

---

## 6. Browser Compatibility

### Safari ITP (Intelligent Tracking Prevention)

```
Impact on popup OAuth:
  - Popup windows to your domain work fine (top-level navigation)
  - Third-party cookies in the popup are blocked since Safari 13.1
  - Storage in the popup IS first-party (your domain is in the address bar)
  - postMessage from popup to parent works regardless of ITP

Key point: The popup pattern AVOIDS most ITP issues because the popup
is a first-party context for your domain. This is a major advantage
over iframe-based approaches.
```

### Storage Partitioning (All Browsers 2025+)

```
Cookies set in third-party iframes are now partitioned by the
embedding site. This does NOT affect the popup pattern because:

  1. Popup is a top-level browsing context (not partitioned)
  2. Cookies set during OAuth in the popup are first-party
  3. localStorage in the popup is your domain's unpartitioned storage

However, if you try to access those cookies later from an iframe
embedded in the host app, they will be in a different partition.
Solution: use the popup pattern for ALL auth-requiring operations,
or use the Storage Access API for iframe contexts.
```

### CHIPS (Cookies Having Independent Partitioned State)

```
Safari 18.4+ supports the Partitioned cookie attribute.
If you need to maintain session state in an embedded iframe AFTER
the popup auth completes:

  Set-Cookie: session=abc; Secure; SameSite=None; Partitioned

This cookie will be accessible in your iframe when embedded in the
host app, but partitioned per-host (agentco.com gets a different
partition than other hosts embedding your component).
```

### Browser Support Matrix

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| window.open popup | Yes | Yes | Yes | Yes |
| postMessage cross-origin | Yes | Yes | Yes | Yes |
| window.opener (no COOP) | Yes | Yes | Yes | Yes |
| window.opener (COOP: unsafe-none) | Yes | Yes | Yes | Yes |
| window.closed polling | Yes | Yes | Yes* | Yes |
| Storage Access API | Yes | Yes | Yes | Yes |
| CHIPS (Partitioned cookies) | Yes | Yes | 18.4+ | Yes |

*Safari may restrict window.closed access in some COOP configurations.

---

## 7. Recommendations for AgentPlane

### Current Implementation Issues

The existing code at `connectors-manager.tsx` has several gaps:

```typescript
// Current code (simplified):
const popup = window.open(data.redirectUrl, "mcp-oauth", "width=600,height=700");
const handler = (event: MessageEvent) => {
  if (event.data?.type === "agent_plane_mcp_oauth_callback") {
    popup?.close();
    window.removeEventListener("message", handler);
    loadMcp();
  }
};
```

Issues:
1. **No popup blocker detection** -- if popup is null, the flow silently fails
2. **No origin validation** -- event.origin is never checked (security vulnerability)
3. **No state/nonce validation** -- no CSRF protection on the postMessage
4. **No user-closed-popup detection** -- no polling for popup.closed
5. **The callback page uses wildcard as targetOrigin** -- sends message to any origin
6. **Async fetch before window.open** -- the fetch() for the redirect URL happens
   before window.open(), which may break the user gesture chain on strict browsers

### Recommended Changes

1. **Open blank popup first, then navigate** (prevents popup blocking)
2. **Add origin validation** on the message receiver
3. **Include state parameter** that is validated on receipt
4. **Set explicit targetOrigin** in callback page postMessage
5. **Poll popup.closed** to detect user cancellation
6. **Add fallback UI** when popup is blocked
7. **Set Cross-Origin-Opener-Policy: unsafe-none** on callback routes
   (critical for embedded component scenario where host may set strict COOP)

### For the Embedded Component (AgentCo) Scenario

When your React component is embedded in a host app at a different origin:

```
agentco.com (host)                    agentplane.com (your domain)
+----------------------+              +-----------------------------+
| <AgentPlaneWidget /> |              |                             |
|   |                  |              |  /oauth/initiate            |
|   +-> window.open() -+--------------+-> Starts OAuth flow        |
|   |                  |              |   Redirects to provider     |
|   |                  |              |                             |
|   |                  |              |  /oauth/callback            |
|   |                  |              |   Receives OAuth code       |
|   |                  |              |   Exchanges for tokens      |
|   <-- postMessage ---+--------------+-> Stores tokens server-side |
|   |                  |              |   Sends {success} message   |
|   +-> Update UI      |              |   postMessage(targetOrigin) |
|   |                  |              |                             |
+----------------------+              +-----------------------------+

Key: Tokens NEVER cross the origin boundary. Only a success
signal and connection ID are sent via postMessage.
```

The host app origin must be passed through the OAuth state parameter
(signed server-side) so the callback page knows the correct
targetOrigin for postMessage. This prevents the callback from
broadcasting sensitive data to any origin.

---

## Sources

- [IETF Draft: OAuth 2.0 Web Message Response Mode](https://www.ietf.org/archive/id/draft-meyerzuselha-oauth-web-message-response-mode-01.html)
- [MDN: Window.postMessage()](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)
- [MDN: Cross-Origin-Opener-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Opener-Policy)
- [Chrome: COOP restrict-properties](https://developer.chrome.com/blog/coop-restrict-properties)
- [postMessage.dev: Complete Guide to postMessage Security](https://postmessage.dev/)
- [Stripe: Connect Embedded Components](https://docs.stripe.com/connect/get-started-connect-embedded-components)
- [Auth0 loginWithPopup COOP issues](https://community.auth0.com/t/loginwithpopup-cross-origin-opener-policy-policy-would-block-the-window-closed-call/191909)
- [Firebase signInWithPopup COOP issues](https://github.com/firebase/firebase-js-sdk/issues/8541)
- [Auth0 crossOriginIsolated workaround](https://keliris.dev/articles/auth0-and-crossoriginisolated/)
- [WebKit: Full Third-Party Cookie Blocking](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)
- [Smashing Magazine: Detecting Third-Party Cookie Blocking in 2025](https://www.smashingmagazine.com/2025/05/reliably-detecting-third-party-cookie-blocking-2025/)
- [Microsoft: Handle third-party cookie blocking in SPAs](https://learn.microsoft.com/en-us/entra/identity-platform/reference-third-party-cookies-spas)
- [DEV.to: OAuth Popup Practical Guide](https://dev.to/didof/oauth-popup-practical-guide-57l9)
- [DEV.to: Popup for Google and Outlook OAuth](https://dev.to/dinkydani21/how-we-use-a-popup-for-google-and-outlook-oauth-oci)
- [Security of Social Logins: PostMessage in SSO](https://web-in-security.blogspot.com/2021/02/security-and-privacy-of-social-logins-part2.html)
- [OWASP: CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
