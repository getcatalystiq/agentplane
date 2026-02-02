/**
 * Zero Trust JWT validation for Cloudflare Access
 */

import * as jose from 'jose';
import type { Env, AuthResult, AccessJWTPayload } from './types';
import { log } from './logging';

// Module-level JWKS cache
let jwksCache: jose.JWTVerifyGetKey | null = null;
let jwksCacheTeamDomain: string | null = null;

function getJWKS(teamDomain: string): jose.JWTVerifyGetKey {
  // Return cached JWKS if same team domain
  if (jwksCache && jwksCacheTeamDomain === teamDomain) {
    return jwksCache;
  }

  const jwksUrl = new URL(`https://${teamDomain}/cdn-cgi/access/certs`);
  jwksCache = jose.createRemoteJWKSet(jwksUrl);
  jwksCacheTeamDomain = teamDomain;
  return jwksCache;
}

export async function validateRequestAndGetTenant(
  request: Request,
  env: Env
): Promise<AuthResult> {
  // Get JWT from header or cookie
  const token =
    request.headers.get('CF-Access-JWT-Assertion') ||
    getCookie(request, 'CF_Authorization');

  if (!token) {
    return { success: false, reason: 'missing_token' };
  }

  try {
    const jwks = getJWKS(env.CF_TEAM_DOMAIN);

    const { payload } = await jose.jwtVerify(token, jwks, {
      audience: env.CF_POLICY_AUD,
      issuer: `https://${env.CF_TEAM_DOMAIN}`,
    });

    const jwtPayload = payload as unknown as AccessJWTPayload;

    // Note: jose.jwtVerify already validates expiration, no need for redundant check

    // Extract tenant ID from service token
    const tenantId = await resolveTenantId(jwtPayload, env);
    if (!tenantId) {
      return { success: false, reason: 'unknown_service_token' };
    }

    return { success: true, tenantId };
  } catch (error) {
    if (error instanceof jose.errors.JWTExpired) {
      return { success: false, reason: 'expired' };
    }
    if (
      error instanceof jose.errors.JWTClaimValidationFailed ||
      error instanceof jose.errors.JWSSignatureVerificationFailed
    ) {
      return { success: false, reason: 'invalid_token' };
    }
    log.warn('JWT validation error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, reason: 'validation_error' };
  }
}

async function resolveTenantId(
  payload: AccessJWTPayload,
  env: Env
): Promise<string | null> {
  // Check for tenant_id in custom claims first (required for browser auth)
  if (payload.custom?.tenant_id) {
    return payload.custom.tenant_id;
  }

  // For service tokens, lookup tenant by client_id
  if (payload.service_token_id || payload.common_name) {
    const clientId = payload.sub;
    const tenantId = await env.TENANT_TOKENS.get(clientId);
    return tenantId;
  }

  // For user tokens without explicit tenant_id, reject
  // This prevents insecure email-domain-based tenant derivation
  log.warn('Missing tenant_id claim in user token', {
    email: payload.email ? '[redacted]' : undefined,
    sub: payload.sub,
  });
  return null;
}

function getCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';');
  for (const cookie of cookies) {
    const trimmed = cookie.trim();
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.substring(0, eqIndex);
    const value = trimmed.substring(eqIndex + 1);

    if (key === name) {
      return value;
    }
  }
  return null;
}
