import type { AccountResponse, ConsumerProfile } from "./types";

function getApiUrl(path: string): string {
  const origin = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";
  return `${origin}${path}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(getApiUrl(path), {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  const payload = (await response.json().catch(() => null)) as
    | { success: true; data: T }
    | { success: false; error?: string; message?: string }
    | null;

  if (!response.ok || !payload || payload.success !== true) {
    throw new Error(
      payload && "error" in payload
        ? payload.error ?? payload.message ?? "Request failed."
        : "Request failed."
    );
  }

  return payload.data;
}

export function getAccount() {
  return request<AccountResponse>("/api/store/account");
}

export function updateProfile(changes: Partial<ConsumerProfile>) {
  return request<ConsumerProfile>("/api/store/account", {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}

export function revokeSession(sessionId: string) {
  return request<{ revoked: true }>(
    `/api/store/account/sessions/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" }
  );
}
