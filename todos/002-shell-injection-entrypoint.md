# Shell Injection in Container Entrypoint

**Priority:** P1-CRITICAL
**Category:** security
**File:** container/entrypoint.sh
**Blocks:** merge

## Description

The container entrypoint script uses unsanitized environment variables in shell commands, allowing shell injection if an attacker controls environment variable values.

## Current Code

```bash
echo "Starting agent for tenant: $TENANT_ID"
exec node /app/agent.js --tenant=$TENANT_ID
```

## Impact

If TENANT_ID contains shell metacharacters (e.g., `; rm -rf /`), arbitrary commands could be executed inside the container.

## Fix

Quote all variable expansions and validate input:

```bash
#!/bin/bash
set -euo pipefail

# Validate TENANT_ID contains only safe characters
if [[ ! "$TENANT_ID" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    echo "Invalid TENANT_ID format" >&2
    exit 1
fi

echo "Starting agent for tenant: ${TENANT_ID}"
exec node /app/agent.js "--tenant=${TENANT_ID}"
```

## References

- ShellCheck: https://www.shellcheck.net/
- OWASP OS Command Injection: https://owasp.org/www-community/attacks/Command_Injection
