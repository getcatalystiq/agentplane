# Embeddable React Component Library - Flow Analysis

## User Flow Overview

### Flow 1: Developer Installation & Configuration
1. Developer installs `@getcatalystiq/agent-plane-ui` via npm
2. Imports components and wraps them in a provider with SDK client + theme config
3. Integrates components into host app's routing (React Router, Next.js, etc.)
4. Components render inside host layout, filling content area

### Flow 2: Tenant Provisioning
1. AgentCo server provisions tenant via SDK (`POST /api/tenants`)
2. Stores tenant ID + API key securely (server-side)
3. Initializes `AgentPlane` SDK client with tenant-scoped API key
4. Passes SDK client to UI provider/components

### Flow 3: Page Rendering
1. Component mounts, fetches data via SDK client (e.g., `client.agents.list()`)
2. Renders loading skeleton, then data
3. User interacts (create, edit, delete)
4. Component calls SDK method, updates local state or refetches

### Flow 4: Cross-Page Navigation
1. User clicks link within embedded component (e.g., agent list -> agent detail)
2. Component fires navigation event
3. Host app's router handles the route change
4. New component renders with route params

### Flow 5: Agent CRUD
1. User views agent list (SDK `agents.list()`)
2. Creates agent via form (SDK `agents.create()`)
3. Navigates to agent detail (tabs: General, Runs, Connectors, Skills, Plugins, Schedules)
4. Edits agent fields (SDK `agents.update()`)
5. Deletes agent (SDK `agents.delete()`)

### Flow 6: Run Transcript Viewing
1. User navigates to run list or agent runs tab
2. Clicks run to see detail (SDK `runs.get()` + `runs.transcript()`)
3. Transcript viewer renders markdown with tool call/result blocks
4. Live runs stream NDJSON events (SDK `RunStream`)

### Flow 7: MCP Server OAuth Connection
1. User views connectors tab on agent detail
2. Clicks "Connect" on an MCP server
3. SDK returns OAuth redirect URL (`customConnectors.initiateOauth()`)
4. Browser redirects to OAuth provider
5. Provider redirects back to callback URL
6. Connection status updates

### Flow 8: Plugin Marketplace Management
1. User views plugin marketplaces list (SDK `pluginMarketplaces.list()`)
2. Browses available plugins (SDK `pluginMarketplaces.listPlugins()`)
3. Adds plugin to agent (SDK `agents.plugins.add()`)
4. Views/edits plugin files in CodeMirror editor

### Flow 9: Theme Application
1. Host app sets theme via CSS variables or theme prop
2. Components read CSS custom properties for all colors
3. Theme changes (light/dark toggle) propagate instantly

### Flow 10: Auth Error Handling
1. SDK client makes request with expired/invalid key
2. `AgentPlaneError` thrown with status 401/403
3. Component catches error, displays inline message
4. Host app optionally intercepts via error callback to refresh credentials

---

## Flow Permutations Matrix

| Flow | First-Time User | Returning User | Error State | Offline |
|---|---|---|---|---|
| Agent List | Empty state (no agents) | Paginated list | 401/500 error banner | Cached stale data or error |
| Agent Create | Fresh form | Pre-filled from template? | Validation errors inline | Cannot submit |
| Agent Detail | All tabs available | Last-used tab remembered? | Agent not found (404) | Stale cached data |
| Run List | Empty state | Filtered + paginated | Failed to load | N/A (always needs fresh) |
| Run Streaming | First stream experience | Familiar with events | Stream disconnect/detach | Cannot start run |
| OAuth Connect | No connections yet | Re-auth expired token | OAuth provider error | Cannot initiate |
| Plugin Browse | Empty marketplace | Installed plugins marked | GitHub fetch failure | Cached plugin list? |
| Theme Switch | Default theme applied | Persisted preference | Invalid CSS vars (fallback) | N/A |

---

## Missing Elements & Gaps

### Category: SDK API Coverage

