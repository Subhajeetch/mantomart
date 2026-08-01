export default interface Env {
  DB: D1Database;
  KV: KVNamespace;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  NODE_ENV?: string;
  API_URL?: string;
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
}