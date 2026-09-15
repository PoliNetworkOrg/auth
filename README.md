# PoliNetwork Identity prototype

A standalone TanStack Start and Better Auth identity provider. The backend remains the active authentication provider for all existing PoliNetwork applications. This repository does not change backend authentication, migrate production data, or grant Telegram moderation access.

## Run locally

Use Node and pnpm through Vite+.

1. Run `vp install`.
2. Copy `.env.example` to `.env.local`, set a random secret, and point the `DB_*` variables at a **new, separate PostgreSQL database**.
3. Set `BETTER_AUTH_URL=http://localhost:3000` for local development.
4. Run `vp run db:migrate` to apply the checked-in migration to that database.
5. Run `vp run dev` and open the origin set in `BETTER_AUTH_URL`.

Providers are disabled until their credentials are configured. The page shows which methods are available. Production uses `vp run build` and `vp run start`, with environment variables supplied by the host. The start command takes a PostgreSQL advisory lock, applies the checked-in Drizzle migrations, and starts the web server only after they succeed. This keeps simultaneous container replicas from applying the same migration. A migration failure stops the process instead of serving against an outdated schema. Use HTTPS in production.

The included `Dockerfile` builds the app and runs the same migration-first startup command as an unprivileged user. Supply the `DB_*` variables and the other production variables at runtime; do not bake an environment file into the image. The migration connection must go directly to PostgreSQL or through a session-pooling endpoint because PostgreSQL advisory locks belong to a database session. If the deployment platform supports a single migration job before rollout, running this bootstrap there is preferable to making every replica wait for the lock.

Google and PoliNetwork Entra create accounts. Once signed in, users can add a passkey from the account page and use it for future logins. Signed-out visitors see a login form with configured providers and passkey sign-in. Email/password login is disabled. The server rejects direct Telegram sign-in requests and protects the last Google or PoliNetwork Entra account from being disconnected, including when passkeys or verifier accounts remain linked.

Roles and permissions require the checked-in `0004` and `0005` migrations, which also move each account's single proven state into a list so one Entra identity can prove both Socio and Direttivo. `0004` carries the old `state` column into the new `states` list and seeds the built-in roles before `0005` drops it, so apply them in order and never `0005` alone. Passkeys require the checked-in `0003` database migration. Run `vp run db:migrate` before using them. Their relying-party ID and origin come from `BETTER_AUTH_URL`; use that exact origin in your browser, with HTTPS in production or localhost in development. Register a passkey after signing in with Google or PoliNetwork Entra. The account page lists and removes registered passkeys.

New registrations send `PoliNetwork Auth` as the relying-party name. The username uses the user's real email, then an email from stored Google or Microsoft ID-token claims, and falls back to the user's name if neither is available. These claims are display metadata only. Passkey labels use the authenticator's AAGUID to recognize password managers such as 1Password; unknown authenticators display `Passkey`. Existing default labels are resolved when listed, while custom names are preserved. Password managers control their own vault item titles and may still show `localhost` during development. Previously saved vault metadata is not updated by the app.

## Connect identities

Sign in with Google or PoliNetwork Entra, then connect Telegram and a Polimi student email from the account page. Accounts are keyed by verified issuer and subject, with a database uniqueness constraint. Matching emails never merge users. Account links can have different email addresses. The last login method cannot be disconnected.

The prototype uses synthetic, unverified addresses under `identity.invalid` when an OAuth provider does not provide a usable login email. Email login is disabled. Email delivery is only used to prove ownership of a `@mail.polimi.it` address. If two accounts already belong to separate local users, they cannot be combined through linking; a future ownership-verified merge process is needed.

Register these callback URLs, replacing the origin with your deployment:

| Provider          | Callback                                                  |
| ----------------- | --------------------------------------------------------- |
| Google            | `https://auth.polinetwork.org/api/auth/callback/google`   |
| PoliNetwork Entra | `https://auth.polinetwork.org/api/auth/callback/pn-entra` |
| Telegram          | `https://auth.polinetwork.org/api/auth/callback/telegram` |

PoliNetwork Entra uses a tenant-specific registration, not the `common` tenant. Google and PoliNetwork Entra are login providers. Telegram uses the official OIDC authorization-code flow with PKCE and RS256 ID tokens, but the server only permits it through the account-linking flow. Configure its allowed origin and callback in BotFather. Its bot user ID comes from the signed `id` claim, separately from its OIDC `sub`.

Polimi verification accepts only the exact `mail.polimi.it` domain. Codes contain six digits, expire after 10 minutes, allow five attempts, and cannot be resent for 60 seconds. The database stores only an HMAC of each code. Successful verification creates a `polimi-email` account link and grants student status for `STUDENT_VERIFICATION_TTL_DAYS`.

