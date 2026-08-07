import {
  assertGoogleAdsConfig,
  buildGoogleAdsAuthUrl,
  connectGoogleAds,
  disconnectGoogleAds,
  getGoogleAdsConnectionStatus,
  GoogleAdsConfigError,
  GoogleAdsNotConnectedError,
  GoogleAdsTokenError,
  refreshGoogleAdsTokens,
} from '@/utils/manageGoogleAuthTokens';
import {
  GoogleAdsApiError,
  listAccessibleGoogleAdsCustomers,
} from '@/utils/callGoogleAds';
import { PERMISSIONS } from '@repo/auth/permissions';
import {
  requireAdminMiddleware,
  requireAnyPermission,
} from '@/middleware/permission';
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_TARGET_TYPES,
  logAuditFromContext,
  type AuditAction,
  type AuditChangeMap,
  type AuditSeverity,
  type AuditStatus,
} from '@/utils/auditLog';
import type { AppContext, AppEnv } from '@/utils/errorJson';
import { Hono } from 'hono';

const googleAuth = new Hono<AppEnv>();

type ApiErrorResponse = {
  success: false;
  error: string;
  code: string;
  details?: unknown;
};

function errorResponse(
  message: string,
  code: string,
  status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503,
  details?: unknown
) {
  const body: ApiErrorResponse = {
    success: false,
    error: message,
    code,
  };

  if (details !== undefined) {
    body.details = details;
  }

  return { body, status };
}

function parseGoogleError(error: unknown) {
  if (error instanceof GoogleAdsConfigError) {
    return errorResponse(error.message, 'GOOGLE_ADS_CONFIG_MISSING', 503);
  }

  if (error instanceof GoogleAdsNotConnectedError) {
    return errorResponse(
      'Google Ads is not connected',
      'GOOGLE_ADS_NOT_CONNECTED',
      409
    );
  }

  if (error instanceof GoogleAdsTokenError) {
    const lower = error.publicMessage.toLowerCase();

    if (
      lower.includes('invalid_grant') ||
      lower.includes('invalid code') ||
      lower.includes('authorization code') ||
      lower.includes('code was already redeemed') ||
      lower.includes('malformed auth code')
    ) {
      return errorResponse(
        'Invalid or expired Google authorization code',
        'INVALID_AUTHORIZATION_CODE',
        400,
        error.raw
      );
    }

    if (
      lower.includes('invalid_client') ||
      lower.includes('unauthorized_client')
    ) {
      return errorResponse(
        'Google Ads OAuth client is misconfigured',
        'GOOGLE_ADS_CONFIG_INVALID',
        503,
        error.raw
      );
    }

    if (
      lower.includes('invalid_token') ||
      lower.includes('token has been expired') ||
      lower.includes('token has been revoked')
    ) {
      return errorResponse(
        'Google Ads access token is invalid or revoked. Please reconnect.',
        'INVALID_ACCESS_TOKEN',
        401,
        error.raw
      );
    }

    return errorResponse(
      error.publicMessage,
      'GOOGLE_ADS_TOKEN_ERROR',
      502,
      error.raw
    );
  }

  if (error instanceof GoogleAdsApiError) {
    const status =
      error.status === 400 ||
      error.status === 401 ||
      error.status === 403 ||
      error.status === 404 ||
      error.status === 409 ||
      error.status === 422 ||
      error.status === 429 ||
      error.status === 500 ||
      error.status === 502 ||
      error.status === 503
        ? error.status
        : 502;

    return errorResponse(error.publicMessage, error.code, status, error.raw);
  }

  if (!(error instanceof Error)) {
    return errorResponse('An unexpected error occurred', 'UNKNOWN_ERROR', 500);
  }

  const rawMessage = error.message || 'An unexpected error occurred';
  const lowerMessage = rawMessage.toLowerCase();

  if (
    lowerMessage.includes('network') ||
    lowerMessage.includes('fetch failed') ||
    lowerMessage.includes('timeout')
  ) {
    return errorResponse(
      'Unable to reach Google right now',
      'GOOGLE_ADS_UNAVAILABLE',
      503
    );
  }

  return errorResponse(rawMessage, 'INTERNAL_ERROR', 500);
}

