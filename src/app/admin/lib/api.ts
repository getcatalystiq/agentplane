export class AdminApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

export async function adminFetch<T = void>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...init?.headers as Record<string, string> };
  if (init?.body) {
    headers["Content-Type"] ??= "application/json";
  }
  const res = await fetch(`/api/admin${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const err = body?.error;
    throw new AdminApiError(res.status, err?.message ?? res.statusText);
  }
  const text = await res.text();
  if (!text) return undefined as unknown as T;
  return JSON.parse(text) as T;
}

export async function adminStream(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`/api/admin${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const err = body?.error;
    throw new AdminApiError(res.status, err?.message ?? res.statusText);
  }
  return res;
}