Email delivery uses the same Microsoft Graph client-credential setup as the current backend. The Azure application needs the Graph `Mail.Send` application permission and permission to send as `AZURE_EMAIL_SENDER`. These Azure credentials belong to the mail sender; they do not require access to Polimi Entra.

## Roles and permissions

Access is modelled as permissions bundled into roles. A **permission** is one thing an
application can check for, addressed by a key such as `membership:read`. A **role** is a
named bundle of permissions that someone can hold. Administrators create both at `/access`,
and both support a hierarchy:

- A permission can **also grant** other permissions. Holding `membership:write` can grant
  `membership:read` without listing it everywhere.
- A role can **inherit from** other roles. It then carries every permission of its parents,
  including what those inherit in turn.

Both hierarchies are transitive, and the editor refuses an edge that would make two roles
inherit from each other or two permissions grant each other.

### Roles the identity provider defines itself

Three roles always exist and are never created, deleted, or handed out by an administrator.
Their membership is inferred from the evidence this service already collects:

| Role        | Key         | Granted by                                                                 |
| ----------- | ----------- | -------------------------------------------------------------------------- |
| `Socio`     | `socio`     | Direct membership of the `Soci` group in PoliNetwork Entra ID              |
| `Direttivo` | `direttivo` | Direct membership of `PN_ENTRA_DIRETTIVO_GROUP_ID` in PoliNetwork Entra ID |
| `Student`   | `student`   | A verification code delivered to an `@mail.polimi.it` address              |

What they grant is still yours to choose: give them permissions, rename them, describe
them, and place them in the hierarchy like any other role. Only their key, their deletion,
and who holds them are fixed. The checked-in migration seeds them alongside the two
permissions this service already issued, so existing consumers keep working: `socio` grants
`membership:read` and `student` grants `student:verified`.

`PN_ENTRA_DIRETTIVO_GROUP_ID` is optional and has no default. Until you set it to the
board's Entra group object ID, nobody is inferred as Direttivo. Both group checks reuse the
`PN_ENTRA_*` Graph credentials, run together on sign-in, and are rechecked after
`PN_ENTRA_MEMBER_REFRESH_HOURS`. If either check fails, the evidence expires immediately
rather than being cached as a confirmed loss of membership, and the next request retries.

Membership of the built-in roles is not a role assignment: nothing is written to
`user_role` for them, and evidence contributes only when joined to an account owned by the
user. States accumulate independently, so a socio is not automatically a student. Signature,
issuer, audience, expiration, and Entra tenant are checked before evidence is recorded.

Note that inheritance crosses this line in one direction. If you make a role you created
inherit from `Socio`, everyone holding your role also reports the `socio` role and its
permissions, whether or not Entra says they are a member. Inherit from a built-in role only
when that is what you mean.

### Assigning a role

Roles you create are given to people from the role's page at `/access/roles`, which lists
who holds it and searches for someone to add. An assignment lasts until it is removed.
Deleting a role removes it from everyone who held it and from every role that inherited it.

Administering roles and permissions uses the same gate as OIDC client administration,
described below. It is deliberately not itself a permission in this system: anyone who can
edit roles can grant themselves anything, so that decision stays outside the system it
would control.

Changes take effect on the next token. Already-issued OIDC tokens expire after five
minutes, so consumers must account for that revocation delay; `/api/identity` and UserInfo
compute current access on each request. Each replica caches the role graph for 15 seconds,
so a change made on one replica reaches the others within that window.

A linked Telegram identity grants no role and no permission. Existing backend Telegram
roles and group assignments remain authoritative and are not copied or queried here.

## OIDC clients

The production issuer is `https://auth.polinetwork.org/api/auth`. Discovery is available at `https://auth.polinetwork.org/api/auth/.well-known/openid-configuration`.

Supported scopes are `openid`, `profile`, `polinetwork:identity`, and `offline_access`. The custom scope adds the identity endpoint URL from `BETTER_AUTH_URL` to ID tokens, access tokens, and UserInfo. It also adds top-level string claims for consumers that cannot read arrays. With the default public origin, the claims are:

```json
{
  "https://auth.polinetwork.org/api/identity": {
    "states": ["socio", "student"],
    "roles": ["socio", "student"],
    "permissions": ["membership:read", "student:verified"],
    "telegramId": "123456789"
  },
  "polinetwork_states": "socio student",
  "polinetwork_roles": "socio student",
  "polinetwork_permissions": "membership:read student:verified",
  "polinetwork_telegram_id": "123456789"
}
```

`states` is the raw evidence: what the person's linked accounts proved. `roles` and
`permissions` are the result of resolving that evidence and their assignments through both
hierarchies, so `roles` includes inherited parent roles and `permissions` includes
everything granted indirectly. Applications should check `permissions` for a specific
capability and treat `roles` as a coarser label. The string `polinetwork_*` claims use
spaces between values and are empty strings when no values apply, as is
`polinetwork_telegram_id` when no Telegram account is linked. The `/api/identity` response
keeps the object format shown inside the URL-named claim.

