# Best Practices: React Component Library (2024-2026)

Research based on real-world patterns from Clerk, Radix Themes, Mantine, shadcn/ui, and Supabase.

---

## 1. tsup Configuration for React Libraries

Based on Clerk's production tsup config (`packages/react/tsup.config.ts`):

```ts
// tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    // Separate heavy entry points for tree-shaking
    charts: 'src/charts/index.ts',
    editor: 'src/editor/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,        // Let consumers minify
  bundle: true,
  treeshake: true,       // Uses Rollup for better tree-shaking
  external: ['react', 'react-dom'],
  // Bundle internal workspace deps inline:
  noExternal: ['@mylib/shared'],
  define: {
    PACKAGE_NAME: `"${name}"`,
    PACKAGE_VERSION: `"${version}"`,
  },
});
```

### Handling Tailwind CSS in Published Packages

Three viable strategies exist. Recommendation depends on your use case:

**Strategy A: Ship compiled CSS (Radix Themes, Mantine pattern) -- RECOMMENDED for full component libraries**

```ts
// tsup.config.ts -- JS only; CSS built separately
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['cjs', 'esm'],
  dts: true,
  external: ['react', 'react-dom'],
});
```

```json
// package.json
{
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.mts", "default": "./dist/index.mjs" },
      "require": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
    },
    "./styles.css": "./dist/styles.css",
    "./styles.layer.css": "./dist/styles.layer.css"
  },
  "sideEffects": ["*.css"]
}
```

Build CSS with PostCSS separately (as Radix Themes does):
```json
{
  "scripts": {
    "build": "tsup && postcss src/styles/index.css -o dist/styles.css",
    "build:layer": "postcss src/styles/layer.css -o dist/styles.layer.css"
  }
}
```

Use `@layer` for specificity control so consumers can override:
```css
/* src/styles/index.css */
@layer mylib {
  .mylib-button { /* ... */ }
}
```

Consumer usage:
```tsx
import '@mylib/ui/styles.css';
import { Button } from '@mylib/ui';
```

**Strategy B: CSS variables + minimal CSS (best for themeable libraries)**

Ship a thin CSS file with custom properties. Components reference variables.
Consumers override variables to theme. See Section 6.

**Strategy C: Tailwind plugin (shadcn pattern)**

shadcn does NOT ship compiled CSS -- it copies source into the consumer's project.
If you want a traditional npm package, do NOT follow this pattern. Use Strategy A or B.

---

## 2. peerDependencies vs Bundled Dependencies

### Peer Dependencies (consumer provides)

```json
{
  "peerDependencies": {
    "react": "^18.x || ^19.x",
    "react-dom": "^18.x || ^19.x"
  }
}
```

**Always peer:** `react`, `react-dom`, and any framework the consumer must also use (e.g., `next`, `@mantine/hooks` if your lib is a Mantine extension).

### Bundled Dependencies (you ship)

```json
{
  "dependencies": {
    "@floating-ui/react": "^0.27.16",
    "clsx": "^2.1.1",
    "class-variance-authority": "^0.7.0",
    "tailwind-merge": "^2.0.0"
  }
}
```

**Always bundle (dependencies, not devDependencies):**
- Utility libs: `clsx`, `class-variance-authority`, `tailwind-merge`
- Radix primitives: `@radix-ui/react-dialog`, etc.
- Internal workspace packages (or use `noExternal` in tsup to inline them)

**Decision rule:** If two copies of the lib in the bundle would cause bugs (shared state, context, hooks), it MUST be a peerDependency. Otherwise, bundle it.

### Real-world reference (Mantine v8)

```json
{
  "peerDependencies": {
    "@mantine/hooks": "8.3.18",
    "react": "^18.x || ^19.x",
    "react-dom": "^18.x || ^19.x"
  },
  "dependencies": {
    "@floating-ui/react": "^0.27.16",
    "clsx": "^2.1.1",
    "react-number-format": "^5.4.4",
    "react-remove-scroll": "^2.7.1",
    "react-textarea-autosize": "8.5.9",
    "type-fest": "^4.41.0"
  }
}
```

---

## 3. Tree-Shaking and Multiple Entry Points

### The `exports` field in package.json

The `exports` field is the modern standard. ALL major libraries use it now.

**Pattern from Clerk React (multiple entry points with tsup):**

```json
{
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.mts", "default": "./dist/index.mjs" },
      "require": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
    },
    "./charts": {
      "import": { "types": "./dist/charts.d.mts", "default": "./dist/charts.mjs" },
      "require": { "types": "./dist/charts.d.ts", "default": "./dist/charts.js" }
    },
    "./editor": {
      "import": { "types": "./dist/editor.d.mts", "default": "./dist/editor.mjs" },
      "require": { "types": "./dist/editor.d.ts", "default": "./dist/editor.js" }
    }
  }
}
```

