# Performance Analysis: Admin UI Component Library Extraction

## 1. Bundle Size

### Dependency weight (minified + gzipped estimates from bundlephobia data)

| Dependency | Raw disk | Min+gzip estimate | Notes |
|---|---|---|---|
| recharts | 6.2 MB | ~50 KB | Only used in `run-charts.tsx` |
| @uiw/react-codemirror + langs | ~2 MB | ~120 KB | Only used in `plugin-editor-client.tsx` |
| lucide-react | 35 MB (all icons) | ~2 KB per icon | Tree-shakeable; ~12 icons used = ~24 KB |
| react-markdown + remark-gfm | 72 KB | ~12 KB | Used in `transcript-viewer.tsx` |
| dompurify | 814 KB | ~14 KB | Used with react-markdown |
| tailwind-merge | 918 KB | ~6 KB | Every component |
| clsx | 8 KB | <1 KB | Every component |
| cmdk | 80 KB | ~4 KB | Only `model-selector.tsx` |
| @radix-ui/react-popover | 89 KB | ~4 KB | Only `model-selector.tsx` |

**Total if everything is in one bundle: ~235 KB min+gzip**

This is far too large for a single entry point. The heavy hitters (Recharts, CodeMirror) are each used by exactly ONE component.

### Recommendation: Separate entry points

```
@agentplane/ui/primitives     → ~35 KB (badge, button, card, dialog, input, select, tabs, etc.)
@agentplane/ui/charts         → ~55 KB (Recharts + RunCharts)
@agentplane/ui/editor         → ~125 KB (CodeMirror + FileTreeEditor)
@agentplane/ui/transcript     → ~30 KB (react-markdown + dompurify + TranscriptViewer)
@agentplane/ui/model-selector → ~10 KB (cmdk + Radix Popover)
@agentplane/ui/pages          → ~15 KB (page components, thin wrappers)
```

With separate entry points, a consumer using only list pages + detail pages loads ~50 KB instead of ~235 KB. That is a 4.7x reduction.

### tsup tree-shaking concern

tsup uses esbuild under the hood. Barrel exports (`index.ts` re-exporting everything) **defeat tree-shaking** for CommonJS output and degrade it for ESM when:
- Components have side effects at module scope (CSS imports, global registrations)
- Consumers use CommonJS require()

**Mitigation:**
- Set `"sideEffects": false` in `package.json`
- Use `tsup` with `splitting: true` and ESM-only output (or dual with `treeshake: true`)
- Add `exports` map in `package.json` pointing to individual entry chunks
- Consider `@rollup/plugin-preserve-modules` if switching to rollup for better tree-shaking guarantees

---

## 2. Data Fetching Overhead (RSC to Client-Side)

### Current state: 13 page components use direct DB queries via RSC

The dashboard page runs 2 SQL queries via `Promise.all()` with zero HTTP overhead. In the library, the call chain becomes:

```
Component mount -> SDK fetch() -> HTTPS TLS handshake -> API route -> auth middleware -> DB query -> JSON serialize -> network -> JSON parse -> render
```

**Estimated latency impact per page load:**

| Stage | Current (RSC) | Library (SDK) |
|---|---|---|
| TLS handshake | 0 ms | 50-150 ms (first request) |
| HTTP round trip | 0 ms | 30-80 ms |
| Auth middleware | 0 ms | 5-10 ms |
| DB query | 5-20 ms | 5-20 ms (unchanged) |
| JSON serialization | 0 ms | 1-3 ms |
| **Total** | **5-20 ms** | **90-260 ms** |

First page load degrades by **70-240 ms**. Subsequent requests benefit from HTTP keep-alive (saving TLS), bringing it to ~40-100 ms overhead.

### Recommendations

1. **SWR/TanStack Query is mandatory.** Every page fetch should use stale-while-revalidate:
   - Show cached data instantly on navigation
   - Revalidate in background
   - Reduces perceived latency to near-zero for repeat visits

2. **Prefetch on hover.** Link components should trigger `prefetch()` on `mouseenter` (200-300 ms head start).

