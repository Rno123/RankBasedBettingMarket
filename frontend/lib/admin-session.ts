export const ADMIN_SESSION_MESSAGE = "hackbet:admin:request";
export const ADMIN_SESSION_COOKIE = "hackbet_admin_session";
export const ADMIN_SESSION_BOOTSTRAP_ACTION = "session:start";
export const ADMIN_SESSION_TTL_MS = 5 * 60 * 1000;
export const ADMIN_SESSION_COOKIE_TTL_MS = 15 * 60 * 1000;
export const ADMIN_SESSION_CLOCK_SKEW_MS = 30 * 1000;

export interface AdminSessionPayload {
  action: string;
  issuedAt: string;
  resource?: string | null;
  walletAddress: string;
}

export function buildAdminSessionMessage(payload: AdminSessionPayload): string {
  return [
    ADMIN_SESSION_MESSAGE,
    "purpose=Admin sign-in only. This does not send a transaction.",
    `action=${payload.action}`,
    `wallet=${payload.walletAddress}`,
    `resource=${payload.resource ?? "*"}`,
    `issued_at=${payload.issuedAt}`,
  ].join("\n");
}