**Gap 1: No admin-level SDK methods.**
The current SDK uses tenant-scoped API keys (`/api/agents`, `/api/runs`), but admin pages call `/api/admin/*` endpoints (agents, runs, tenants, MCP servers, plugin marketplaces, models, composio). The SDK has zero admin resource classes.

- Impact: CRITICAL. Every admin page queries `/api/admin/*` routes. Without admin SDK methods, no page can function.
- Current Ambiguity: Should the UI library target admin endpoints or tenant endpoints? Admin endpoints are cross-tenant (global view); tenant endpoints are scoped. AgentCo embedding a single tenant's view could use tenant endpoints, but admin pages show cross-tenant data (dashboard stats, tenant list, all agents across tenants).

**Gap 2: No model catalog SDK method.**
`ModelSelector` fetches `/api/admin/models` directly. No SDK equivalent exists.

- Impact: HIGH. Agent create/edit form cannot populate the model dropdown without this.
- Assumption if unresolved: Add `client.models.list()` to SDK.

**Gap 3: No dashboard statistics SDK method.**
Dashboard page runs raw SQL aggregations (tenant count, agent count, total runs, active runs, total spend, daily stats per agent). No API endpoint or SDK method exists for this.

- Impact: HIGH. Dashboard page cannot render without aggregate stats.
- Assumption if unresolved: Create `/api/admin/stats` endpoint + SDK method, or skip dashboard for embedded use.

**Gap 4: No MCP server CRUD in tenant SDK.**
MCP server management (`/api/admin/mcp-servers`) is admin-only. The tenant SDK only has `customConnectors.listServers()` (read-only). Creating/updating/deleting MCP servers has no tenant-facing API.

- Impact: MEDIUM. If embedded UI should allow MCP server management, new endpoints needed.

**Gap 5: No plugin marketplace CRUD in tenant SDK.**
`pluginMarketplaces` resource only has `list()` and `listPlugins()`. Creating/editing/deleting marketplaces requires admin endpoints. Plugin file editing (`PUT /api/admin/plugin-marketplaces/:id/plugins/:name/files`) has no SDK method.

- Impact: MEDIUM. Plugin marketplace management page and plugin editor cannot function.

**Gap 6: No schedule management in SDK.**
Agent schedules are managed via agent update (schedule columns on agent table) but `ScheduleEditor` component fetches from a schedules table. The SDK `agents.update()` has no schedule params in `UpdateAgentParams`.

- Impact: MEDIUM. Schedule tab on agent detail is non-functional.

**Gap 7: No tenant self-management in SDK.**
Tenant CRUD (`/api/admin/tenants`) is admin-only. The SDK has no `tenants` resource. Settings page needs tenant read/update. Only `GET /api/tenants/me` exists for self-service.

- Impact: MEDIUM. Settings page cannot edit tenant details (name, timezone, budget).

### Category: Routing & Navigation

**Gap 8: Hard-coded Next.js navigation.**
- `SidebarNav` uses `next/link` and `usePathname()` with paths like `/admin`, `/admin/agents`, `/admin/runs`
- Agent detail, run detail, tenant detail pages use `next/link` for cross-references
- `notFound()` from `next/navigation` used in server components
- `useRouter().push()` used in client components after create/delete operations

