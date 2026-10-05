import type { AccountResponse, ConsumerProfile } from "./types";
import { clearUserDataCache, requestUserJson } from "@/lib/user-data-cache";

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

export function uploadProfileImage(
  image: Blob,
  onProgress: (percentage: number) => void
): Promise<ConsumerProfile> {
  clearUserDataCache();

  return new Promise((resolve, reject) => {
    type UploadResponse =
      | { success: true; data: ConsumerProfile }
      | { success: false; error?: string; message?: string };

    const request = new XMLHttpRequest();
    request.open(
      "POST",
      `${(process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "")}/api/store/account/image`
    );
    request.withCredentials = true;
    request.timeout = 120_000;
    request.setRequestHeader("Accept", "application/json");

    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(99, Math.floor((event.loaded / event.total) * 100)));
      }
    });

    request.addEventListener("load", () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(request.responseText) as unknown;
      } catch {
        reject(new Error("The server returned an unreadable response."));
        return;
      }
      if (!parsed || typeof parsed !== "object" || !("success" in parsed)) {
        reject(new Error("The server returned an unreadable response."));
        return;
      }
      const payload = parsed as UploadResponse;

      if (request.status < 200 || request.status >= 300 || payload.success !== true) {
        reject(
          new Error(payload.success !== true
            ? payload.error ?? payload.message ?? "Unable to upload your profile image."
            : "Unable to upload your profile image."
          )
        );
        return;
      }
      if (!payload.data || typeof payload.data !== "object") {
        reject(new Error("The server returned an incomplete profile image response."));
        return;
      }

      clearUserDataCache();
      onProgress(100);
      resolve(payload.data);
    });
    request.addEventListener("error", () => {
      reject(new Error("Network error while uploading your profile image. Check your connection and try again."));
    });
    request.addEventListener("timeout", () => {
      reject(new Error("The profile image upload timed out. Please try again."));
    });
    request.addEventListener("abort", () => {
      reject(new Error("The profile image upload was cancelled."));
    });

    const body = new FormData();
    body.append("file", image, "avatar.webp");
    request.send(body);
  });
}

export function revokeSession(sessionId: string) {
  return request<{ revoked: true }>(
    `/api/store/account/sessions/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" }
  );
}
