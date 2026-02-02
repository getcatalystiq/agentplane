#!/usr/bin/env npx tsx
/**
 * Deployment Script for AgentPlane
 *
 * Deploys the worker and container image to Cloudflare.
 *
 * Usage:
 *   npm run deploy           # Deploy to production
 *   npm run deploy staging   # Deploy to staging
 */

import { execSync } from 'child_process';

const ENVIRONMENTS = ['staging', 'production'] as const;
type Environment = (typeof ENVIRONMENTS)[number];

async function main() {
  const env = (process.argv[2] as Environment) || 'production';

  if (!ENVIRONMENTS.includes(env)) {
    console.error(`Invalid environment: ${env}`);
    console.error(`Valid environments: ${ENVIRONMENTS.join(', ')}`);
    process.exit(1);
  }

  console.log(`🚀 Deploying AgentPlane to ${env}\n`);

  // Run tests first
  console.log('Running tests...');
  try {
    execSync('npm test', { stdio: 'inherit' });
  } catch {
    console.error('❌ Tests failed. Aborting deployment.');
    process.exit(1);
  }

  // Build the worker
  console.log('\nBuilding worker...');
  execSync('npm run build', { stdio: 'inherit' });

  // Deploy the worker
  console.log(`\nDeploying worker to ${env}...`);
  try {
    if (env === 'production') {
      execSync('npx wrangler deploy --env production', { stdio: 'inherit' });
    } else {
      execSync(`npx wrangler deploy --env ${env}`, { stdio: 'inherit' });
    }
  } catch (error) {
    console.error('❌ Worker deployment failed.');
    process.exit(1);
  }

  // Build and push container image
  console.log('\nBuilding and pushing container image...');
  try {
    await buildAndPushContainer(env);
  } catch (error) {
    console.error('⚠️ Container build failed. Worker deployed but container not updated.');
    console.error(error);
  }

  console.log(`\n✅ Deployment to ${env} complete!`);
}

async function buildAndPushContainer(env: Environment): Promise<void> {
  const accountId = getAccountId();
  const registry = `registry.cloudflare.com/${accountId}`;
  const imageName = `agentplane/agent`;
  const tag = env === 'production' ? 'latest' : env;

  console.log(`  Building image: ${registry}/${imageName}:${tag}`);

  // Build the container
  execSync(`docker build -t ${registry}/${imageName}:${tag} ./container`, {
    stdio: 'inherit',
  });

  // Login to Cloudflare registry
  console.log('  Logging in to Cloudflare Container Registry...');
  execSync(`npx wrangler container auth login`, { stdio: 'pipe' });

  // Push the image
  console.log('  Pushing image...');
  execSync(`docker push ${registry}/${imageName}:${tag}`, { stdio: 'inherit' });

  console.log(`  ✓ Image pushed: ${registry}/${imageName}:${tag}`);
}

function getAccountId(): string {
  const output = execSync('npx wrangler whoami --json', { encoding: 'utf-8' });
  const data = JSON.parse(output);
  return data.account?.id || data.accounts?.[0]?.id;
}

main().catch((error) => {
  console.error('Deployment failed:', error);
  process.exit(1);
});
