# Integrating a service with the PoliNetwork IdP

**Status:** current as of RFC v3 Phase 6 (October 2026).
**Scope:** every PoliNetwork service that signs people in, calls the backend, or authorizes requests with IdP permissions. This guide replaces RFC v3 §14 where they differ. The differences are listed at the end.

The IdP is the only source of identity and permissions. A service never stores its own roles and never treats a Telegram ID, or the mere presence of an ID token, as permission. It checks **permissions**, never role names: a Level 1 service authorizes from the validated `polinetwork_permissions` claim (RFC v3 §4, decisions 1 and 4).

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
   - **`polinetwork_permission_list`:** the same permissions as an array, for tools that match a list claim (oauth2-proxy).
   - **`polinetwork_telegram_id`:** empty when no Telegram account is linked.
   - **`polinetwork_name_verified`:** `true` when the person's name comes from the association's directory (PoliNetwork APS), `false` when they declared it themselves. See §2.2.
   - **The URL-named object claim**, described in the [README](../README.md#oidc-clients).

   Check for a specific permission, e.g. `rooms:book`. Roles are only labels for people; the claims also carry `roles` and `groups`, but services must not authorize on them.

5. **Keep permissions fresh.** The claims are a snapshot taken at sign-in. Re-read UserInfo or refresh at least every 5 minutes, or keep the session short. polinet.cc today keeps them for up to 7 days.
6. **Handle sign-in errors.** See §2.1.

If the app needs new permissions, create them as in §4.

### 2.1 Errors your redirect URI can receive

When a sign-in fails and your `redirect_uri` is registered, Auth sends the browser back to it the way OAuth expects (RFC 6749 §4.1.2.1, OIDC Core §3.1.2.6). The response has `error`, an `error_description` for logs (not for display), your `state`, and `iss` (RFC 9207). It's in the query, or in the fragment if the request asked for that. Check `state` as you would for a success.

| `error`                                                                            | When                                                                                                                                                                                                                            | What to do                                                                                                                            |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `access_denied`                                                                    | The person cancelled at the provider or on the consent screen. Or Auth refused the account (for example an Entra guest choosing PoliNetwork APS), explained it on its own page, and the person chose **Back to {application}**. | Don't sign them in. Say they can try again, and don't restart on your own.                                                            |
| `login_required`                                                                   | The sign-in page expired (it lasts 10 minutes), or `prompt=none` found no session.                                                                                                                                              | Start a new sign-in, once, keeping the page the person was going to. If it comes back again, stop and show an error, to avoid a loop. |
| `server_error`                                                                     | A sign-in failed in some other way, Auth showed its error page, and the person chose **Back to {application}**.                                                                                                                 | Show a generic error with **Try again**.                                                                                              |
| `invalid_request`, `invalid_scope`, `unsupported_response_type`, `invalid_target`… | The request itself is wrong.                                                                                                                                                                                                    | Fix the application.                                                                                                                  |

Some failures never reach the application:

- **An unknown or disabled client, or an unregistered `redirect_uri`:** Auth can't trust where to send the person, so it shows its own error page with the code (`invalid_client`, `client_disabled`, `invalid_redirect`…).
- **Most failures at the provider, except a cancel:** Auth explains them on its own error page, with **Try again**, which starts the same authorization request again, and **Back to {application}**. Only a person who chooses to go back reaches you, with `access_denied` or `server_error`.

### 2.2 Names

`profile` gives `name`, `given_name` and `family_name`. Auth stores the first and last name separately, so `given_name` and `family_name` are exact ("Maria" and "De Luca"), never a split of `name`; `name` is their join. Read the two parts rather than splitting `name` yourself.

Where a name comes from decides how far to trust it:

- **Verified** (`polinetwork_name_verified: true`): the person has a PoliNetwork APS account, and the name is the directory's. The association created that account with their real name, and they can't change it in Auth.
- **Self-declared** (`false`): anyone else, Google users included. The person confirmed it at their first sign-in, and can change it a few times a month; every change is audited. Mark it as self-declared wherever it matters who someone is (an approval, a signature, a list administrators act on), and don't treat it as proof of identity.

Names can change, verified ones included (after a change in the directory, or when someone links or unlinks PoliNetwork APS). Refresh them like permissions: re-read UserInfo, or take them from the next token.

The backend gets the same information from the access snapshot and the internal People and e-signing endpoints, as `nameVerified` (and `givenName`/`familyName` where names are listed).

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

## 7. Ask someone to link a login method

An application can send a person to link Telegram, PoliNetwork APS or Google to their PoliNetwork Auth account, and get them back afterwards. Use it when the app needs something that only a linked account gives, for example the Telegram ID that bots match permissions to. Open it as a normal navigation, not in a frame (Auth refuses to be framed):

```
https://auth.polinetwork.org/link?method=telegram&client_id=<client id>&return_to=<url>
```

| Parameter   | Value                                                                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `method`    | `telegram`, `pn-entra` (PoliNetwork APS) or `google`.                                                                                                                  |
| `client_id` | The application's client ID.                                                                                                                                           |
| `return_to` | Where to come back to: an absolute URL with the **same origin** (scheme, host and port) as one of the application's registered redirect URIs, at most 2048 characters. |

**What the person sees:**

1. **Not signed in:** the usual sign-in page, then the next step. **Not now, back to {application}** under it returns `link_error=cancelled`.
2. **Already linked:** a note saying so, with **Back to {application}**.
3. **Otherwise:** a confirmation card, "{application} asks you to link your Telegram account to PoliNetwork Auth", with **Link Telegram** and **Not now**. Nothing starts without that click.
4. **After the provider:** a redirect to `return_to`, with one of these query parameters added (any `linked` or `link_error` already there is replaced). Auth goes back by itself only when the person clicked **Link** in this browser, for the same method and `return_to`, in the last 10 minutes. Otherwise, as when the result needs explaining, it shows the result with **Back to {application}**, which adds the same parameter:

| Result                      | Meaning                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `linked=<method>`           | The method is linked, or already was. Refresh whatever you read from the person's identity (the Telegram ID in `polinetwork_telegram_id`, membership). |
| `link_error=cancelled`      | The person chose **Not now**, or cancelled at the provider. Nothing changed; don't show an error.                                                      |
| `link_error=account_in_use` | That login already belongs to another PoliNetwork Auth user. Auth explains this before sending the person back.                                        |
| `link_error=unavailable`    | This deployment can't link that method right now.                                                                                                      |
| `link_error=failed`         | Anything else. The person can try again.                                                                                                               |

**Trust:** `return_to` counts only for an enabled application registered from the application pages, and only on the origin of one of its redirect URIs. Clients that agents registered for themselves never count. When `client_id` is missing or unknown, or `return_to` doesn't match, the page names no application and keeps the person on PoliNetwork Auth: it never redirects to an address the application didn't register. The outcome is not a proof: the app must read the person's identity again (UserInfo, a refreshed token or the backend), not trust `linked` on its own.

## 8. Checklist

- [ ] Level chosen, and the smallest set of scopes listed.
- [ ] Permissions created and attached to roles (§4).
- [ ] Application registered.
- [ ] Private key, if any, stored in Key Vault and mounted only into this service.
- [ ] Tokens validated with a library or `auth-kit`.
- [ ] Authorization checks permissions, never roles.
- [ ] Names read from `given_name`/`family_name`, and shown as self-declared when `polinetwork_name_verified` is false (§2.2).
- [ ] Level 2: service added to the backend NetworkPolicy in `polinetwork-cd`.
- [ ] Level 3: IdP change reviewed (§5).

## Differences from RFC v3 §14

- `serviceTokenSource` takes `privateKey`, `tokenUrl` and `tokenAudience`. `idpEndpoints()` computes the last two.
- `createKeyStore` takes `jwksUrl` and `persistence`, and must be started.
- `verifyAccessToken` also needs `issuer` and returns the verified token. The actor comes from `resolveActor`.
- The event receiver is `createAccessEventHandler`, separate from `accessSnapshot`.
- Projections have no `prefixes`. The single `backend` projection carries every permission except the IdP's own `idp:*`.
- A new resource server needs IdP code changes (§5), not only configuration.