Corresponding tsup config:

```ts
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    charts: 'src/charts/index.ts',  // Recharts only pulled here
    editor: 'src/editor/index.ts',  // CodeMirror only pulled here
  },
  format: ['cjs', 'esm'],
  dts: true,
  external: ['react', 'react-dom'],
});
```

**Pattern from Radix Themes (wildcard exports for per-component imports):**

```json
{
  "exports": {
    "./components/*": {
      "require": {
        "types": "./dist/cjs/components/*.d.ts",
        "default": "./dist/cjs/components/*.js"
      },
      "import": {
        "types": "./dist/esm/components/*.d.ts",
        "default": "./dist/esm/components/*.js"
      }
    }
  }
}
```

### Key rules

1. **Always put `types` BEFORE `default`** in each condition block
2. Use `"sideEffects": ["*.css"]` so bundlers can tree-shake JS but keep CSS
3. Heavy dependencies (CodeMirror, Recharts, Monaco) MUST be in separate entry points
4. Mark `"type": "module"` if ESM-first, or omit for CJS-first with `.mjs` extensions

### Validation tools

```bash
# Check your exports are correct
npx publint
npx @arethetypeswrong/cli --pack .
```

Both Clerk and Supabase use `attw` (Are The Types Wrong) in CI.

---

## 4. Provider Pattern

### Clerk pattern (singleton + context)

Clerk uses a singleton `IsomorphicClerk` instance managed via ref, exposed through context:

```tsx
// Provider.tsx
import { createContext, useContext, useRef, useState, useEffect, useMemo } from 'react';

interface MyLibContextValue {
  client: MyClient;
  status: 'loading' | 'ready' | 'error';
}

const MyLibContext = createContext<MyLibContextValue | undefined>(undefined);

export function MyLibProvider({
  apiKey,
  children,
  // Allow theme/config props
  theme,
}: {
  apiKey: string;
  children: React.ReactNode;
  theme?: ThemeConfig;
}) {
  const clientRef = useRef(MyClient.getOrCreate({ apiKey }));
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    clientRef.current.on('status', setStatus);
    return () => {
      clientRef.current.off('status', setStatus);
      MyClient.clearInstance();
    };
  }, []);

  const value = useMemo(
    () => ({ client: clientRef.current, status }),
    [status]
  );

  return (
    <MyLibContext.Provider value={value}>
      {children}
    </MyLibContext.Provider>
  );
}

// Guard against multiple providers (Clerk does this)
export function useMyLib() {
  const ctx = useContext(MyLibContext);
  if (!ctx) {
    throw new Error('useMyLib must be used within <MyLibProvider>');
  }
  return ctx;
}
```

### Radix Themes pattern (theme context with defaults)

Radix Themes provides theme values through context with sensible defaults and controlled/uncontrolled state:

```tsx
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function Theme({ appearance = 'light', accentColor = 'blue', radius = 'medium', children }) {
  const parentContext = useContext(ThemeContext);
  const isRoot = parentContext === undefined;

  // Support nested themes -- only root wraps with global providers
  if (isRoot) {
    return (
      <TooltipProvider>
        <ThemeRoot appearance={appearance} accentColor={accentColor} radius={radius}>
          {children}
        </ThemeRoot>
      </TooltipProvider>
    );
  }
  return <ThemeImpl ...props>{children}</ThemeImpl>;
}
```

### Best practices for providers

1. **Singleton pattern** for SDK clients (Clerk approach) -- prevent duplicate instances
2. **Guard against multiple providers** with `withMaxAllowedInstancesGuard`
3. **Merge with environment variables** for zero-config DX (`NEXT_PUBLIC_*`, `VITE_*`)
4. **Separate concerns**: auth provider, theme provider, router provider as composable layers
5. **Memoize context values** to prevent unnecessary re-renders

---

## 5. RouterAdapter Pattern

### The problem

Component libraries with `<Link>` components need to work with React Router, Next.js App Router, TanStack Router, and plain `<a>` tags.

### Solution: RouterProvider with adapter

```tsx
// types.ts
interface RouterAdapter {
  push: (href: string) => void;
  replace: (href: string) => void;
  // For link components
  Link: React.ComponentType<{ href: string; children: React.ReactNode; className?: string }>;
}

// context.ts
const RouterContext = createContext<RouterAdapter | null>(null);

export function RouterProvider({ adapter, children }: { adapter: RouterAdapter; children: React.ReactNode }) {
  return <RouterContext.Provider value={adapter}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterAdapter {
  const ctx = useContext(RouterContext);
  if (!ctx) {
    // Fallback to native browser navigation
    return {
      push: (href) => { window.location.href = href; },
      replace: (href) => { window.location.replace(href); },
      Link: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
    };
  }
  return ctx;
}
```