function recordGoogleAudit(
  c: AppContext,
  input: {
    action: AuditAction;
    description: string;
    status?: AuditStatus;
    severity?: AuditSeverity;
    changes?: AuditChangeMap | null;
    metadata?: Record<string, unknown> | null;
  }
) {
  c.executionCtx.waitUntil(
    logAuditFromContext(c, {
      category: AUDIT_CATEGORIES.GOOGLE,
      targetType: AUDIT_TARGET_TYPES.GOOGLE_CONNECTION,
      targetId: 'google_ads',
      targetLabel: 'Google Ads',
      ...input,
    }).then(() => undefined)
  );
}

googleAuth.use('*', requireAdminMiddleware);

/**
 * Returns the Google OAuth consent URL (offline access + refresh token).
 * Admin UI should redirect the browser to this URL.
 */
googleAuth.get(
  '/auth-url',
  requireAnyPermission(PERMISSIONS.GOOGLE_CONNECTION_MANAGE),
  async (c) => {
    try {
      // Validate config early so the UI gets a clear error.
      assertGoogleAdsConfig(c.env);
      const url = buildGoogleAdsAuthUrl(c.env, 'google_ads');

      return c.json({
        success: true,
        url,
        state: 'google_ads',
      });
    } catch (error) {
      console.error('Error building Google Ads auth URL:', error);
      const response = parseGoogleError(error);
      return c.json(response.body, response.status);
    }
  }
);

googleAuth.get(
  '/connect',
  requireAnyPermission(PERMISSIONS.GOOGLE_CONNECTION_MANAGE),
  async (c) => {
    const code = c.req.query('code');

    if (!code || code.trim().length === 0) {
      recordGoogleAudit(c, {
        action: AUDIT_ACTIONS.GOOGLE_CONNECT,
        description:
          'Google Ads connection failed because the authorization code was missing',
        status: 'failure',
        severity: 'warning',
        metadata: { code: 'MISSING_AUTHORIZATION_CODE' },
      });

      return c.json(
        {
          success: false,
          error: 'Missing Google authorization code',
          code: 'MISSING_AUTHORIZATION_CODE',
        },
        400
      );
    }

    try {
      const tokens = await connectGoogleAds(c.env, code.trim());

      recordGoogleAudit(c, {
        action: AUDIT_ACTIONS.GOOGLE_CONNECT,
        description: 'Google Ads connected successfully',
        status: 'success',
        severity: 'info',
        changes: { connected: { from: false, to: true } },
        metadata: {
          expiresAt: tokens.expires_at,
          refreshExpiresAt: tokens.refresh_expires_at,
          refreshTokenObtainedAt: tokens.refresh_token_obtained_at,
        },
      });

      return c.json({
        success: true,
        message: 'Google Ads connected successfully',
        // Do not return raw tokens to the browser.
        connected: true,
        expires_at: tokens.expires_at,
        refresh_expires_at: tokens.refresh_expires_at,
        refresh_token_obtained_at: tokens.refresh_token_obtained_at,
      });
    } catch (error) {
      console.error('Error connecting Google Ads:', error);

      const response = parseGoogleError(error);
      recordGoogleAudit(c, {
        action: AUDIT_ACTIONS.GOOGLE_CONNECT,
        description: 'Google Ads connection failed',
        status: 'failure',
        severity: 'warning',
        metadata: { code: response.body.code },
      });

      return c.json(response.body, response.status);
    }
  }
);

googleAuth.get(
  '/disconnect',
  requireAnyPermission(PERMISSIONS.GOOGLE_CONNECTION_MANAGE),
  async (c) => {
    try {
      const status = await getGoogleAdsConnectionStatus(c.env);
      await disconnectGoogleAds(c.env);

      recordGoogleAudit(c, {
        action: AUDIT_ACTIONS.GOOGLE_DISCONNECT,
        description: 'Google Ads disconnected successfully',
        status: 'success',
        severity: 'warning',
        changes: { connected: { from: status.connected, to: false } },
        metadata: {
          previousExpiresAt: status.expires_at,
          previousRefreshExpiresAt: status.refresh_expires_at,
          previousRefreshTokenObtainedAt: status.refresh_token_obtained_at,
          wasConnected: status.connected,
        },
      });

      return c.json({
        success: true,
        message: 'Google Ads disconnected successfully',
      });
    } catch (error) {
      console.error('Error disconnecting Google Ads:', error);

      const response = parseGoogleError(error);
      recordGoogleAudit(c, {
        action: AUDIT_ACTIONS.GOOGLE_DISCONNECT,
        description: 'Google Ads disconnect failed',
        status: 'failure',
        severity: 'warning',
        metadata: { code: response.body.code },
      });

      return c.json(response.body, response.status);
    }
  }
);

