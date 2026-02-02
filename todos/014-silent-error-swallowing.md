# Silent Error Swallowing

**Priority:** P3-MEDIUM
**Category:** reliability
**Files:** src/lib/config.ts, src/lib/plugins.ts, src/lib/credentials.ts
**Blocks:** none

## Description

Multiple catch blocks silently swallow errors without logging, making debugging production issues difficult.

## Locations

### src/lib/config.ts:22-24
```typescript
} catch {
  return null;  // No logging
}
```

### src/lib/plugins.ts:95-97
```typescript
} catch {
  return null;  // No logging
}
```

### src/lib/plugins.ts:134-136
```typescript
} catch {
  // Ignore manifest parse errors  // Intentional but should log
}
```

### src/lib/credentials.ts:various
Multiple catch blocks with no error logging.

## Impact

- Production issues are invisible
- No audit trail for failures
- Difficult to diagnose configuration problems

## Fix

Add structured logging:

```typescript
import { log } from './logging';

try {
  const config = JSON.parse(data) as TenantConfig;
  return validateTenantConfig(config);
} catch (error) {
  log.warn('Failed to parse tenant config', {
    tenantId,
    error: error instanceof Error ? error.message : String(error),
  });
  return null;
}
```

## Logging Module

```typescript
// src/lib/logging.ts
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

export const log = {
  debug: (msg: string, ctx?: LogContext) => emit('debug', msg, ctx),
  info: (msg: string, ctx?: LogContext) => emit('info', msg, ctx),
  warn: (msg: string, ctx?: LogContext) => emit('warn', msg, ctx),
  error: (msg: string, ctx?: LogContext) => emit('error', msg, ctx),
};

function emit(level: LogLevel, message: string, context?: LogContext) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  }));
}
```
