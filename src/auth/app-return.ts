import { eq } from "drizzle-orm";
import { db } from "@/db/index";
import { oauthClient } from "@/db/schema";
import { isRegisteredRedirect, responseModeOf, type ClientReturn } from "./sign-in-errors";

export type ReturningApp = { name: string; logo: string | null; logoDark: string | null };

/**
 * Where an authorization request can be answered, the way the provider plugin answers its own
 * errors: an enabled client and one of its registered redirect URIs. Null when either is
 * missing, so a request Auth never accepted can't send anyone anywhere (RFC 6749 §4.1.2.1).
 */
export async function resolveClientReturn(
  request: URLSearchParams,
): Promise<{ app: ReturningApp; target: ClientReturn } | null> {
  const clientId = request.get("client_id");
  const redirectUri = request.get("redirect_uri");
  if (!clientId || !redirectUri) return null;
  const [client] = await db
    .select({
      name: oauthClient.name,
      icon: oauthClient.icon,
      iconDark: oauthClient.iconDark,
      redirectUris: oauthClient.redirectUris,
      disabled: oauthClient.disabled,
    })
    .from(oauthClient)
    .where(eq(oauthClient.clientId, clientId));
  if (!client || client.disabled || !isRegisteredRedirect(client.redirectUris, redirectUri))
    return null;
  return {
    app: {
      name: client.name ?? "the application",
      logo: client.icon ?? null,
      logoDark: client.iconDark ?? null,
    },
    target: {
      redirectUri,
      state: request.get("state") ?? undefined,
      responseMode: responseModeOf(request),
    },
  };
}
