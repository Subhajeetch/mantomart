import type { AccountResponse, ConsumerProfile } from "./types";
import { requestUserJson } from "@/lib/user-data-cache";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const payload = await requestUserJson(
    path,
    init
  ) as
    | { success: true; data: T }
    | { success: false; error?: string; message?: string }
    | null;

  if (!payload || payload.success !== true) {
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
