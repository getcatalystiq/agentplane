# Serial Plugin Loading Pattern

**Priority:** P2-HIGH
**Category:** performance
**File:** src/lib/plugins.ts
**Lines:** 23-41
**Blocks:** none

## Description

Plugins are loaded sequentially in a for-loop. With multiple plugin sources, each adds latency even though they could be fetched in parallel.

## Current Code

```typescript
for (const source of sources) {
  const plugin = await extractPlugin(source, env);  // Sequential
  bundle.skills.push(...plugin.skills);
  bundle.commands.push(...plugin.commands);
  Object.assign(bundle.mcpServers, plugin.mcpServers);
}
```

## Impact

With 5 plugins averaging 200ms each, total load time is ~1000ms instead of ~200ms.

## Fix

Use Promise.all for parallel loading:

```typescript
export async function loadPluginsForTenant(
  sources: PluginSource[],
  env: Env
): Promise<PluginBundle> {
  const plugins = await Promise.all(
    sources.map(source => extractPlugin(source, env))
  );

  const bundle: PluginBundle = {
    skills: [],
    commands: [],
    mcpServers: {},
  };

  for (const plugin of plugins) {
    bundle.skills.push(...plugin.skills);
    bundle.commands.push(...plugin.commands);
    Object.assign(bundle.mcpServers, plugin.mcpServers);
  }

  return bundle;
}
```

## Considerations

- Add error handling for individual plugin failures (don't fail all if one fails)
- Consider using Promise.allSettled for graceful degradation
