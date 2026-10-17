import { env } from "../env";

/**
 * Reviewed projection policy. Client IDs are chosen during deployment, not by the caller.
 * The backend receives every permission except the identity provider's own (`idp:*`), so a
 * permission created in the dashboard reaches it without a code change.
 */
export const ACCESS_PROJECTIONS = {
  backend: {
    clients: env.OAUTH_BACKEND_CLIENT_ID ? [env.OAUTH_BACKEND_CLIENT_ID] : [],
    fields: ["telegramId"],
  },
} as const;

export function projectionForClient(clientId: string) {
  return ACCESS_PROJECTIONS.backend.clients.includes(clientId) ? "backend" : null;
}
