import { logger } from "./logger";

interface InstallationToken {
  token: string;
  expires_at: string;
}

// Cache installation tokens (they last 1 hour)
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export async function getInstallationToken(
  installationId: string,
): Promise<string | null> {
  // Check cache
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const appId = process.env.GITHUB_APP_ID;
  const privateKeyBase64 = process.env.GITHUB_APP_PRIVATE_KEY;

  if (!appId || !privateKeyBase64) {
    logger.warn("GitHub App credentials not configured");
    return null;
  }

  try {
    // Generate JWT for GitHub App authentication
    const jwt = await generateAppJwt(appId, privateKeyBase64);

    // Exchange for installation token
    const response = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );

    if (!response.ok) {
      const text = await response.text();
      logger.error("Failed to get installation token", {
        installation_id: installationId,
        status: response.status,
        body: text.slice(0, 500),
      });
      return null;
    }

    const data: InstallationToken = await response.json();

    // Cache the token
    tokenCache.set(installationId, {
      token: data.token,
      expiresAt: new Date(data.expires_at).getTime(),
    });

    return data.token;
  } catch (err) {
    logger.error("GitHub installation token error", {
      installation_id: installationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function generateAppJwt(
  appId: string,
  privateKeyBase64: string,
): Promise<string> {
  const privateKeyPem = Buffer.from(privateKeyBase64, "base64").toString("utf-8");

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60, // Issued 60s ago to handle clock drift
    exp: now + 10 * 60, // Expires in 10 minutes
    iss: appId,
  };

  // Import the RSA private key
  const keyData = pemToArrayBuffer(privateKeyPem);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  // Build JWT
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payloadStr = base64url(JSON.stringify(payload));
  const signingInput = `${header}.${payloadStr}`;

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );

  const sig = base64url(signature);
  return `${signingInput}.${sig}`;
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
}

function base64url(input: string | ArrayBuffer): string {
  let b64: string;
  if (typeof input === "string") {
    b64 = btoa(input);
  } else {
    const bytes = new Uint8Array(input);
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    b64 = btoa(binary);
  }
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Verify GitHub webhook signature
export async function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const computed = "sha256=" + Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return computed === signature;
}