Administering this service is a separate matter from membership. Anyone signed in with a PoliNetwork Entra account (the `pn-entra` provider, verified against `PN_ENTRA_TENANT_ID`) can currently manage OIDC clients, roles, and permissions. To restrict it to a stricter Microsoft 365 group than Soci, set `PN_ENTRA_OIDC_ADMIN_GROUP_ID` to that group's object ID: only its direct members, checked through the same Graph credentials, keep access. Graph answers are cached for 15 minutes per user; a failed check denies access instead of caching. `IDP_ADMIN_USER_IDS` remains a break-glass allowlist of local user IDs that always pass. Being a socio never confers this permission by itself.

Dynamic registration and client-credentials grants are disabled. Administrators manage clients at `/applications`: create web or native apps as confidential (secret shown once) or public (PKCE only) clients, edit redirect URIs and allowed scopes, rotate secrets, pause sign-ins by disabling an app, skip the consent screen for first-party apps, and delete apps. All administrators share one client pool (the plugin's `clientReference` is a fixed value), so clients are not tied to whoever created them. Redirect URIs follow the provider's rules: web apps need `https` on a public host, native apps may use `http://localhost`, `http://127.0.0.1`, `http://[::1]`, or a reverse-domain custom scheme. Custom routes under `/api/oidc/` back the pages; creation, deletion, and secret rotation go through the Better Auth client endpoints, which enforce the same administrator check.

During a sign-in the login page names the requesting application. The consent page at `/consent` shows the app, who is signed in (with a switch-account option), each requested scope in plain language, any requested profile claims, and where the browser will be sent; it supports allow and deny and explains expired or disabled requests.

Future consumers should use authorization code with PKCE, validate token signatures, issuer, audience, and expiration, and request `polinetwork:identity` only when needed. APIs must check their own permissions. An ID token or a linked Telegram ID alone is not permission to moderate a group.

## Migration work before cutover

Inspection found backend auth in `../backend/src/auth/index.ts`, with custom email OTP, passkeys, shared subdomain cookies, and custom Telegram linking. `../admin` reads `user.telegramId` and calls backend Telegram permission routes. `../group-bot` also uses those backend assignments.

Keep these integrations running while testing this service. A later migration needs:

1. Back up and inventory backend users, accounts, passkeys, Telegram links, roles, and foreign keys. Preserve user IDs or define a reviewed mapping. This prototype's schema is not a replacement migration for the backend's prefixed tables.
2. Implement a bridge that proves ownership of the existing backend session before connecting an existing user here. Existing backend passkeys are not imported; users register new passkeys in this service. The prototype does not preserve email OTP login. Never import Telegram usernames as ownership proof or manufacture OIDC accounts from old links.
3. Require official Telegram re-verification and reconcile the verified numeric ID with existing moderation assignments. Review conflicts instead of merging automatically.
4. Confirm the PN membership rule and choose how often students must reverify their Polimi email.
5. Test a downstream application in staging, including authorization code, consent, refresh, logout, account conflicts, and revoked permissions. The current shared-cookie clients cannot be pointed at this issuer without integration changes.
6. Schedule a separate cutover and rollback plan. Retain the backend login until those checks pass.

## Validation

`vp check`, `vp test`, and `vp run build` check the code. Integration tests are opt-in and create/delete fixed test fixtures. Run them only with a disposable, migrated database and a running build that uses the same test secret:

```sh
IDENTITY_TEST_URL=http://localhost:35439 \
IDENTITY_TEST_DATABASE_URL=postgresql://postgres:test@localhost:55439/identity \
IDENTITY_TEST_SECRET=your-test-server-secret \
vp test
```

The integration suite covers discovery, anonymous rejection, current identity claims, denied client registration, unique account ownership, unlink revocation, and last-account protection. Role and permission resolution, hierarchy expansion, cycle refusal, and the protections around the built-in roles are covered by the unit tests in `src/auth/rbac.test.ts`. Live Google, Entra, Telegram, and Microsoft Graph email delivery require actual app registrations and have not been validated here.

The auth schema was generated with the Better Auth CLI and includes the `account.issuer` field and issuer/subject unique index required by installed Better Auth 1.7.2. Review regeneration diffs: older CLI core schemas omit that field. Generate Drizzle SQL with `vp run db:generate` after any schema change.

References: [Better Auth OAuth provider](https://better-auth.com/docs/plugins/oauth-provider), [Generic OAuth](https://better-auth.com/docs/plugins/generic-oauth), [Telegram OIDC](https://core.telegram.org/bots/telegram-login).