### Pre-built adapters shipped by the library

```tsx
// adapters/next.ts
'use client';
import NextLink from 'next/link';
import { useRouter as useNextRouter } from 'next/navigation';
import type { RouterAdapter } from '../types';

export function useNextAdapter(): RouterAdapter {
  const router = useNextRouter();
  return {
    push: router.push,
    replace: router.replace,
    Link: NextLink,
  };
}

// adapters/react-router.ts
import { Link as RRLink, useNavigate } from 'react-router-dom';
import type { RouterAdapter } from '../types';

export function useReactRouterAdapter(): RouterAdapter {
  const navigate = useNavigate();
  return {
    push: (href) => navigate(href),
    replace: (href) => navigate(href, { replace: true }),
    Link: ({ href, ...props }) => <RRLink to={href} {...props} />,
  };
}
```

Ship adapters as separate entry points to avoid importing framework-specific code:

```json
{
  "exports": {
    "./adapters/next": {
      "import": { "types": "./dist/adapters/next.d.mts", "default": "./dist/adapters/next.mjs" }
    },
    "./adapters/react-router": {
      "import": { "types": "./dist/adapters/react-router.d.mts", "default": "./dist/adapters/react-router.mjs" }
    }
  }
}
```

### Real-world examples

- **Clerk**: uses `routerPush` and `routerReplace` callback props on `<ClerkProvider>`
- **Radix Themes**: avoids routing entirely -- delegates to consumer via `asChild` + Slot pattern
- **Mantine**: ships `createPolymorphicComponent` for `component` prop (render as any element/component)

The `asChild` / Slot pattern (Radix) is the simplest for link-like components:

```tsx
import { Slot } from '@radix-ui/react-slot';

interface ButtonProps {
  asChild?: boolean;
  children: React.ReactNode;
}

function Button({ asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return <Comp {...props} />;
}

// Consumer uses it with their router's Link:
<Button asChild><NextLink href="/foo">Go</NextLink></Button>
```

---

## 6. CSS Variable Theming

### Radix Themes pattern (most comprehensive)

Radix Themes ships a complete token system via CSS custom properties:

```css
/* tokens/base.css */
:root, .radix-themes {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;

  --radius-1: 3px;
  --radius-2: 4px;
  --radius-3: 6px;
  --radius-4: 8px;

  --font-size-1: 12px;
  --font-size-2: 14px;
  --font-size-3: 16px;

  --color-background: white;
  --color-surface: #fafafa;
  --color-text: #111;
  --color-text-muted: #666;
}

/* Dark mode via data attribute or class */
.dark, [data-appearance="dark"] {
  --color-background: #111;
  --color-surface: #1a1a1a;
  --color-text: #eee;
  --color-text-muted: #999;
}

/* Accent color scales (Radix Colors) */
[data-accent-color="blue"] {
  --accent-1: #0d1520;
  --accent-9: #3e63dd;
  --accent-contrast: white;
}
```

### Mantine pattern (CSS modules + variables)

Mantine combines CSS modules with CSS variables. Each component has its own variables:

```css
/* Button.module.css */
.root {
  height: var(--button-height);
  padding-inline: var(--button-padding-x);
  border-radius: var(--button-radius, var(--mantine-radius-default));
  font-size: var(--button-fz);
  background: var(--button-bg);
  color: var(--button-color);
}
```

Consumers override per-component or globally:

```css
/* Consumer's overrides */
:root {
  --mantine-radius-default: 8px;
  --mantine-color-primary: oklch(0.6 0.2 260);
}
```

### Recommended approach for new libraries

```css
/* src/styles/tokens.css */
:root {
  /* Spacing scale */
  --mylib-space-1: 0.25rem;
  --mylib-space-2: 0.5rem;
  --mylib-space-3: 0.75rem;
  --mylib-space-4: 1rem;

  /* Color tokens -- use oklch for perceptual uniformity */
  --mylib-color-primary: oklch(0.6 0.2 260);
  --mylib-color-primary-hover: oklch(0.55 0.22 260);
  --mylib-color-surface: oklch(0.99 0 0);
  --mylib-color-text: oklch(0.15 0 0);

  /* Component tokens reference scale tokens */
  --mylib-button-bg: var(--mylib-color-primary);
  --mylib-button-radius: 0.375rem;
}

/* Dark mode */
.dark, [data-theme="dark"] {
  --mylib-color-surface: oklch(0.15 0 0);
  --mylib-color-text: oklch(0.9 0 0);
}
```

### Key conventions

1. **Namespace all variables** with a prefix (`--mylib-*`, `--radix-*`, `--mantine-*`)
2. **Two-tier token system**: scale tokens (primitive) + component tokens (semantic)
3. **Use `@layer`** so consumer CSS always wins on specificity
4. **Ship both `styles.css` and `styles.layer.css`** (Mantine does this)
5. **Mark CSS files as `sideEffects`** in package.json

