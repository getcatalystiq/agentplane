import type { AgentPlane } from "../client";

export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export class KeysResource {
  constructor(private readonly _client: AgentPlane) {}

  /** List API keys for the current tenant. */
  async list(): Promise<ApiKey[]> {
    const resp = await this._client._request<{ data: ApiKey[] }>(
      "GET",
      "/api/keys",
    );
    return resp.data;
  }

  /** Create a new API key. Returns the full key only once. */
  async create(params: { name: string }): Promise<unknown> {
    return this._client._request("POST", "/api/keys", { body: params });
  }

  /** Revoke an API key. */
  async revoke(keyId: string): Promise<void> {
    await this._client._request("DELETE", `/api/keys/${keyId}`);
  }
}
