import {
  AliExpressNotConnectedError,
  AliExpressTokenError,
  connectAliExpress,
  disconnectAliExpress,
  getAliExpressConnectionStatus,
  refreshAliExpressTokens,
} from '@/utils/manageAEauthTokens';
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

const aeAuth = new Hono<AppEnv>();

type ApiErrorResponse = {
  success: false;
  error: string;
  code: string;
  details?: unknown;
};

function errorResponse(
  message: string,
  code: string,
  status: 400 | 401 | 403 | 404 | 409 | 422 | 500 | 502 | 503,
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

  return {
    body,
    status,
  };
}

function parseAliExpressError(error: unknown) {
  if (error instanceof AliExpressNotConnectedError) {
    return errorResponse(
      'AliExpress is not connected',
      'ALIEXPRESS_NOT_CONNECTED',
      409
    );
  }

  if (error instanceof AliExpressTokenError) {
    const lower = error.publicMessage.toLowerCase();
    if (
      lower.includes('refresh token has expired') ||
      lower.includes('refresh_token_expired')
    ) {
      return errorResponse(
        'AliExpress refresh token has expired. Please reconnect AliExpress.',
        'REFRESH_TOKEN_EXPIRED',
        401,
        error.raw
      );
    }
  }

  if (!(error instanceof Error)) {
    return errorResponse('An unexpected error occurred', 'UNKNOWN_ERROR', 500);
  }

  const rawMessage = error.message || 'An unexpected error occurred';

  const possibleJson = rawMessage
    .replace(/^AliExpress token create (?:error|failed):\s*/i, '')
    .replace(/^AliExpress token refresh (?:error|failed):\s*/i, '')
    .replace(/^AliExpress API error:\s*/i, '');

  try {
    const parsed = JSON.parse(possibleJson);

    const message =
      parsed.message ||
      parsed.error_description ||
      parsed.errorMessage ||
      parsed.msg ||
      rawMessage;

    const aliExpressCode =
      parsed.code ||
      parsed.error ||
      parsed.error_code ||
      parsed.errorCode ||
      'ALIEXPRESS_ERROR';

    if (
      aliExpressCode === 'invalid_grant' ||
      aliExpressCode === 'invalid_code' ||
      message.toLowerCase().includes('invalid code') ||
      message.toLowerCase().includes('authorization code')
    ) {
      return errorResponse(
        'Invalid or expired AliExpress authorization code',
        'INVALID_AUTHORIZATION_CODE',
        400,
        parsed
      );
    }

    if (
      aliExpressCode === 'invalid_token' ||
      message.toLowerCase().includes('invalid token') ||
      message.toLowerCase().includes('expired token')
    ) {
      return errorResponse(
        'AliExpress access token is invalid or expired',
        'INVALID_ACCESS_TOKEN',
        401,
        parsed
      );
    }

    if (
      message.toLowerCase().includes('permission') ||
      message.toLowerCase().includes('forbidden') ||
      aliExpressCode === 'forbidden'
    ) {
      return errorResponse(
        'AliExpress permission was denied',
        'ALIEXPRESS_PERMISSION_DENIED',
        403,
        parsed
      );
    }

    return errorResponse(message, String(aliExpressCode), 502, parsed);
  } catch {
    const lowerMessage = rawMessage.toLowerCase();

    if (lowerMessage.includes('not connected')) {
      return errorResponse(
        'AliExpress is not connected',
        'ALIEXPRESS_NOT_CONNECTED',
        409
      );
    }

    if (
      lowerMessage.includes('network') ||
      lowerMessage.includes('fetch failed') ||
      lowerMessage.includes('timeout')
    ) {
      return errorResponse(
        'Unable to reach AliExpress right now',
        'ALIEXPRESS_UNAVAILABLE',
        503
      );
    }

    return errorResponse(rawMessage, 'INTERNAL_ERROR', 500);
  }
}

function recordAliExpressAudit(
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
      category: AUDIT_CATEGORIES.AE,
      targetType: AUDIT_TARGET_TYPES.AE_CONNECTION,
      targetId: 'aliexpress',
      targetLabel: 'AliExpress',
      ...input,
    }).then(() => undefined)
  );
}

aeAuth.use('*', requireAdminMiddleware);

aeAuth.get(
  '/connect',
  requireAnyPermission(PERMISSIONS.AE_CONNECTION_MANAGE),
  async (c) => {
    const code = c.req.query('code');

    if (!code || code.trim().length === 0) {
      recordAliExpressAudit(c, {
        action: AUDIT_ACTIONS.AE_CONNECT,
        description:
          'AliExpress connection failed because the authorization code was missing',
        status: 'failure',
        severity: 'warning',
        metadata: { code: 'MISSING_AUTHORIZATION_CODE' },
      });

      return c.json(
        {
          success: false,
          error: 'Missing AliExpress authorization code',
          code: 'MISSING_AUTHORIZATION_CODE',
        },
        400
      );
    }

    try {
      // Reconnect is intentional: exchange the new auth code and overwrite KV
      // tokens in place so callers never hit an empty-token window.
      const before = await getAliExpressConnectionStatus(c.env);
      const wasConnected = before.connected;
      const tokens = await connectAliExpress(c.env, code.trim());

      recordAliExpressAudit(c, {
        action: AUDIT_ACTIONS.AE_CONNECT,
        description: wasConnected
          ? 'AliExpress reconnected successfully (tokens replaced)'
          : 'AliExpress connected successfully',
        status: 'success',
        severity: 'info',
        changes: wasConnected
          ? {
              expiresAt: {
                from: before.expires_at,
                to: tokens.expires_at,
              },
              refreshExpiresAt: {
                from: before.refresh_expires_at,
                to: tokens.refresh_expires_at,
              },
            }
          : { connected: { from: false, to: true } },
        metadata: {
          reconnected: wasConnected,
          expiresAt: tokens.expires_at,
          refreshExpiresAt: tokens.refresh_expires_at,
          previousExpiresAt: before.expires_at,
          previousRefreshExpiresAt: before.refresh_expires_at,
        },
      });

      // Never return raw tokens to the browser.
      return c.json({
        success: true,
        message: wasConnected
          ? 'AliExpress reconnected successfully'
          : 'AliExpress connected successfully',
        connected: true,
        reconnected: wasConnected,
        expires_at: tokens.expires_at,
        refresh_expires_at: tokens.refresh_expires_at,
      });
    } catch (error) {
      console.error('Error connecting AliExpress:', error);

      const response = parseAliExpressError(error);
      recordAliExpressAudit(c, {
        action: AUDIT_ACTIONS.AE_CONNECT,
        description: 'AliExpress connection failed',
        status: 'failure',
        severity: 'warning',
        metadata: { code: response.body.code },
      });

      return c.json(response.body, response.status);
    }
  }
);

