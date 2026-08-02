export default interface Env {
  DB: D1Database;
  KV: KVNamespace;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /**
   * Signs OAuth state + session cookies. Required in production.
   * Must be ≥32 random chars. Pass via wrangler secret / .dev.vars —
   * better-auth does not read CF bindings from process.env.
   */
  BETTER_AUTH_SECRET: string;
  NODE_ENV?: string;
  /**
   * Public API origin used as better-auth baseURL (OAuth redirect_uri).
   * e.g. https://api.mantomart.com or http://localhost:8002
   * BETTER_AUTH_URL is accepted as an alias by createAuth.
   */
  API_URL?: string;
  BETTER_AUTH_URL?: string;
  ORIGINS?: string;
  DOMAIN?: string;
  AE_APP_KEY: string;
  AE_APP_SECRET: string;

  /**
   * Google Ads / Keyword Planner OAuth + API credentials.
   * Not wired into wrangler secrets yet — configure later.
   */
  GOOGLE_ADS_CLIENT_ID: string;
  GOOGLE_ADS_CLIENT_SECRET: string;
  /** Google Ads API developer token (from MCC / API Center). */
  GOOGLE_ADS_DEVELOPER_TOKEN: string;
  /** Ads customer id (digits only or dashed; dashes stripped). */
  GOOGLE_ADS_CUSTOMER_ID: string;
  /** Optional MCC / manager account id when accessing a client account. */
  GOOGLE_ADS_LOGIN_CUSTOMER_ID?: string;
  /**
   * OAuth redirect URI registered in Google Cloud Console.
   * Should point at the admin integrations page, e.g.
   * https://admin.mantomart.com/connections
   */
  GOOGLE_ADS_REDIRECT_URI: string;

  /**
   * Google AI Studio API key (Gemini) for product SEO generation.
   * Create at https://aistudio.google.com/apikey
   */
  GOOGLE_AI_STUDIO_API_KEY: string;

  // ─── Cloudflare R2 (image uploads) ─────────────────────────────────────────
  /**
   * R2 bucket binding. Configure in wrangler.jsonc:
   *   r2_buckets: [{ binding: "R2_IMAGES", bucket_name: "…", preview_bucket_name: "…" }]
   *
   * Local `wrangler dev` → Miniflare disk (.wrangler/state/v3/r2).
   * Deployed Worker → real Cloudflare R2 bucket.
   */
  R2_IMAGES?: R2Bucket;

  /**
   * Optional public CDN / custom domain for objects (e.g. https://imgs.mantomart.com).
   * When unset, images are served by this Worker at `{API_URL}/api/images/{key}`.
   * Leave unset in local dev so URLs point at localhost.
   */
  R2_PUBLIC_URL?: string;
}