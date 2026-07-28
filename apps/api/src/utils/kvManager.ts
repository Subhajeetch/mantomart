import type Env from "@/types/env";

export type KvSetOptions = {
  /** Seconds until the key expires (Cloudflare KV expirationTtl). */
  expirationTtl?: number;
};

const kvManager = (kv: Env["KV"]) => ({
  get: async (key: string) => {
    const value = await kv.get(key);
    return value;
  },
  getJson: async <T>(key: string): Promise<T | null> => {
    const value = await kv.get(key, "json");
    return (value as T | null) ?? null;
  },
  set: async (key: string, value: string, options?: KvSetOptions) => {
    await kv.put(
      key,
      value,
      options?.expirationTtl
        ? { expirationTtl: options.expirationTtl }
        : undefined
    );
  },
  setJson: async (key: string, value: unknown, options?: KvSetOptions) => {
    await kv.put(
      key,
      JSON.stringify(value),
      options?.expirationTtl
        ? { expirationTtl: options.expirationTtl }
        : undefined
    );
  },
  delete: async (key: string) => {
    await kv.delete(key);
  },
  list: async () => {
    const keys = await kv.list();
    return keys;
  },
});

export default kvManager;
