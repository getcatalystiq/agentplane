# Missing Agent-Native API Endpoints

**Priority:** P2-HIGH
**Category:** architecture, agent-native
**File:** src/index.ts
**Blocks:** none

## Description

The current API only exposes 4 of 18 agent capabilities. Agents cannot programmatically manage tenants, credentials, plugins, or sessions without human intervention.

## Current API Endpoints

1. POST /agent - Execute agent action
2. GET /session/:id - Get session
3. POST /session - Create session
4. DELETE /session/:id - Delete session

## Missing Agent Capabilities

### Tenant Management
- GET /api/tenants - List accessible tenants
- GET /api/tenants/:id - Get tenant config
- PUT /api/tenants/:id - Update tenant config
- GET /api/tenants/:id/usage - Get usage metrics

### Credential Management
- GET /api/credentials - List credentials (names only, not values)
- POST /api/credentials - Create credential
- DELETE /api/credentials/:name - Delete credential
- POST /api/credentials/:name/rotate - Rotate credential

### Plugin Management
- GET /api/plugins - List installed plugins
- POST /api/plugins - Install plugin
- DELETE /api/plugins/:name - Uninstall plugin
- POST /api/plugins/:name/refresh - Refresh plugin cache

### Session Lifecycle
- GET /api/sessions - List sessions
- POST /api/sessions/:id/pause - Pause session
- POST /api/sessions/:id/resume - Resume session
- GET /api/sessions/:id/logs - Get session logs

## Impact

- Agents require human intervention for administrative tasks
- Cannot build self-managing agent systems
- Limited observability for agent-driven debugging

## Fix

Add REST API endpoints with proper authorization:

```typescript
// src/routes/api.ts
export function createApiRouter() {
  return {
    'GET /api/tenants': handleListTenants,
    'GET /api/tenants/:id': handleGetTenant,
    'GET /api/credentials': handleListCredentials,
    'POST /api/credentials': handleCreateCredential,
    // ... etc
  };
}
```

## Authorization Model

- Service tokens: Full access to own tenant resources
- Browser auth: Read access only
- Admin tokens: Cross-tenant access
