import type { oauthClient } from "../db/schema";

type ClientPolicyRow = Pick<
  typeof oauthClient.$inferSelect,
  "tokenEndpointAuthMethod" | "clientCredentialsScopes" | "scopes"
>;

export function isServiceClient(row: ClientPolicyRow) {
  return (
    row.tokenEndpointAuthMethod === "private_key_jwt" ||
    Boolean(row.clientCredentialsScopes?.length) ||
    Boolean(
      row.scopes?.some((scope) => scope.startsWith("backend:") || scope === "idp:access:read"),
    )
  );
}