3. **Parallel fetches.** Pages like the dashboard that run 2+ queries must fire them in parallel via `Promise.all()` in the SDK layer. Do NOT serialize them.

4. **SDK connection pooling.** The SDK client should use `keepalive: true` on fetch to reuse TCP connections.

---

## 3. Initial Load Strategy

### Problem
13 RSC pages become 13 client-side pages that show blank/skeleton on first mount.

### Recommendations

1. **Skeleton components per page** (already have `loading.tsx` files for 6 pages). Convert these to reusable skeleton variants exported from the library.

2. **Optimistic navigation.** Use the router to start fetching data BEFORE the page component mounts (via route-level loader or prefetch).

3. **Critical path prioritization.** Dashboard page needs 2 queries -- fetch stats first (small payload, renders above fold), charts second (larger payload, below fold). Structure the SDK calls to stream partial results:

```typescript
// Bad: wait for everything
const { stats, charts } = await sdk.dashboard.getAll();

// Good: render progressively
const statsPromise = sdk.runs.getStats();
const chartsPromise = sdk.runs.getDailyStats();
// Render stats as soon as available, charts load independently
```

4. **SSR escape hatch.** For consumers using Next.js, export async server-compatible data loaders alongside client components so they can opt back into RSC-like performance:

```typescript
// Library exports both
export { DashboardPage } from './pages/dashboard';
export { fetchDashboardData } from './loaders/dashboard';
```

---

## 4. Re-render Risk from Provider Pattern

### Architecture

```
<AgentPlaneProvider client={sdk} router={router}>
  <PageComponent />
</AgentPlaneProvider>
```

### Risk assessment

If the provider stores `{ client, router, currentTenant }` in a single context, **every tenant switch re-renders the entire tree**, including heavy components like CodeMirror and Recharts.

### Recommendations

1. **Split contexts.** Separate static values (SDK client) from dynamic values (current tenant, router state):

```typescript
// Never changes after init -- no re-renders
const ClientContext = createContext<AgentPlaneClient>(null);

// Changes on tenant switch -- triggers re-render only for consumers
const TenantContext = createContext<TenantState>(null);

// Router state -- only consumed by navigation components
const RouterContext = createContext<RouterAdapter>(null);
```

2. **Memoize page components.** Wrap page-level components in `React.memo()` so they only re-render when their specific props/data change.

3. **useSyncExternalStore for SDK state.** If the SDK client has mutable state (e.g., cached responses), expose it via `useSyncExternalStore` to avoid unnecessary context propagation.

---

## 5. CSS / Critical Path Impact

### Current: Tailwind v4 with `.dark` variant

Shipping a `theme.css` with CSS variables is the right approach.

### Size estimate
- CSS variables file (colors, spacing, radii, shadows): ~2-3 KB uncompressed, <1 KB gzipped
- Consumer still needs their own Tailwind build (class names come from the library components)

### Concern: Flash of Unstyled Content (FOUC)
If `theme.css` loads async or is not in the critical path, components render with missing variables for 1-2 frames.

### Recommendations

1. **Inline critical CSS variables in the provider.** Inject a `<style>` tag from `AgentPlaneProvider` with the CSS variables. Zero-latency, no FOUC, no extra HTTP request.

2. **Ship a Tailwind v4 preset** (not a full CSS file) so consumers can `@import "@agentplane/ui/preset"` in their own Tailwind config. This ensures classes compile correctly without duplicating Tailwind output.

3. **Avoid `@import` in component files.** All CSS should come from the preset or the provider injection, never from individual component imports (which break code-splitting).

---

## 6. Tree-Shaking Effectiveness with tsup

### Barrel export problem

```typescript
// index.ts
export * from './button';
export * from './card';
export * from './transcript-viewer'; // pulls in react-markdown + dompurify
export * from './file-tree-editor';  // pulls in CodeMirror
export * from './run-charts';        // pulls in Recharts
```

If a consumer does `import { Button } from '@agentplane/ui'`, esbuild/webpack MAY still include CodeMirror and Recharts in the bundle because:
- The barrel file executes all module-level code
- CommonJS consumers get the entire bundle
- Some bundlers cannot statically analyze re-exports through barrel files