aeAuth.get(
  '/disconnect',
  requireAnyPermission(PERMISSIONS.AE_CONNECTION_MANAGE),
  async (c) => {
    try {
      const status = await getAliExpressConnectionStatus(c.env);
      await disconnectAliExpress(c.env);

      recordAliExpressAudit(c, {
        action: AUDIT_ACTIONS.AE_DISCONNECT,
        description: 'AliExpress disconnected successfully',
        status: 'success',
        severity: 'warning',
        changes: { connected: { from: status.connected, to: false } },
        metadata: {
          previousExpiresAt: status.expires_at,
          previousRefreshExpiresAt: status.refresh_expires_at,
          wasConnected: status.connected,
        },
      });

      return c.json({
        success: true,
        message: 'AliExpress disconnected successfully',
      });
    } catch (error) {
      console.error('Error disconnecting AliExpress:', error);

      const response = parseAliExpressError(error);
      recordAliExpressAudit(c, {
        action: AUDIT_ACTIONS.AE_DISCONNECT,
        description: 'AliExpress disconnect failed',
        status: 'failure',
        severity: 'warning',
        metadata: { code: response.body.code },
      });

      return c.json(response.body, response.status);
    }
  }
);

aeAuth.get(
  '/status',
  requireAnyPermission(
    PERMISSIONS.AE_CONNECTION_REFRESH,
    PERMISSIONS.AE_CONNECTION_MANAGE
  ),
  async (c) => {
    try {
      let status = await getAliExpressConnectionStatus(c.env);
      if (status.connected && status.should_refresh) {
        await refreshAliExpressTokens(c.env);
        status = await getAliExpressConnectionStatus(c.env);
      }
      return c.json({ success: true, ...status });
    } catch (error) {
      console.error('Error checking AliExpress connection status:', error);

      const response = parseAliExpressError(error);
      return c.json(response.body, response.status);
    }
  }
);

aeAuth.get(
  '/refresh',
  requireAnyPermission(
    PERMISSIONS.AE_CONNECTION_REFRESH,
    PERMISSIONS.AE_CONNECTION_MANAGE
  ),
  async (c) => {
    try {
      const before = await getAliExpressConnectionStatus(c.env);

      if (!before.connected) {
        recordAliExpressAudit(c, {
          action: AUDIT_ACTIONS.AE_TOKEN_REFRESH,
          description:
            'AliExpress token refresh failed because AliExpress is not connected',
          status: 'failure',
          severity: 'warning',
          metadata: { code: 'ALIEXPRESS_NOT_CONNECTED' },
        });

        return c.json(
          {
            success: false,
            error: 'AliExpress is not connected',
            code: 'ALIEXPRESS_NOT_CONNECTED',
          },
          409
        );
      }

      if (!before.can_refresh) {
        recordAliExpressAudit(c, {
          action: AUDIT_ACTIONS.AE_TOKEN_REFRESH,
          description:
            'AliExpress token refresh failed because the refresh token has expired',
          status: 'failure',
          severity: 'warning',
          metadata: {
            code: 'REFRESH_TOKEN_EXPIRED',
            refreshExpiresAt: before.refresh_expires_at,
          },
        });

        return c.json(
          {
            success: false,
            error:
              'AliExpress refresh token has expired. Please reconnect AliExpress.',
            code: 'REFRESH_TOKEN_EXPIRED',
            refresh_expires_at: before.refresh_expires_at,
          },
          401
        );
      }

      const tokens = await refreshAliExpressTokens(c.env);

      recordAliExpressAudit(c, {
        action: AUDIT_ACTIONS.AE_TOKEN_REFRESH,
        description: 'AliExpress token refreshed successfully',
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
        },
      });

      return c.json({
        success: true,
        message: 'AliExpress token refreshed successfully',
        connected: true,
        expires_at: tokens.expires_at,
        refresh_expires_at: tokens.refresh_expires_at,
      });
    } catch (error) {
      console.error('Error refreshing AliExpress access token:', error);

      const response = parseAliExpressError(error);
      recordAliExpressAudit(c, {
        action: AUDIT_ACTIONS.AE_TOKEN_REFRESH,
        description: 'AliExpress token refresh failed',
        status: 'failure',
        severity: 'warning',
        metadata: { code: response.body.code },
      });

      return c.json(response.body, response.status);
    }
  }
);

export default aeAuth;
