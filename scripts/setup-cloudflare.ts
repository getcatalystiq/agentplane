#!/usr/bin/env npx tsx
/**
 * Cloudflare Resource Provisioning Script
 *
 * Sets up all required Cloudflare resources for AgentPlane:
 * - KV Namespaces (TENANT_KV, TENANT_TOKENS, SECRETS_KV)
 * - R2 Buckets (PLUGIN_CACHE, TENANT_STORAGE)
 * - AI Gateway
 * - Zero Trust Access Application (optional)
 *
 * Usage: npm run setup
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

interface WranglerKVNamespace {
  id: string;
  title: string;
}

interface WranglerR2Bucket {
  name: string;
  creation_date: string;
}

const KV_NAMESPACES = ['TENANT_KV', 'TENANT_TOKENS', 'SECRETS_KV'];
const R2_BUCKETS = ['agentplane-plugins', 'agentplane-tenants'];

async function main() {
  console.log('🚀 AgentPlane Cloudflare Setup\n');

  // Check wrangler is authenticated
  try {
    execSync('npx wrangler whoami', { stdio: 'pipe' });
  } catch {
    console.error('❌ Please run `npx wrangler login` first');
    process.exit(1);
  }

  // Get account ID
  const accountId = getAccountId();
  console.log(`📦 Account ID: ${accountId}\n`);

  // Create KV namespaces
  console.log('Creating KV namespaces...');
  const kvIds: Record<string, string> = {};
  for (const ns of KV_NAMESPACES) {
    const id = await createKVNamespace(ns);
    kvIds[ns] = id;
    console.log(`  ✓ ${ns}: ${id}`);
  }

  // Create R2 buckets
  console.log('\nCreating R2 buckets...');
  for (const bucket of R2_BUCKETS) {
    await createR2Bucket(bucket);
    console.log(`  ✓ ${bucket}`);
  }

  // Create AI Gateway
  console.log('\nCreating AI Gateway...');
  const gatewayId = await createAIGateway(accountId);
  console.log(`  ✓ AI Gateway: ${gatewayId}`);

  // Update wrangler.toml with IDs
  console.log('\nUpdating wrangler.toml...');
  updateWranglerToml(kvIds);
  console.log('  ✓ Updated KV namespace IDs');

  // Create .dev.vars template
  console.log('\nCreating .dev.vars template...');
  createDevVars(accountId, gatewayId);
  console.log('  ✓ Created .dev.vars');

  console.log('\n✅ Setup complete!');
  console.log('\nNext steps:');
  console.log('  1. Set secrets: npx wrangler secret put ENCRYPTION_KEY');
  console.log('  2. Configure Zero Trust at https://one.dash.cloudflare.com');
  console.log('  3. Run locally: npm run dev');
  console.log('  4. Deploy: npx wrangler deploy');
}

function getAccountId(): string {
  const output = execSync('npx wrangler whoami --json', { encoding: 'utf-8' });
  const data = JSON.parse(output);
  return data.account?.id || data.accounts?.[0]?.id;
}

async function createKVNamespace(name: string): Promise<string> {
  // Check if namespace already exists
  const listOutput = execSync('npx wrangler kv namespace list --json', {
    encoding: 'utf-8',
  });
  const namespaces = JSON.parse(listOutput) as WranglerKVNamespace[];
  const existing = namespaces.find((ns) => ns.title === `agentplane-${name}`);

  if (existing) {
    return existing.id;
  }

  // Create new namespace
  const createOutput = execSync(
    `npx wrangler kv namespace create "${name}" --json`,
    { encoding: 'utf-8' }
  );
  const result = JSON.parse(createOutput);
  return result.id;
}

async function createR2Bucket(name: string): Promise<void> {
  // Check if bucket already exists
  try {
    const listOutput = execSync('npx wrangler r2 bucket list --json', {
      encoding: 'utf-8',
    });
    const buckets = JSON.parse(listOutput) as WranglerR2Bucket[];
    if (buckets.some((b) => b.name === name)) {
      return;
    }
  } catch {
    // List failed, try to create anyway
  }

  // Create new bucket
  try {
    execSync(`npx wrangler r2 bucket create "${name}"`, { stdio: 'pipe' });
  } catch (error: unknown) {
    // Bucket might already exist
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('already exists')) {
      throw error;
    }
  }
}

async function createAIGateway(accountId: string): Promise<string> {
  const gatewayName = 'agentplane';

  // Check if gateway exists via API
  // Note: AI Gateway management via wrangler is limited, may need API calls
  // For now, return a placeholder and instruct user to create manually if needed

  console.log(`  ℹ️  Create AI Gateway manually at:`);
  console.log(
    `     https://dash.cloudflare.com/${accountId}/ai/ai-gateway`
  );

  return gatewayName;
}

function updateWranglerToml(kvIds: Record<string, string>): void {
  let content = readFileSync('wrangler.toml', 'utf-8');

  // Update each KV namespace ID
  for (const [name, id] of Object.entries(kvIds)) {
    // Match the binding block and update the id
    const regex = new RegExp(
      `(\\[\\[kv_namespaces\\]\\]\\s*\\nbinding = "${name}"\\s*\\nid = )"[^"]*"`,
      'g'
    );
    content = content.replace(regex, `$1"${id}"`);
  }

  writeFileSync('wrangler.toml', content);
}

function createDevVars(accountId: string, gatewayId: string): void {
  const content = `# Local development variables
# Copy this to .dev.vars and fill in the values

CF_TEAM_DOMAIN=your-team.cloudflareaccess.com
CF_POLICY_AUD=your-policy-aud-from-zero-trust
CF_ACCOUNT_ID=${accountId}
AI_GATEWAY_ID=${gatewayId}
ENCRYPTION_KEY=generate-32-byte-hex-key-here
ENVIRONMENT=development

# OAuth provider credentials (optional)
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=
# GITHUB_CLIENT_ID=
# GITHUB_CLIENT_SECRET=
`;

  writeFileSync('.dev.vars', content);
}

main().catch((error) => {
  console.error('Setup failed:', error);
  process.exit(1);
});
