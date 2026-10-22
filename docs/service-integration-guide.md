# Integrating a service with the PoliNetwork IdP

**Status:** current as of RFC v3 Phase 6 (October 2026).
**Scope:** every PoliNetwork service that signs people in, calls the backend, or authorizes requests with IdP permissions. This guide replaces RFC v3 §14 where they differ. The differences are listed at the end.

The IdP is the only source of identity and permissions. A service never stores its own roles, never trusts a Telegram ID or an ID token as permission, and checks **permissions**, never role names (RFC v3 §4, decisions 1 and 4).

## 1. Choose the integration level

| Level                       | Example                                | What the service does                                                                                                                                            | Revocation lag                                                                                                                                    |
| --------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Sign people in**       | polinet.cc, a new web app              | Registers an OIDC client, requests `polinetwork:identity` and reads `polinetwork_permissions` from the ID token or UserInfo.                                     | **As long as the app's session lasts**, unless the app re-reads UserInfo or refreshes. Re-check at least every 5 minutes, or keep sessions short. |
| **2. Call the backend**     | website, Telegram bot, admin dashboard | Gets an access token for the backend resource: client credentials for itself, or authorization code for a signed-in person. Sends it as `Authorization: Bearer`. | Set by the backend: about 1 s after an access change (§5.6).                                                                                      |
| **3. Run a privileged API** | backend                                | Verifies access tokens and authorizes each call against a local copy of the access snapshot.                                                                     | About 1 s (§5.6).                                                                                                                                 |

Most new services are level 1, or level 1 + 2. Level 3 needs changes to the IdP's code today (§5).

## 2. Level 1: sign people in

1. **Register the application** at `https://auth.polinetwork.org/applications/new`. You need `idp:applications:write`.
   - **Usage:** "Signs people in".
   - **Authentication:**
     - **Public (PKCE only)** for single-page and native apps.
     - **Client secret** or **private key** (`private_key_jwt`) for a server.
   - **Redirect URIs:** "Public https URLs only" for web apps; "Also localhost and app schemes" for native apps and local development.
   - **Scopes:** `openid`, plus `profile`, `email` and `offline_access` as needed, and `polinetwork:identity` only if the app needs permissions or the Telegram ID.
