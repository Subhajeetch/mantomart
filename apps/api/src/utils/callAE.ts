import type Env from "@/types/env";
import config from "@/base.config";

const { AE_API_BASE } = config;

async function generateSignature(
  params: Record<string, string>,
  secret: string
): Promise<string> {
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys.map((key) => `${key}${params[key]}`).join("");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(paramString)
  );

  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export async function callAE(
  env: Env,
  method: string,
  params: Record<string, any>,
  session?: string 
) {
  const timestamp = Date.now();

  const requestParams: Record<string, string> = {
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    method,
    app_key: env.AE_APP_KEY,
    timestamp: String(timestamp),
    sign_method: "sha256",
    ...(session ? { session } : {}),
  };

  const sign = await generateSignature(requestParams, env.AE_APP_SECRET);

  const finalParams: Record<string, string> = { ...requestParams, sign };

  const body = Object.entries(finalParams)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const res = await fetch(AE_API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body,
  });

  const data = await res.json();
 // console.log("response:", data);
  return data;
}