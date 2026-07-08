import {
  connectAliExpress,
  disconnectAliExpress,
  getAccessToken,
  getAliExpressConnectionStatus,
  refreshAliExpressTokens
} from "@/utils/manageAEauthTokens";
import type Env from "@/types/env";
import { Hono } from "hono";

const aeAuth = new Hono<{ Bindings: Env }>();

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
  if (!(error instanceof Error)) {
    return errorResponse(
      "An unexpected error occurred",
      "UNKNOWN_ERROR",
      500
    );
  }

  const rawMessage = error.message || "An unexpected error occurred";

  const possibleJson = rawMessage
    .replace(/^AliExpress token create error:\s*/i, "")
    .replace(/^AliExpress token refresh error:\s*/i, "")
    .replace(/^AliExpress API error:\s*/i, "");

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
      "ALIEXPRESS_ERROR";

    if (
      aliExpressCode === "invalid_grant" ||
      aliExpressCode === "invalid_code" ||
      message.toLowerCase().includes("invalid code") ||
      message.toLowerCase().includes("authorization code")
    ) {
      return errorResponse(
        "Invalid or expired AliExpress authorization code",
        "INVALID_AUTHORIZATION_CODE",
        400,
        parsed
      );
    }

    if (
      aliExpressCode === "invalid_token" ||
      message.toLowerCase().includes("invalid token") ||
      message.toLowerCase().includes("expired token")
    ) {
      return errorResponse(
        "AliExpress access token is invalid or expired",
        "INVALID_ACCESS_TOKEN",
        401,
        parsed
      );
    }

    if (
      message.toLowerCase().includes("permission") ||
      message.toLowerCase().includes("forbidden") ||
      aliExpressCode === "forbidden"
    ) {
      return errorResponse(
        "AliExpress permission was denied",
        "ALIEXPRESS_PERMISSION_DENIED",
        403,
        parsed
      );
    }

    return errorResponse(
      message,
      String(aliExpressCode),
      502,
      parsed
    );
  } catch {
    const lowerMessage = rawMessage.toLowerCase();

    if (lowerMessage.includes("not connected")) {
      return errorResponse(
        "AliExpress is not connected",
        "ALIEXPRESS_NOT_CONNECTED",
        409
      );
    }

    if (
      lowerMessage.includes("network") ||
      lowerMessage.includes("fetch failed") ||
      lowerMessage.includes("timeout")
    ) {
      return errorResponse(
        "Unable to reach AliExpress right now",
        "ALIEXPRESS_UNAVAILABLE",
        503
      );
    }

    return errorResponse(
      rawMessage,
      "INTERNAL_ERROR",
      500
    );
  }
}

aeAuth.get("/connect", async (c) => {
  const code = c.req.query("code");

  if (!code || code.trim().length === 0) {
    return c.json(
      {
        success: false,
        error: "Missing AliExpress authorization code",
        code: "MISSING_AUTHORIZATION_CODE",
      },
      400
    );
  }

  try {
    const tokens = await connectAliExpress(c.env, code.trim());

    return c.json({
      success: true,
      message: "AliExpress connected successfully",
      tokens,
    });
  } catch (error) {
    console.error("Error connecting AliExpress:", error);

    const response = parseAliExpressError(error);
    return c.json(response.body, response.status);
  }
});

aeAuth.get("/disconnect", async (c) => {
  try {
    await disconnectAliExpress(c.env);

    return c.json({
      success: true,
      message: "AliExpress disconnected successfully",
    });
  } catch (error) {
    console.error("Error disconnecting AliExpress:", error);

    const response = parseAliExpressError(error);
    return c.json(response.body, response.status);
  }
});

aeAuth.get("/status", async (c) => {
  try {
    const status = await getAliExpressConnectionStatus(c.env);
    return c.json({ success: true, ...status });
  } catch (error) {
    console.error("Error checking AliExpress connection status:", error);

    const response = parseAliExpressError(error);
    return c.json(response.body, response.status);
  }
});

aeAuth.get("/refresh", async (c) => {
  try {
    const accessToken = await getAccessToken(c.env);

    if (!accessToken) {
      return c.json(
        {
          success: false,
          error: "AliExpress is not connected",
          code: "ALIEXPRESS_NOT_CONNECTED",
        },
        409
      );
    }

    const tokens = await refreshAliExpressTokens(c.env);
    return c.json({
      success: true,
      message: "AliExpress token refreshed successfully",
      tokens,
      expires_at: tokens.expires_at,
    });
  } catch (error) {
    console.error("Error refreshing AliExpress access token:", error);

    const response = parseAliExpressError(error);
    return c.json(response.body, response.status);
  }
});

export default aeAuth;