2. **Use authorization code with PKCE.** Discovery is at `https://auth.polinetwork.org/api/auth/.well-known/openid-configuration`, and the issuer is `https://auth.polinetwork.org/api/auth`.
3. **Validate every token:** signature, `iss`, `aud`, `exp`. Use an OIDC library, not hand-written checks.
4. **Authorize with permissions.** `polinetwork:identity` adds:
   - **`polinetwork_permissions`:** space-separated, empty when the person has none.
   - **`polinetwork_telegram_id`:** empty when no Telegram account is linked.
   - **The URL-named object claim**, described in the [README](../README.md#oidc-clients).

   Check for a specific permission, e.g. `rooms:book`. Roles are only labels for people; the claims also carry `roles` and `groups`, but services must not authorize on them.

5. **Keep permissions fresh.** The claims are a snapshot taken at sign-in. Re-read UserInfo or refresh at least every 5 minutes, or keep the session short. polinet.cc today keeps them for up to 7 days.

If the app needs new permissions, create them as in §4.

## 3. Level 2: call the backend

The backend accepts only IdP access tokens addressed to its resource (`OAUTH_BACKEND_RESOURCE_URI`). Every procedure declares, per kind of caller, the scope it needs and, for people, the permission they must hold. The backend's README, section "Authentication", has the full contract.

### 3.1 As the service itself (client credentials)

Used by the website (`backend:public:read`) and the Telegram bot (`backend:tg:*`).

1. **Register the application** (Master Admin only: API access is privileged).
   - **Usage:** "Calls APIs as itself".
   - **Authentication:** private key. Paste the **public** Ed25519 or P-256 JWKS.
   - **Scopes for the app itself:** only the backend scopes it needs. Resource links follow the scopes when you save.

   | Scope                                                                                                     | For                                                                              |
   | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
   | `backend:public:read`                                                                                     | public data (groups, website content)                                            |
   | `backend:tg:read`, `backend:tg:ingest`, `backend:tg:groups:sync`, `backend:tg:audit`, `backend:tg:events` | the Telegram bot                                                                 |
   | `backend:tg:act-as`                                                                                       | acting for a linked Telegram user with `X-PN-Actor: telegram:<id>`; the bot only |

2. **Keep the private key in Key Vault**, as its own secret, mounted only into this service through its `SecretProviderClass` / `ExternalSecret` in `polinetwork-cd`. Never paste a private key into the IdP.
3. **Get tokens with `auth-kit`:**

   ```ts
   import { idpEndpoints, serviceTokenSource } from "@polinetwork/auth-kit";

   const endpoints = idpEndpoints({
     publicUrl: env.IDP_PUBLIC_URL,
     internalUrl: env.IDP_INTERNAL_URL,
   });
   const tokens = serviceTokenSource({
     clientId: env.OAUTH_MY_SERVICE_CLIENT_ID,
     privateKey: JSON.parse(env.OAUTH_MY_SERVICE_PRIVATE_JWK), // JWK with kid, alg (EdDSA or ES256), d
     tokenUrl: endpoints.tokenUrl,
     tokenAudience: endpoints.tokenAudience,
     resource: env.OAUTH_BACKEND_RESOURCE_URI,
     scopes: ["backend:public:read"],
   });

   // On each request:
   headers.Authorization = `Bearer ${await tokens.getToken()}`;
   ```

   - **Caching and renewal:** tokens are cached and renewed at 50% of their lifetime, and concurrent callers share one request.
   - **On a `401` from the backend:** call `tokens.invalidate()` and retry once. A 401 is decided before the procedure runs, so retrying a mutation is safe.
   - **Reference:** `web/src/lib/backend.ts`.

4. **Call the backend in-cluster**, at `http://backend-service.backend.svc.cluster.local:3000`. The backend has no public route since Phase 6, and its NetworkPolicy admits only the callers listed in `polinetwork-cd/apps/backend/network-policy.yaml`. Add the new service there.

### 3.2 For a signed-in person (authorization code)

Used by the admin dashboard.

- **Registration:** register the app as "Signs people in" with `openid profile email offline_access`, and grant `backend:admin` for signed-in people.
- **Token request:** request the access token with `resource=<OAUTH_BACKEND_RESOURCE_URI>`, so it is a JWT addressed to the backend.
- **Server-side only:** keep tokens on the server (backend-for-frontend) and call the backend from server functions.
- **Reference:** `admin/src/server/auth-config.ts`.

## 4. Permissions and roles

1. **Create the permissions** at `/access/permissions/new`, e.g. `rooms:book` and `rooms:manage`. Keys match `^[a-z0-9]([a-z0-9._:-]*[a-z0-9])?$`; prefix them with the service's name.
2. **Attach them to roles** at `/access/roles/$roleId`. Which roles get which permissions is runtime configuration chosen by administrators (decision 11), not code.
3. **Master Admin holds every permission**, including future ones (decision 10).
4. **Removing or renaming a permission** silently denies whoever relied on it. Change the service and the roles together.

## 5. Level 3: a new resource server

Today the IdP serves one external resource server, the backend, besides its own MCP server (`/api/mcp`). Adding another service that verifies tokens and uses the access snapshot needs **a code change to the IdP**, reviewed like any change to authorization rules:

| What                                                         | Where in `auth`                                                                                                              |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| A resource (identifier, TTLs, allowed scopes)                | `serviceResources` in `src/auth/index.ts` and a new `OAUTH_*_RESOURCE_URI` setting in `src/env.ts`                           |
| The scopes                                                   | `apiScopes` and `oidcResources` in `src/auth/oidc-clients.ts`; `isApiScope` decides which scopes are privileged              |
| A projection (which permissions and fields the service sees) | `ACCESS_PROJECTIONS` in `src/auth/access-projections.ts` and the projection name hard-coded in `src/auth/access-snapshot.ts` |
| Access-changed events                                        | `src/auth/access-dispatcher.ts` sends only to `OAUTH_BACKEND_EVENTS_URL`                                                     |

On the service side, follow the backend (`backend/src/idp/`):

| `auth-kit` export                                               | Use                                                                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `createKeyStore({ jwksUrl, persistence })`                      | last-known-good JWKS; call `start()`                                                                   |
| `verifyAccessToken(token, { issuer, audience, keyStore })`      | returns `{ kind, clientId, sub, scopes, claims }`                                                      |
| `resolveActor(verified, { actorHeader, actAsScope, snapshot })` | the request's `Actor`: `service`, `telegram` or `user`                                                 |
| `accessSnapshot({ url, tokens, projection, persistence })`      | polled local copy; `has(actor, permission)` denies for services, unknown subjects and a stale snapshot |
| `createAccessEventHandler({ … })`                               | Fetch handler for the IdP's events, mounted on an internal path                                        |

Enforcement is deny-by-default: every operation declares its scope and permission per kind of caller, as in `backend/src/trpc.ts` (`policy()`) and `backend/src/idp/policies.ts`.

## 6. Keys and rotation

- **Signing keys:** the IdP's JWT keys rotate every 7 days, and their public keys overlap for 30 days. `auth-kit`'s key store follows the rotation.
- **Rotating a client's private key:**
  1. add the new public key to the application's JWKS;
  2. deploy the matching private key to the service;
  3. after the overlap, remove the old public key.

## 7. Checklist

- [ ] Level chosen, and the smallest set of scopes listed.
- [ ] Permissions created and attached to roles (§4).
- [ ] Application registered.
- [ ] Private key, if any, stored in Key Vault and mounted only into this service.
- [ ] Tokens validated with a library or `auth-kit`.
- [ ] Authorization checks permissions, never roles.
- [ ] Level 2: service added to the backend NetworkPolicy in `polinetwork-cd`.
- [ ] Level 3: IdP change reviewed (§5).

## Differences from RFC v3 §14

- `serviceTokenSource` takes `privateKey`, `tokenUrl` and `tokenAudience`. `idpEndpoints()` computes the last two.
- `createKeyStore` takes `jwksUrl` and `persistence`, and must be started.
- `verifyAccessToken` also needs `issuer` and returns the verified token. The actor comes from `resolveActor`.
- The event receiver is `createAccessEventHandler`, separate from `accessSnapshot`.
- Projections have no `prefixes`. The single `backend` projection carries every permission except the IdP's own `idp:*`.
- A new resource server needs IdP code changes (§5), not only configuration.
