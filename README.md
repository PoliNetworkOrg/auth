# PoliNetwork Auth prototype

A standalone TanStack Start and Better Auth identity provider. The backend remains the active authentication provider for all existing PoliNetwork applications. This repository does not change backend authentication, migrate production data, or grant Telegram moderation access.

## Run locally

Use Node and pnpm through Vite+.

1. Run `vp install`.
2. Copy `.env.example` to `.env.local`, set a random secret, point `DB_*` at a **new, separate PostgreSQL database**, and configure an explicit admin group or `IDP_ADMIN_USER_IDS` bootstrap allowlist.
3. Set `BETTER_AUTH_URL=http://localhost:3000` for local development.
4. Run `vp run db:migrate` to apply the checked-in migration to that database.
5. Run `vp run dev` and open the origin set in `BETTER_AUTH_URL`.

Providers are disabled until their credentials are configured. The page shows which methods are available. Production uses `vp run build` and `vp run start`, with environment variables supplied by the host. The start command takes a PostgreSQL advisory lock, applies the checked-in Drizzle migrations, and starts the web server only after they succeed. This keeps simultaneous container replicas from applying the same migration. A migration failure stops the process instead of serving against an outdated schema. Use HTTPS in production.

The included `Dockerfile` builds the app and runs the same migration-first startup command as an unprivileged user. Supply the `DB_*` variables and the other production variables at runtime; do not bake an environment file into the image. The migration connection must go directly to PostgreSQL or through a session-pooling endpoint because PostgreSQL advisory locks belong to a database session. If the deployment platform supports a single migration job before rollout, running this bootstrap there is preferable to making every replica wait for the lock.

Google and PoliNetwork Entra create accounts. Once signed in, users can add a passkey from the account page and use it for future logins. Signed-out visitors see a login form with configured providers and passkey sign-in. Email/password login is disabled. The server rejects direct Telegram sign-in requests and protects the last Google or PoliNetwork Entra account from being disconnected, including when passkeys or verifier accounts remain linked.

Roles and permissions require the checked-in `0004` through `0009` migrations, which also move each account's single proven state into a list so one Entra identity can prove both Socio and Direttivo. `0004` carries the old `state` column into the new `states` list and seeds the built-in roles before `0005` drops it, so apply them in order and never `0005` alone. `0006` adds Master Admin and the `idp:*` permissions. `0007` adds immutable RBAC audit history and rejects/quarantines unsafe managed-role links. `0008` adds the `idp:users:read` permission behind the user directory, and `0009` adds `idp:users:delete`. Passkeys require the checked-in `0003` database migration. Run `vp run db:migrate` before using them. Their relying-party ID and origin come from `BETTER_AUTH_URL`; use that exact origin in your browser, with HTTPS in production or localhost in development. Register a passkey after signing in with Google or PoliNetwork Entra. The account page lists and removes registered passkeys.

New registrations send `PoliNetwork Auth` as the relying-party name. The username uses the user's real email, then an email from stored Google or Microsoft ID-token claims, and falls back to the user's name if neither is available. These claims are display metadata only. Passkey labels use the authenticator's AAGUID to recognize password managers such as 1Password; unknown authenticators display `Passkey`. Existing default labels are resolved when listed, while custom names are preserved. Password managers control their own vault item titles and may still show `localhost` during development. Previously saved vault metadata is not updated by the app.

### Upgrading an existing deployment to RBAC

Merge #6 into #4 before merging #4 to `main`, and deploy the resulting code together.
The base feature alone does not include the security fixes.

Back up the database, configure the admin bootstrap, stop every old replica, and then
start the new release with the normal migration-first command. This upgrade requires a
maintenance window: migration `0005` removes the `state` column still used by the old
server, so a mixed-version rolling deployment is incompatible. Rollback requires restoring
the database backup as well as the old image. The migration lock prevents simultaneous
migrators; it does not make old server code compatible with the new schema.

The environment changes are:

| Setting                         | RBAC behavior                                                                                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PN_ENTRA_DIRETTIVO_GROUP_ID`   | New, optional group object ID for Direttivo. Unset grants nobody that evidence-backed role.                                                        |
| `PN_ENTRA_OIDC_ADMIN_GROUP_ID`  | Existing setting now grants Master Admin. Without it, PN accounts are not administrators. Requires complete PN tenant/client credentials when set. |
| `IDP_ADMIN_USER_IDS`            | Existing comma-separated local user IDs remain the explicit break-glass administrators. Configure at least this or the admin group before startup. |
| `PN_ENTRA_MEMBER_REFRESH_HOURS` | Still controls persisted sign-in evidence, defaults to 24. It no longer determines authorization freshness.                                        |

Authorization uses a fixed one-minute Graph cache and five-second lookup deadline, with
no new environment knobs. Configure the PN application with Graph `GroupMember.Read.All`
application permission and tenant admin consent. A failed lookup grants no group access;
the local break-glass IDs remain usable. Partial provider/mail credentials and malformed
security settings now fail validation before migrations run.

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

Polimi verification accepts only the exact `mail.polimi.it` domain. Codes contain six digits, expire after 10 minutes, allow five attempts, and cannot be resent for 60 seconds. The cooldown applies to both the user and recipient and survives failed guesses, consumption, and failed delivery. The database stores only an HMAC of each code. Successful verification creates a `polimi-email` account link and grants student status for `STUDENT_VERIFICATION_TTL_DAYS`.

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

Four roles always exist and are never created, deleted, or handed out by an administrator.
Their membership is conferred by the identity provider itself:

| Role           | Key            | Granted by                                                                                          |
| -------------- | -------------- | --------------------------------------------------------------------------------------------------- |
| `Master Admin` | `master-admin` | `IDP_ADMIN_USER_IDS`; otherwise the configured administrators group, never an unconfigured fallback |
| `Socio`        | `socio`        | Direct membership of the `Soci` group in PoliNetwork Entra ID                                       |
| `Direttivo`    | `direttivo`    | Direct membership of `PN_ENTRA_DIRETTIVO_GROUP_ID` in PoliNetwork Entra ID                          |
| `Student`      | `student`      | A verification code delivered to an `@mail.polimi.it` address                                       |

**Master Admin holds every permission that exists**, including ones created after it was
last looked at, because it is a wildcard rather than a stored list. It therefore has no
grant list of its own to edit, and no role may inherit from it: that would launder a
wildcard nobody can be given into a role an administrator could hand to anyone.
Unlike the other three it is not proven by identity evidence and never appears among the
`states`: it comes from the deployment's own configuration, which is what keeps the service
from being locked out of its own administration. `IDP_ADMIN_USER_IDS` is always honored.
Set `PN_ENTRA_OIDC_ADMIN_GROUP_ID` to limit everyone else to that Microsoft Entra group.
If the group is unset, only the explicit allowlist can confer Master Admin. Startup fails
without either an admin group plus complete PN Entra credentials or a nonempty allowlist.

What the other three grant is still yours to choose: give them permissions, rename them,
describe them, and place them in the hierarchy like any other role. Only their key, their
deletion, and who holds them are fixed. The checked-in migrations seed them alongside the
two permissions this service already issued, so existing consumers keep working: `socio`
grants `membership:read` and `student` grants `student:verified`.

`PN_ENTRA_DIRETTIVO_GROUP_ID` is optional and has no default. Until you set it to the
board's Entra group object ID, nobody is inferred as Direttivo. Both group checks reuse the
`PN_ENTRA_*` Graph credentials. Authorization rechecks membership with a fixed 60-second
cache measured from lookup start. Stored sign-in evidence and `PN_ENTRA_MEMBER_REFRESH_HOURS`
do not extend authorization. Failed or overlong checks grant nothing.

Membership of the built-in roles is not a role assignment: nothing is written to
`user_role` for them, and evidence contributes only when joined to an account owned by the
user. States accumulate independently, so a socio is not automatically a student. Signature,
issuer, audience, expiration, and Entra tenant are checked before evidence is recorded.

Note that inheritance crosses this line in one direction. If you make a role you created
inherit from `Socio`, everyone holding your role also reports the `socio` role and its
permissions, whether or not Entra says they are a member. Inherit from a built-in role only
when that is what you mean.

### Permissions the identity provider defines itself

Administering this service is expressed as permissions like any other capability, so it can
be delegated to a role instead of being wired to a single group. These ten always exist
and can never be created, deleted, or rekeyed, because the code checks for these exact
keys; which roles carry them is entirely up to you.

| Permission               | Covers                                                     |
| ------------------------ | ---------------------------------------------------------- |
| `idp:people:read`        | Searching the people registered here                       |
| `idp:users:read`         | Browsing the user directory at `/users`                    |
| `idp:users:delete`       | Permanently deleting someone's account                     |
| `idp:permissions:read`   | Seeing permissions in the `/access` section                |
| `idp:permissions:write`  | Creating, changing, and deleting permissions               |
| `idp:roles:read`         | Seeing roles, what they grant, and who holds them          |
| `idp:roles:write`        | Creating, changing, and deleting roles                     |
| `idp:roles:assign`       | Giving roles to people and taking them away                |
| `idp:applications:read`  | Seeing the OIDC applications at `/applications`            |
| `idp:applications:write` | Registering and editing applications, and rotating secrets |

They use the permission hierarchy themselves: each `write` grants its `read`,
`idp:roles:assign` grants `idp:roles:read` and `idp:people:read` so an assigner can see the
role and find who to give it to, `idp:roles:write` also grants `idp:people:read`, `idp:users:read` grants `idp:people:read` because browsing everyone includes finding them, and `idp:roles:read` grants `idp:permissions:read` because a role is meaningless
without seeing the permissions it carries. A role with `idp:roles:write` therefore ends up
with four permissions and still cannot touch applications. `idp:roles:write` granting
`idp:roles:read`, `idp:roles:assign` granting `idp:roles:read`, `idp:permissions:write`
granting `idp:permissions:read` and
`idp:users:delete` granting `idp:users:read` are fixed in code: they apply even if the stored edge is missing, and cannot be removed, because
changing either without seeing what already exists makes no sense. The other implications
are seeded defaults you can edit.

The permissions that other PoliNetwork services check during the IdP–Telegram migration
(`admin:access`, `tg:*`, `wa:groups:manage`, `groups:labels:write`, `web:*` and
`azure:members:create`, see [RFC §4.1](docs/idp-telegram-integration-rfc-v3.md)) are seeded
as ordinary permissions, with `tg:immune` granting `tg:trusted`. No role is given them:
Master Admin holds them through its wildcard, and administrators choose which roles grant
them.

Every administration endpoint and every page checks the specific permission it needs, and
the navigation only offers what you hold. Because Master Admin is a wildcard over every
permission, whoever the deployment configures as an administrator holds all of these, which
is the bootstrap and break-glass path: there is no second kind of check beside RBAC.

Editing roles and assigning them are separate: `idp:roles:write` changes what roles grant,
`idp:roles:assign` gives and removes them, and neither implies the other.

Write and assign permissions authorize bounded delegation. Only Master Admin can edit managed roles
or permissions, including through custom ancestors or implications. Other writers can
change, assign, revoke or delete only access within their current effective permissions;
none of them permits self-escalation. A new permission definition confers
nothing: Master Admin must first grant it before others can delegate it. All checks use
current authority inside the same serialized transaction as the mutation. Graph lookups
finish before a database transaction starts. Inside the transaction, authorization rereads
the actor's accounts, evidence, assigned roles and graph, using only still-valid cached
membership answers. An account unlinked while Graph is pending cannot authorize the write.

Every RBAC mutation records its actor, operation, target and before/after state in
`rbac_audit_event`. These events commit atomically with the change and reject updates,
deletes and truncation. Database owners remain trusted and can disable triggers; export
audit events to separately controlled storage if protection from database owners is needed.

### The user directory

`/users` lists everyone registered here, 50 at a time, for anyone holding `idp:users:read`.
Each row shows Socio, Direttivo and Student status, the linked Telegram ID, which sign-in
methods the person has (Google, PoliNetwork Entra, passkey) and, for role readers, the
roles given to them by hand. Search matches name, email, Polimi address, Telegram ID or
user ID, and every property can be filtered to "yes" or "no"; the filters live in the URL,
so a filtered view can be shared or bookmarked.

Socio and Direttivo come from listing each Entra group once through Graph, cached for at
most 60 seconds like the per-person checks, and matched against people's linked accounts
from the configured tenant. If Graph cannot list a group, the directory falls back to what
each person's last PoliNetwork sign-in recorded and says so on the page. A person's own
page at `/users/<id>` always checks them live, the same way their next token would, and
shows every linked account, the roles and permissions they end up with, and who gave them
each hand-made role.

Who holds a role is role data, so the roles column, the role filter and a person's roles
and permissions are only returned to someone holding `idp:roles:read`
(`idp:permissions:read` is enough for the permission list). With `idp:roles:assign`, the same
page gives and removes roles through the same endpoint and bounded delegation as a role's
member list: nobody can hand out, or take away, access they do not hold themselves.

### Deleting an account

Someone holding `idp:users:delete` can permanently delete a person from their page in the
directory. It is a separate permission from everything else, only Master Admin holds it
until it is granted, and it is guarded more strictly than any other change:

- Nobody can delete their own account, and the request must repeat the person's name.
- Master Admins cannot be deleted, whether configured through `IDP_ADMIN_USER_IDS` or the
  administrators group. Remove them from the configuration first.
- Anyone other than a Master Admin can only delete people whose permissions they already
  hold themselves, so deletion never removes access from someone more privileged.
- The person's PoliNetwork groups are confirmed with Graph at that moment rather than read
  from a cache. If Graph cannot answer, nothing is deleted. An Entra account linked while
  checking also stops the deletion.
- The permission is rechecked inside the same serialized transaction as the deletion.

Deletion removes the person with their linked accounts, the identity evidence those
accounts carried, passkeys, sessions, OAuth tokens and consents, and role assignments.
Applications stay in the shared pool. Tokens already issued expire within minutes. The
`rbac_audit_event` row records the actor, which kinds of account were linked, and the
states, roles and permissions removed, without names, emails or external identifiers,
since the append-only history must not keep the personal data the deletion erases.

### Assigning a role

Roles you create are given to people from the role's page at `/access/roles`, which lists
who holds it in pages of 100 and searches for someone to add. Searching requires
`idp:people:read`; removing an existing member does not. An assignment lasts until it is removed.
Deleting a role removes it from everyone who held it and from every role that inherited it.

Changes take effect on the next token. Already-issued OIDC tokens expire after five
minutes, so consumers must account for that revocation delay; `/api/identity` and UserInfo
compute current access on each request. The role graph and assignments are read from one committed snapshot without a catalog
cache. Requests starting after a database revocation commits see it. Group removal takes
at most 60 seconds to affect new authorization decisions (subject to Graph propagation);
a token issued just before expiry can remain valid for another five minutes.

A linked Telegram identity grants no role and no permission. The backend still uses its
existing Telegram assignments during this phase. The IdP now publishes a separate access
snapshot for the future backend integration; no current caller uses it yet.

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

Managing applications needs the `idp:applications:write` permission, so it can be given to any role. Master Admin holds it only through explicit deployment configuration. To use a Microsoft 365 administrators group distinct from Soci, set `PN_ENTRA_OIDC_ADMIN_GROUP_ID` to that group's object ID: only its direct members, checked through the same Graph credentials, keep it. Graph answers are cached for at most 60 seconds from lookup start per user; a failed check denies access instead of caching. `IDP_ADMIN_USER_IDS` remains a break-glass allowlist of local user IDs that always pass. Being a socio never confers administration by itself.

Dynamic registration is disabled. Client-credentials grants are available when both OAuth resource identifiers are configured. Administrators manage ordinary browser clients at `/applications`: create web or native apps as confidential (secret shown once) or public (PKCE only) clients, edit redirect URIs and allowed scopes, rotate secrets, pause sign-ins by disabling an app, skip the consent screen for first-party apps, and delete apps. All administrators share one client pool (the plugin's `clientReference` is a fixed value), so clients are not tied to whoever created them. Redirect URIs follow the provider's rules: web apps need `https` on a public host, native apps may use `http://localhost`, `http://127.0.0.1`, `http://[::1]`, or a reverse-domain custom scheme. Custom routes under `/api/oidc/` back the pages; creation, deletion, and secret rotation go through the Better Auth client endpoints, which enforce the same administrator check. Service-client scope configuration and resource links require Master Admin.