---

## 7. Monorepo Setup

### Recommended: npm/pnpm workspaces + Turborepo

Supabase uses Nx, but for most teams Turborepo is simpler.

```
my-lib/
  packages/
    ui/               # React component library
      src/
      package.json
      tsup.config.ts
    sdk/              # Client SDK (no React)
      src/
      package.json
      tsup.config.ts
    shared/           # Shared types/utils (bundled inline, not published)
      src/
      package.json
  turbo.json
  package.json
```

**Root package.json:**

```json
{
  "private": true,
  "workspaces": ["packages/*"],
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "~5.8.0",
    "tsup": "^8.0.0",
    "vitest": "^3.0.0"
  }
}
```

**turbo.json:**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["build"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "lint": {}
  }
}
```

### Internal packages pattern

For shared code that should NOT be published separately, use `noExternal` in tsup to inline it:

```ts
// packages/ui/tsup.config.ts
export default defineConfig({
  noExternal: ['@mylib/shared'],  // Inlined at build time
  external: ['react', 'react-dom'],
});
```

Or use TypeScript project references with `"publishConfig": { "access": "restricted" }` on the shared package.

### Changesets for versioning

```bash
npx changeset init
npx changeset        # Create a changeset
npx changeset version # Bump versions
npx changeset publish # Publish to npm
```

Clerk, Radix, and Mantine all use Changesets.

---

## 8. React 18 + 19 Compatibility

### Peer dependency range

```json
{
  "peerDependencies": {
    "react": "^18.x || ^19.x",
    "react-dom": "^18.x || ^19.x"
  }
}
```

Mantine v8 uses exactly this range.

### Key breaking changes in React 19

1. **`forwardRef` is no longer needed** -- refs are passed as regular props. But `forwardRef` still works, so keep using it for 18+19 compat.

2. **`useId` is stable in both** -- safe to use for SSR-safe IDs.

3. **`use()` hook is React 19 only** -- do NOT use it in library code if supporting 18.

4. **Context as a provider** -- in React 19, `<MyContext>` works directly instead of `<MyContext.Provider>`. But `<MyContext.Provider>` still works, so keep using Provider syntax.

5. **`ref` cleanup functions** -- React 19 supports returning a cleanup function from ref callbacks. Don't rely on this if supporting 18.

6. **String refs removed** -- already deprecated in 18, removed in 19. Never use them.

### Testing matrix

```yaml
# .github/workflows/test.yml
strategy:
  matrix:
    react-version: [18, 19]
steps:
  - run: npm install react@${{ matrix.react-version }} react-dom@${{ matrix.react-version }}
  - run: npm test
```

### Conditional feature detection

```ts
// utils/react-version.ts
import { version } from 'react';

const major = parseInt(version.split('.')[0], 10);
export const IS_REACT_19 = major >= 19;
```

Clerk does exactly this to conditionally enable React 19 features (shared UI variant).

### Safe patterns for both versions

```tsx
// SAFE: works in 18 and 19
const MyComponent = forwardRef<HTMLDivElement, Props>((props, ref) => {
  return <div ref={ref} {...props} />;
});

// SAFE: useId works in both
function Field({ label, children }) {
  const id = useId();
  return (
    <>
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, { id })}
    </>
  );
}

// AVOID in library code: React 19 only
function Comp() {
  const value = use(somePromise);  // React 19 only
}
```

---

## Summary: Recommended Stack

| Concern | Recommendation |
|---|---|
| Bundler | tsup (ESM + CJS + DTS) |
| CSS | Compiled CSS with `@layer` + CSS variables for theming |
| Peer deps | react, react-dom only |
| Bundled deps | clsx, cva, tailwind-merge, Radix primitives |
| Tree-shaking | Multiple entry points via `exports` field |
| Provider | Singleton client via ref + React context |
| Router | `asChild`/Slot for links; RouterAdapter for navigation |
| Theming | Namespaced CSS custom properties, two-tier tokens |
| Monorepo | pnpm workspaces + Turborepo + Changesets |
| React compat | `^18.x \|\| ^19.x`, test both, use `forwardRef` |
| Validation | `publint` + `attw` in CI |

## Sources

- **Clerk React** (`@clerk/react` v6): tsup config, provider pattern, React version detection
- **Radix Themes** (`@radix-ui/themes` v3): CSS variable theming, exports structure, Theme component
- **Mantine** (`@mantine/core` v8): peer dependencies, CSS layers, React 18+19 range
- **shadcn/ui** (`shadcn` v4): exports field structure, Tailwind approach
- **tsup official docs**: ESM/CJS/DTS configuration, tree-shaking, multiple entry points