googleAuth.get(
  '/status',
  requireAnyPermission(
    PERMISSIONS.GOOGLE_CONNECTION_REFRESH,
    PERMISSIONS.GOOGLE_CONNECTION_MANAGE,
    PERMISSIONS.GOOGLE_KEYWORD_RESEARCH
  ),
  async (c) => {
    try {
      let status = await getGoogleAdsConnectionStatus(c.env);
      if (
        status.connected &&
        status.should_refresh &&
        status.has_refresh_token
      ) {
        await refreshGoogleAdsTokens(c.env);
        status = await getGoogleAdsConnectionStatus(c.env);
      }
      return c.json({ success: true, ...status });
    } catch (error) {
      console.error('Error checking Google Ads connection status:', error);

      const response = parseGoogleError(error);
      return c.json(response.body, response.status);
    }
  }
);

googleAuth.get(
  '/accessible-customers',
  requireAnyPermission(
    PERMISSIONS.GOOGLE_CONNECTION_MANAGE,
    PERMISSIONS.GOOGLE_KEYWORD_RESEARCH
  ),
  async (c) => {
    try {
      const data = await listAccessibleGoogleAdsCustomers(c.env);
      return c.json({ success: true, data });
    } catch (error) {
      console.error('Error listing accessible Google Ads customers:', error);

      const response = parseGoogleError(error);
      return c.json(response.body, response.status);
    }
  }
);

googleAuth.get(
  '/refresh',
  requireAnyPermission(
    PERMISSIONS.GOOGLE_CONNECTION_REFRESH,
    PERMISSIONS.GOOGLE_CONNECTION_MANAGE
  ),
  async (c) => {
    try {
      const before = await getGoogleAdsConnectionStatus(c.env);

      if (!before.connected) {
        recordGoogleAudit(c, {
          action: AUDIT_ACTIONS.GOOGLE_TOKEN_REFRESH,
          description:
            'Google Ads token refresh failed because Google Ads is not connected',
          status: 'failure',
          severity: 'warning',
          metadata: { code: 'GOOGLE_ADS_NOT_CONNECTED' },
        });

        return c.json(
          {
            success: false,
            error: 'Google Ads is not connected',
            code: 'GOOGLE_ADS_NOT_CONNECTED',
          },
          409
        );
      }

      if (!before.can_refresh) {
        recordGoogleAudit(c, {
          action: AUDIT_ACTIONS.GOOGLE_TOKEN_REFRESH,
          description:
            'Google Ads token refresh failed because the refresh token is missing or expired',
          status: 'failure',
          severity: 'warning',
          metadata: {
            code: 'REFRESH_TOKEN_EXPIRED',
            refreshExpiresAt: before.refresh_expires_at,
            hasRefreshToken: before.has_refresh_token,
          },
        });

        return c.json(
          {
            success: false,
            error:
              'Google Ads refresh token is missing or expired. Please reconnect Google Ads.',
            code: 'REFRESH_TOKEN_EXPIRED',
            refresh_expires_at: before.refresh_expires_at,
          },
          401
        );
      }

      const tokens = await refreshGoogleAdsTokens(c.env);

      recordGoogleAudit(c, {
        action: AUDIT_ACTIONS.GOOGLE_TOKEN_REFRESH,
        description: 'Google Ads token refreshed successfully',
        status: 'success',
        severity: 'info',
        changes: {
          expiresAt: { from: before.expires_at, to: tokens.expires_at },
          refreshExpiresAt: {
            from: before.refresh_expires_at,
            to: tokens.refresh_expires_at,
          },
        },
        metadata: {
          expiresAt: tokens.expires_at,
          refreshExpiresAt: tokens.refresh_expires_at,
          refreshTokenObtainedAt: tokens.refresh_token_obtained_at,
        },
      });

      return c.json({
        success: true,
        message: 'Google Ads token refreshed successfully',
        connected: true,
        expires_at: tokens.expires_at,
        refresh_expires_at: tokens.refresh_expires_at,
        refresh_token_obtained_at: tokens.refresh_token_obtained_at,
      });
    } catch (error) {
      console.error('Error refreshing Google Ads access token:', error);

      const response = parseGoogleError(error);
      recordGoogleAudit(c, {
        action: AUDIT_ACTIONS.GOOGLE_TOKEN_REFRESH,
        description: 'Google Ads token refresh failed',
        status: 'failure',
        severity: 'warning',
        metadata: { code: response.body.code },
      });

      return c.json(response.body, response.status);
    }
  }
);

export default googleAuth;