- Impact: CRITICAL. Components cannot use `next/link` or `next/navigation` in a non-Next.js host. Even in a Next.js host, paths would conflict (`/admin/*` vs host app's routes).
- Question: What abstraction should replace Next.js routing? Options: (a) render props for links, (b) a `RouterAdapter` interface, (c) configurable base path + generic `<a>` tags with onClick handlers.

**Gap 9: No configurable base path.**
All navigation links are absolute (`/admin/agents/[id]`). The host app may mount the component library at a different path (e.g., `/settings/agents/[id]`).

- Impact: HIGH. Navigation breaks if host app uses different URL structure.

**Gap 10: Back navigation and breadcrumbs.**
Detail pages use `DetailPageHeader` with back links. These reference specific admin paths. No abstraction for breadcrumb/back navigation exists.

- Impact: MEDIUM. Breadcrumbs will point to wrong URLs.

### Category: Server Components to Client Components

**Gap 11: 14 pages are React Server Components with direct DB queries.**
Every `page.tsx` in the admin dashboard is a server component that imports from `@/db` and runs raw SQL. These include: dashboard, agents list, agent detail, runs list, run detail, tenants list, tenant detail, MCP servers, plugin marketplaces, marketplace detail, plugin editor, playground, settings.

- Impact: CRITICAL. The entire page layer must be rewritten as client components that fetch via SDK.
- Scale: ~14 page components, each with 1-5 DB queries that need SDK equivalents.

**Gap 12: Zod validation schemas are DB-specific.**
Pages import `AgentRow`, `TenantRow`, `RunRow`, etc., from `@/lib/validation` which validate raw DB row shapes. SDK returns different shapes (e.g., SDK `Agent` type vs DB `AgentRow`).

- Impact: HIGH. Type mismatches between DB row schemas and SDK response types.

### Category: OAuth & Redirect Flows

**Gap 13: OAuth callback URL mismatch.**
Composio OAuth callback goes to `/api/agents/:id/connectors/:toolkit/callback` on the AgentPlane domain. MCP OAuth callback goes to `/api/mcp-servers/:id/callback`. When embedded in AgentCo, the browser is on AgentCo's domain, but callbacks must hit AgentPlane's domain.

- Impact: CRITICAL. OAuth flows break if the callback URL doesn't match the registered redirect URI.
- Question: How should OAuth redirects work? Options: (a) popup window pointing to AgentPlane domain, (b) redirect to AgentPlane then back to AgentCo, (c) proxy callbacks through AgentCo.

**Gap 14: Post-OAuth redirect destination.**
After OAuth completes, where does the user land? Currently the callback redirects to the admin agent detail page. In embedded mode, it should return to AgentCo's page.

- Impact: HIGH. User gets stranded on AgentPlane after OAuth completion.

### Category: Theming & Styling

**Gap 15: CSS variable naming assumes globals.css loaded.**
Components reference CSS variables like `--background`, `--foreground`, `--border`, `--primary`, etc. These are defined in AgentPlane's `globals.css` with oklch values. The host app must either: (a) load AgentPlane's CSS vars, (b) define compatible CSS vars, or (c) receive a theme object that maps to inline styles.

- Impact: HIGH. Components render with no colors if CSS vars are missing.
- Question: Should the library ship a default stylesheet? Should it use a CSS-in-JS approach for isolation?

**Gap 16: Tailwind v4 dark mode variant.**
Dark mode uses `@variant dark (&:where(.dark, .dark *))` in globals.css. The host app may have its own dark mode mechanism (class-based, media query, or different class name).

- Impact: MEDIUM. Dark mode may not work or may conflict with host app's dark mode.

**Gap 17: CSS class collisions.**
Tailwind utility classes and custom component classes may collide with host app's CSS. No scoping or CSS modules used.

- Impact: MEDIUM. Visual glitches from class name conflicts.
- Question: Should the library use a Tailwind prefix (e.g., `ap-`) or CSS layers for isolation?

### Category: Dependencies & Bundle

**Gap 18: Heavy dependency footprint.**
The library would pull in: cmdk, @radix-ui/react-popover, @radix-ui/react-dialog, @radix-ui/react-tabs, codemirror (6 packages), recharts, react-markdown, remark-gfm, dompurify, lucide-react, zod. Many of these may conflict with host app versions.

- Impact: HIGH. Bundle size bloat and potential version conflicts.
- Question: Should heavy components (CodeMirror editor, Recharts) be lazy-loaded or offered as separate entry points?

**Gap 19: Peer dependency strategy undefined.**
React, React DOM versions must align. What about zod, lucide-react, radix packages?

- Impact: MEDIUM. Version mismatches cause runtime errors.

### Category: Streaming & Real-time

**Gap 20: Playground/session streaming in embedded context.**
The playground page creates sessions and streams NDJSON responses. The SDK supports this via `RunStream`. But the playground page currently uses server-side session creation, then client-side message sending via fetch to `/api/admin/sessions/:id/messages`.

- Impact: HIGH. Playground must be fully client-side, using SDK session methods.

**Gap 21: Run streaming lifecycle.**
Live run viewing streams NDJSON from `/api/runs/:id` (status endpoint). The SDK has `runs.get()` but no streaming status method. The `runs.create()` returns a stream, but viewing an existing run's live stream has no SDK method.

- Impact: MEDIUM. Cannot watch a running run's live output.

### Category: Multi-Tenancy & Authorization

**Gap 22: Admin vs. tenant scope ambiguity.**
The spec says "all admin pages exposed" but the SDK uses tenant-scoped API keys. Admin pages show cross-tenant data. If embedded in AgentCo for a single tenant, should the UI show: (a) only that tenant's data (tenant-scoped), or (b) all data (admin-scoped)?

- Impact: CRITICAL. Determines whether we need admin API key support in SDK or restructure all pages for tenant scope.

**Gap 23: Tenant list/creation page relevance.**
If embedded for a single tenant, the Tenants list page is irrelevant. AgentCo manages its own tenants.

- Impact: LOW. May just exclude from exported components.

### Category: Error Handling & Loading States

**Gap 24: No error boundary strategy.**
When SDK calls fail (network error, 500, rate limit), how should components behave? Currently server components use `notFound()` for missing resources. Client components have ad-hoc error handling.

- Impact: HIGH. No consistent error recovery pattern.
- Question: Should the library provide an `<AgentPlaneErrorBoundary>` with retry? Should it expose `onError` callbacks?

**Gap 25: Loading state consistency.**
Current pages use Next.js `loading.tsx` files for Suspense boundaries. Embedded components need their own loading/skeleton states.

- Impact: MEDIUM. Components show blank during data fetching without proper loading states.

### Category: Playground-Specific

**Gap 26: Playground page is a server component that creates sessions server-side.**
The playground creates a session via admin API, then renders a client component for chat. In embedded mode, session creation must happen client-side via SDK.

- Impact: HIGH. Playground flow needs complete restructuring.

**Gap 27: Playground sandbox lifecycle not exposed via SDK.**
Session sandbox warm-up, idle timeout (10 min), and reconnection are transparent to the SDK user but affect UX (first message latency). No SDK method to check sandbox status.

- Impact: LOW. UX concern only; SDK handles it transparently.

---

## Critical Questions Requiring Clarification

### Critical (Blocks Implementation)

**Q1: Admin-scoped or tenant-scoped?**
Should the embedded UI use admin API endpoints (cross-tenant, requires ADMIN_API_KEY) or tenant-scoped endpoints (single tenant, uses tenant API key)? This determines whether ~20 new admin SDK methods are needed or ~14 pages are redesigned for tenant scope.
- Default assumption: Tenant-scoped, since AgentCo provisions per-tenant and shouldn't expose admin keys to the browser.
- Impact: If tenant-scoped, dashboard page (cross-tenant stats), tenant list/detail, and MCP server CRUD are excluded or need new tenant-facing endpoints.

**Q2: Which pages are actually needed for AgentCo embedding?**
The spec says "all admin pages" but AgentCo likely doesn't need: tenant list/creation, dashboard with cross-tenant stats, MCP server CRUD (admin-managed). What is the minimum set?
- Likely needed: Agent list/detail (with all tabs), run list/detail, plugin marketplace browse, settings (single tenant).
- Likely excluded: Tenant list, dashboard overview, MCP server CRUD.
- Impact: Reduces scope significantly if confirmed.

**Q3: How should OAuth redirect flows work in embedded context?**
Composio and MCP OAuth callbacks currently redirect to AgentPlane's domain. When UI is embedded in AgentCo on a different domain, the callback URL registered with OAuth providers won't match AgentCo's domain. Options: (a) open OAuth in a popup window targeting AgentPlane, (b) register AgentCo's domain as an additional redirect URI, (c) proxy through AgentCo.
- Default assumption: Popup window approach (simplest, no provider re-registration needed).
- Impact: Affects connector manager component design.

**Q4: How should cross-component navigation work without Next.js router?**
Components use `next/link`, `useRouter()`, `usePathname()`. The host app may use React Router, Next.js, or a custom router. Options: (a) `RouterAdapter` interface with `navigate()`, `Link` component, `useCurrentPath()`, (b) render prop for links, (c) event-based (component emits navigation intents, host app handles).
- Default assumption: `RouterAdapter` interface injected via context provider.
- Impact: Every component with internal links must be refactored.

### Important (Affects UX/Maintainability)

**Q5: Should the library ship its own CSS or rely on host app's CSS variables?**
If it ships CSS: potential conflicts. If it relies on host vars: host must define ~30 CSS custom properties correctly.
- Default assumption: Ship a default CSS file with all variables; allow override via theme prop.

**Q6: Should heavy dependencies be tree-shakeable / lazy-loaded?**
CodeMirror (~200KB), Recharts (~150KB), react-markdown are heavy. Not all pages use all of them.
- Default assumption: Separate entry points per page (`@getcatalystiq/agent-plane-ui/agents`, `/runs`, etc.) with dynamic imports for heavy deps.

**Q7: How should the library handle API key security in the browser?**
The SDK client requires an API key. Passing a tenant API key to browser-side components exposes it. Should the library support a proxy pattern where API calls go through the host app's backend?
- Default assumption: Host app provides a custom `fetch` to the SDK that adds auth server-side, or uses a short-lived token.
- Impact: Security risk if tenant API key is exposed in client bundle.

**Q8: What is the versioning/release strategy?**
Should the UI library version be coupled to the SDK version? To the API version?
- Default assumption: Independent semver, with peer dependency on SDK version range.

### Nice-to-Have (Improves Clarity)

**Q9: Should components support SSR in the host app?**
All extracted components will be client-only (`"use client"`). If the host app uses SSR, components will only render after hydration. Is this acceptable?
- Default assumption: Client-only is acceptable; SSR support is out of scope.

**Q10: Should the library support multiple instances (multiple tenants) on one page?**
Could AgentCo render two AgentPlane providers with different SDK clients side by side?
- Default assumption: Single instance per page. Multiple instances are out of scope.

**Q11: Should the library export individual sub-components (Button, Card, Table) or only page-level components?**
Exporting primitives increases API surface but gives host app flexibility.
- Default assumption: Page-level only; primitives are internal.

---

## Recommended Next Steps

1. **Decide admin vs. tenant scope (Q1, Q2).** This is the single highest-leverage decision. It determines which pages are extractable, which SDK methods are needed, and whether new API endpoints must be built. Recommend: tenant-scoped, exclude dashboard/tenants, add ~8 new tenant-facing API endpoints.

2. **Audit and extend SDK for missing methods.** Based on scope decision, add: model catalog listing, tenant self-update, schedule CRUD, run streaming (watch existing run), plugin marketplace mutations (if needed). Estimate: 6-10 new SDK methods.

3. **Design the RouterAdapter interface.** Define `navigate(path)`, `Link` component, `useCurrentPath()`, `basePath` config. Prototype with one page (agent list -> agent detail) to validate.

4. **Design OAuth popup flow.** Prototype Composio OAuth in a popup window that targets AgentPlane's domain and posts result back via `postMessage`. Validate with one connector.

5. **Create theming contract.** Document the ~30 CSS custom properties the host app must define. Ship a default stylesheet. Consider Tailwind prefix for isolation.

6. **Prototype one page end-to-end.** Convert Agent List page from server component (DB queries) to client component (SDK calls). Integrate into a test host app. Validate routing, theming, error handling, loading states.

7. **Define bundle strategy.** Separate entry points per page family. Lazy-load CodeMirror and Recharts. Measure bundle size.

8. **Address API key security (Q7).** Design the proxy/token pattern for browser-safe auth before any component ships.
