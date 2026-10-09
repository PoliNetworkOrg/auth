import { env } from "../env";

/** Reviewed projection policy. Client IDs are chosen during deployment, not by the caller. */
export const ACCESS_PROJECTIONS = {
  backend: {
    clients: env.OAUTH_BACKEND_CLIENT_ID ? [env.OAUTH_BACKEND_CLIENT_ID] : [],
    prefixes: ["admin:", "tg:", "wa:", "groups:", "web:", "azure:"],
    fields: ["telegramId"],
  },
} as const;

export function projectionForClient(clientId: string) {
  return ACCESS_PROJECTIONS.backend.clients.includes(clientId) ? "backend" : null;
}