### Measured risk: HIGH
CodeMirror (120 KB) + Recharts (50 KB) would be pulled into every consumer even if unused. That is 170 KB of dead code.

### Recommendations

1. **Mandatory: Use package.json `exports` map with separate entry points:**

```json
{
  "exports": {
    ".": "./dist/primitives/index.mjs",
    "./charts": "./dist/charts/index.mjs",
    "./editor": "./dist/editor/index.mjs",
    "./transcript": "./dist/transcript/index.mjs",
    "./pages/*": "./dist/pages/*/index.mjs"
  },
  "sideEffects": false
}
```

2. **tsup config: multiple entry points, not one barrel:**

```typescript
export default defineConfig({
  entry: {
    'primitives/index': 'src/primitives/index.ts',
    'charts/index': 'src/charts/index.ts',
    'editor/index': 'src/editor/index.ts',
    'transcript/index': 'src/transcript/index.ts',
  },
  format: ['esm'],
  splitting: true,
  treeshake: true,
  external: ['react', 'react-dom', 'recharts', '@uiw/react-codemirror'],
});
```

3. **Mark heavy deps as peerDependencies.** Recharts, CodeMirror, react-markdown should be `peerDependencies` so consumers only install what they use.

---

## 7. Memory Concerns

### TranscriptViewer
- Renders full agent transcripts as markdown. Large runs can produce 50-100 KB of markdown.
- `react-markdown` creates a React element tree proportional to document size.
- With `dompurify` sanitization, the raw HTML string is also held in memory.
- **Estimate:** A 100 KB transcript produces ~2-3 MB of React elements + DOM nodes.

### CodeMirror
- Each CodeMirror instance allocates ~5-8 MB for the editor state, syntax tree, and view.
- The plugin editor can open multiple files. If each tab creates a new CodeMirror instance without destroying the old one, memory grows linearly.

### Recharts
- Moderate: ~1-2 MB for a typical chart with 30 days of data across 5 agents.

### Risk scenario
A user navigates: Dashboard (Recharts) -> Agent Detail (could load transcript) -> Plugin Editor (CodeMirror). If the router keeps all three mounted (SPA behavior), peak memory is ~15-20 MB from these components alone.

### Recommendations

1. **Virtualize transcript rendering.** For transcripts > 50 items, use windowed rendering (e.g., `react-window`) to only render visible conversation items. This caps DOM nodes regardless of transcript size.

2. **Lazy-mount CodeMirror.** Only instantiate the editor when a file tab is selected. Destroy instances for tabs that are not visible. Use `React.lazy()` for the CodeMirror component itself.

3. **Unmount on navigation.** The router adapter MUST unmount previous page components on navigation, not keep them in a stack. This is the default behavior for most React routers but must be verified.

4. **Transcript pagination.** Add a "load more" pattern for transcripts with > 100 events. Initial render shows the last 50 events (most relevant), with a button to load earlier events.

---

## Priority Matrix

| Issue | Impact | Effort | Priority |
|---|---|---|---|
| Separate entry points (tree-shaking) | Saves 170 KB for most consumers | Medium | P0 |
| SWR/caching layer | 100-200 ms latency savings per navigation | Medium | P0 |
| Split provider contexts | Prevents full-tree re-renders | Low | P1 |
| Virtualized transcript rendering | Prevents DOM bloat on large transcripts | Medium | P1 |
| Parallel SDK fetches | 30-80 ms savings on multi-query pages | Low | P1 |
| Lazy CodeMirror loading | 120 KB saved + 5-8 MB memory per instance | Low | P1 |
| Prefetch on hover | 200-300 ms perceived latency improvement | Low | P2 |
| CSS variable injection in provider | Eliminates FOUC | Low | P2 |
| SSR-compatible data loaders | Opt-in RSC performance for Next.js consumers | High | P2 |
| Heavy deps as peerDependencies | Consumer controls versions, avoids duplication | Low | P2 |
