#!/usr/bin/env npx tsx
/**
 * Tenant Provisioning Script
 *
 * Provisions a new tenant with:
 * - Tenant configuration in KV
 * - Service token mapping
 * - Optional: Zero Trust service token creation
 *
 * Usage: npm run provision-tenant -- --config config/tenants/my-tenant.yaml
 */

import { spawnSync } from 'child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';

interface TenantConfig {
  tenant: {
    id: string;
    name: string;
  };
  zero_trust?: {
    service_tokens: Array<{
      client_id: string;
      name: string;
      permissions: string[];
    }>;
  };
  resources: {
    sandbox: {
      sleep_after: string;
      max_concurrent_sessions: number;
    };
    storage: {
      bucket_prefix: string;
      quota_gb: number;
    };
  };
  plugins: Array<{
    repo: string;
    path?: string;
    ref?: string;
    github_token?: string;
    env?: Record<string, string>;
  }>;
  allowed_mcp_domains?: string[];
  ai?: {
    provider: 'anthropic' | 'bedrock';
    bedrock_region?: string;
    bedrock_model?: string;
  };
  rate_limits: {
    requests_per_minute: number;
    tokens_per_day: number;
  };
}

// Validate tenant ID format to prevent any injection
function validateTenantId(id: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id) && id.length <= 64;
}

async function main() {
  const args = process.argv.slice(2);
  const configIndex = args.indexOf('--config');

  if (configIndex === -1 || !args[configIndex + 1]) {
    console.error('Usage: npm run provision-tenant -- --config <path-to-config.yaml>');
    process.exit(1);
  }

  const configPath = args[configIndex + 1];
  console.log(`📦 Provisioning tenant from: ${configPath}\n`);

  // Load and parse config
  const configContent = readFileSync(configPath, 'utf-8');
  const config = parseYaml(configContent) as TenantConfig;

  // Validate required fields
  if (!config.tenant?.id || !config.tenant?.name) {
    console.error('❌ Config must include tenant.id and tenant.name');
    process.exit(1);
  }

  const tenantId = config.tenant.id;

  // Validate tenant ID format
  if (!validateTenantId(tenantId)) {
    console.error('❌ Invalid tenant ID format. Must be alphanumeric with ._- allowed.');
    process.exit(1);
  }

  console.log(`Tenant ID: ${tenantId}`);
  console.log(`Tenant Name: ${config.tenant.name}\n`);

  // Add created_at timestamp
  const fullConfig = {
    ...config,
    tenant: {
      ...config.tenant,
      created_at: new Date().toISOString(),
    },
  };

  // Store tenant config in KV
  console.log('Storing tenant configuration in KV...');
  await putKVValue('TENANT_KV', tenantId, JSON.stringify(fullConfig));
  console.log('  ✓ Tenant config stored');

  // Map service tokens to tenant
  if (config.zero_trust?.service_tokens) {
    console.log('\nMapping service tokens...');
    for (const token of config.zero_trust.service_tokens) {
      if (token.client_id.startsWith('${')) {
        console.log(`  ⚠️  Skipping ${token.name}: client_id is a variable`);
        continue;
      }
      await putKVValue('TENANT_TOKENS', token.client_id, tenantId);
      console.log(`  ✓ ${token.name}: ${token.client_id.slice(0, 8)}...`);
    }
  }

  console.log('\n✅ Tenant provisioned successfully!');
  console.log('\nNext steps:');
  console.log('  1. Create a Zero Trust service token at https://one.dash.cloudflare.com');
  console.log('  2. Update the service token client_id in your config');
  console.log('  3. Re-run this script to map the token');
  console.log('\nTest the tenant:');
  console.log(
    `  curl -X POST https://your-worker.workers.dev/agent \\`
  );
  console.log(`    -H "CF-Access-Client-Id: <service-token-client-id>" \\`);
  console.log(`    -H "CF-Access-Client-Secret: <service-token-secret>" \\`);
  console.log(`    -H "Content-Type: application/json" \\`);
  console.log(`    -d '{"prompt": "Hello, world!"}'`);
}

async function putKVValue(
  namespace: string,
  key: string,
  value: string
): Promise<void> {
  // Write value to a temp file to avoid shell injection
  const tempFile = join(tmpdir(), `kv-value-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

  try {
    writeFileSync(tempFile, value, 'utf-8');

    // Use spawnSync with array arguments to prevent shell injection
    const result = spawnSync('npx', [
      'wrangler',
      'kv:key',
      'put',
      `--binding=${namespace}`,
      key,
      '--path',
      tempFile,
    ], {
      stdio: 'pipe',
      encoding: 'utf-8',
    });

    if (result.status !== 0) {
      throw new Error(`wrangler failed: ${result.stderr || result.stdout}`);
    }
  } finally {
    // Clean up temp file
    try {
      unlinkSync(tempFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}

main().catch((error) => {
  console.error('Provisioning failed:', error);
  process.exit(1);
});
