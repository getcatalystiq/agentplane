/**
 * Secret and OAuth credential management with encryption
 */

import type { Env, OAuthCredential, OAuthProviderConfig } from './types';
import { log } from './logging';

const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  google: {
    tokenUrl: 'https://oauth2.googleapis.com/token',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  },
  github: {
    tokenUrl: 'https://github.com/login/oauth/access_token',
    authUrl: 'https://github.com/login/oauth/authorize',
  },
  slack: {
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    authUrl: 'https://slack.com/oauth/v2/authorize',
  },
  linear: {
    tokenUrl: 'https://api.linear.app/oauth/token',
    authUrl: 'https://linear.app/oauth/authorize',
  },
};

// Locks for OAuth token refresh (per tenant+provider)
const refreshLocks = new Map<string, Promise<OAuthCredential | null>>();

// =============================================================================
// Secret Management
// =============================================================================

export async function getSecret(
  tenantId: string,
  key: string,
  env: Env
): Promise<string | null> {
  const storageKey = `${tenantId}:${key}`;
  const encrypted = await env.SECRETS_KV.get(storageKey);

  if (!encrypted) return null;

  try {
    return await decrypt(encrypted, env.ENCRYPTION_KEY);
  } catch (error) {
    log.warn('Failed to decrypt secret', {
      tenantId,
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function setSecret(
  tenantId: string,
  key: string,
  value: string,
  env: Env
): Promise<void> {
  const storageKey = `${tenantId}:${key}`;
  const encrypted = await encrypt(value, env.ENCRYPTION_KEY);
  await env.SECRETS_KV.put(storageKey, encrypted);
}

export async function deleteSecret(
  tenantId: string,
  key: string,
  env: Env
): Promise<void> {
  const storageKey = `${tenantId}:${key}`;
  await env.SECRETS_KV.delete(storageKey);
}

// =============================================================================
// OAuth Credential Management
// =============================================================================

export async function getOAuthCredential(
  tenantId: string,
  provider: string,
  env: Env
): Promise<OAuthCredential | null> {
  const key = `oauth:${provider}`;
  const data = await getSecret(tenantId, key, env);

  if (!data) return null;

  try {
    const credential = JSON.parse(data) as OAuthCredential;

    // Check if token is expired and needs refresh
    if (credential.expires_at < Date.now() && credential.refresh_token) {
      return await getOrRefreshToken(tenantId, provider, credential, env);
    }

    return credential;
  } catch (error) {
    log.warn('Failed to parse OAuth credential', {
      tenantId,
      provider,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function getOrRefreshToken(
  tenantId: string,
  provider: string,
  credential: OAuthCredential,
  env: Env
): Promise<OAuthCredential | null> {
  const lockKey = `${tenantId}:${provider}`;

  // Check if refresh is already in progress
  const existing = refreshLocks.get(lockKey);
  if (existing) {
    return existing;
  }

  // Start refresh with lock
  const refreshPromise = refreshOAuthTokenSafe(tenantId, provider, credential, env)
    .finally(() => {
      refreshLocks.delete(lockKey);
    });

  refreshLocks.set(lockKey, refreshPromise);
  return refreshPromise;
}

async function refreshOAuthTokenSafe(
  tenantId: string,
  provider: string,
  credential: OAuthCredential,
  env: Env
): Promise<OAuthCredential | null> {
  // Re-read from storage to check if another process already refreshed
  const key = `oauth:${provider}`;
  const currentData = await getSecret(tenantId, key, env);
  if (currentData) {
    try {
      const current = JSON.parse(currentData) as OAuthCredential;
      if (current.expires_at > Date.now()) {
        // Already refreshed by another process
        return current;
      }
    } catch {
      // Continue with refresh
    }
  }

  return refreshOAuthToken(tenantId, provider, credential, env);
}

export async function setOAuthCredential(
  tenantId: string,
  provider: string,
  credential: OAuthCredential,
  env: Env
): Promise<void> {
  const key = `oauth:${provider}`;
  await setSecret(tenantId, key, JSON.stringify(credential), env);
}

async function refreshOAuthToken(
  tenantId: string,
  provider: string,
  credential: OAuthCredential,
  env: Env
): Promise<OAuthCredential | null> {
  const providerConfig = OAUTH_PROVIDERS[provider];
  if (!providerConfig || !credential.refresh_token) return null;

  const clientId = env[`${provider.toUpperCase()}_CLIENT_ID` as keyof Env] as string;
  const clientSecret = env[`${provider.toUpperCase()}_CLIENT_SECRET` as keyof Env] as string;

  if (!clientId || !clientSecret) {
    log.warn('Missing OAuth client credentials', { provider });
    return null;
  }

  try {
    const response = await fetch(providerConfig.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: credential.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!response.ok) {
      log.warn('OAuth refresh failed', {
        provider,
        status: response.status,
      });
      return null;
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
    };

    const refreshed: OAuthCredential = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || credential.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      token_type: data.token_type || 'Bearer',
      scopes: credential.scopes,
    };

    await setOAuthCredential(tenantId, provider, refreshed, env);
    return refreshed;
  } catch (error) {
    log.warn('OAuth refresh error', {
      provider,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// =============================================================================
// Encryption Helpers
// =============================================================================

async function encrypt(plaintext: string, keyHex: string): Promise<string> {
  const key = await importKey(keyHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );

  // Combine IV and ciphertext
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return btoa(String.fromCharCode(...combined));
}

async function decrypt(encrypted: string, keyHex: string): Promise<string> {
  const key = await importKey(keyHex);
  const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));

  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}

async function importKey(keyHex: string): Promise<CryptoKey> {
  const matches = keyHex.match(/.{2}/g);
  if (!matches) {
    throw new Error('Invalid encryption key format');
  }

  const keyBytes = Uint8Array.from(matches.map((byte) => parseInt(byte, 16)));

  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}