### Phase 1 backend access snapshot

Set `OAUTH_BACKEND_RESOURCE_URI` and `OAUTH_INTERNAL_RESOURCE_URI` to distinct HTTPS audience identifiers, then set `OAUTH_BACKEND_CLIENT_ID` to the registered backend snapshot-pull client's ID. A client-credentials token for the internal resource needs `idp:access:read`; the authenticated client ID selects the reviewed `backend` projection. `GET /api/internal/access-snapshot` returns a versioned list of subjects with backend permissions, their individual expiry times, and linked Telegram IDs. An exact `If-None-Match` match returns `304`; a new Graph observation changes the ETag even if membership is unchanged. Unknown clients and missing audience or scope are rejected.

Entra direct-membership observations are stored by group. A pull lists a group through Graph only if no replica has observed it in the last 15 seconds, and concurrent pulls on one replica share that listing. A failed Graph request preserves the last observation, marks that source degraded, and lets its permissions expire one hour after the last success. Student rights expire at the verification timestamp. Manual assignments do not expire. Telegram IDs are included only while the linked account exists, regardless of the Telegram ID token's expiry. Duplicate Telegram IDs are excluded from the projection.

Database triggers enqueue changes to the snapshot's inputs in `access_outbox`. Rewrites that leave the projected columns unchanged, such as sign-ins, are ignored, and at most one undelivered row is kept per projection, so the table stays small while no receiver is configured. Once the backend receiver exists, set `OAUTH_BACKEND_EVENTS_URL` to its `/internal/events` endpoint. The production server then claims the queued rows, sends one IdP-signed security-event token for them and retries with backoff until the receiver replies `202`; the backend must still poll the snapshot because push delivery is best-effort. Leave the URL unset until the receiver is deployed. JWT signing keys rotate every seven days and public keys overlap for thirty days. Audit rows record Telegram links, client changes and student verification without storing client secrets.

