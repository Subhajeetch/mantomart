const config = {
  AE_API_BASE: 'https://api-sg.aliexpress.com/sync',
  AE_AUTH_BASE: 'https://api-sg.aliexpress.com/rest',

  // Google Ads / Keyword Planner
  GOOGLE_OAUTH_AUTH_URL: 'https://accounts.google.com/o/oauth2/v2/auth',
  GOOGLE_OAUTH_TOKEN_URL: 'https://oauth2.googleapis.com/token',
  GOOGLE_ADS_SCOPE: 'https://www.googleapis.com/auth/adwords',
  /** REST API version — bump when Google deprecates. */
  GOOGLE_ADS_API_BASE: 'https://googleads.googleapis.com/v18',
  /** languageConstants/1000 = English */
  GOOGLE_ADS_DEFAULT_LANGUAGE_ID: '1000',
  /** geoTargetConstants/2840 = United States */
  GOOGLE_ADS_DEFAULT_GEO_TARGET_IDS: ['2840'],
};

export default config;