Master Admin can register the four Phase 1 clients at `/applications/service-new`. Each form uses a fixed scope ceiling and grant type from the migration recipe, accepts only a public Ed25519 or P-256 JWKS, and links the corresponding configured resource. The client detail page shows its resource links and supports public-key overlap during rotation: add the new public key, deploy the matching private key to the owning service, then remove the old public key after the overlap. Other application writers cannot edit or delete service clients. Record the generated client IDs in deployment configuration; the backend snapshot-pull ID must match `OAUTH_BACKEND_CLIENT_ID`. Private keys belong in the owning service's Key Vault secret and must never be pasted into this IdP.

During a sign-in the login page names the requesting application. The consent page at `/consent` shows the app, who is signed in (with a switch-account option), each requested scope in plain language, any requested profile claims, and where the browser will be sent; it supports allow and deny and explains expired or disabled requests.

Future consumers should use authorization code with PKCE, validate token signatures, issuer, audience, and expiration, and request `polinetwork:identity` only when needed. APIs must check their own permissions. An ID token or a linked Telegram ID alone is not permission to moderate a group.

## Migration work before cutover

Inspection found backend auth in `../backend/src/auth/index.ts`, with custom email OTP, passkeys, shared subdomain cookies, and custom Telegram linking. `../admin` reads `user.telegramId` and calls backend Telegram permission routes. `../group-bot` also uses those backend assignments.

The backend scopes its Better Auth cookies to `.polinetwork.org` with the default `better-auth` prefix, so browsers send them to this service too. This service uses its own `pn-identity` cookie prefix (`src/auth/cookies.ts`) so those cookies cannot shadow its session. Keep the prefixes different while both run.

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

The full RBAC security audit, findings, deployment changes and verification limits are in
[docs/rbac-security-review.md](docs/rbac-security-review.md). The additional PostgreSQL suite
runs when `RBAC_TEST_DATABASE_URL` points to a disposable migrated database. To run all tests
without skips, provide that variable together with the HTTP integration variables above and
the matching `DB_*`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET` and admin bootstrap configuration.
