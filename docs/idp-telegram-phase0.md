# IdP–Telegram migration: Phase 0 evidence and decisions

**Status:** Phase 0 complete on 8 October 2026 within its no-production scope. The local Better Auth OAuth probe passed, Q1–Q8 were answered, and the complete catalog, runtime role policy and enforcement table are consolidated in [RFC revision 3](./idp-telegram-integration-rfc-v3.md). Phase 1 implementation and deployment have not started.
**Source:** the supplied `idp-telegram-integration-rfc-v2.md` / `.pdf`, especially §§4, 7, 8, 11, 13 and 16. This note preserves the detailed probe evidence; revision 3 is the migration contract.

## Isolation and method

`scripts/phase0-oauth-spike.ts` runs Better Auth with the installed `@better-auth/oauth-provider` **1.7.2** and the repository's checked-in database schema against an explicitly named, migrated, **disposable** local PostgreSQL database. It uses the in-process HTTP handler; no network-facing IdP, real user, external identity provider, production credential or deployed service is involved. It refuses non-loopback database hosts and any database name other than `auth_phase0`.

The test-only provider mirrors RFC §7's grants, resources, TTLs, `resourceSeedMode`, per-client resource links, custom subject-type claim and refresh reuse interval. It uses an ephemeral ES256 client assertion key for the M2M clients (the provider signs access tokens with EdDSA). The dashboard uses `client_secret_basic`, explicitly allowed as a first step in §7.3. One throwaway test user registers with test-only email/password, then uses that local session; the real IdP's login methods are **not** changed. The test-only clients share a public key for convenience; production clients must each have a separate key. Consent is skipped for this first-party test client, so interactive consent and real identity-provider redirects are **not** exercised.

To reproduce: migrate a newly created, local PostgreSQL database named `auth_phase0` using the repository's `db:migrate` task with explicit `DB_*` variables pointed at **that** database; then run `PHASE0_DATABASE_URL=postgresql://…@127.0.0.1:<port>/auth_phase0 pnpm exec tsx scripts/phase0-oauth-spike.ts`. Never point it at an existing IdP database. The script prints only selected decoded claims and observations; it never prints bearer tokens, refresh tokens, client secrets or private keys. It intentionally waits past the configured 10-second reuse interval and overwrites a resource row _in that disposable database_ to test reseeding.

## Decoded local token evidence

These are captured decoded headers/claims from the 8 October run, with random local IDs redacted. `jti`, `sid` and `kid` are omitted; the decoded fields relevant to the proposed contract are included. `iat` and `exp` are actual issuance/expiry timestamps. The locally issued `iss` is deliberately not the public production issuer.

**Bot client-credentials access token** (`private_key_jwt` client authentication):

```json
{
  "header": { "alg": "EdDSA", "typ": "at+jwt" },
  "claims": {
    "iss": "http://localhost:35440/api/auth",
    "sub": "<bot-client-id>",
    "client_id": "<bot-client-id>",
    "azp": "<bot-client-id>",
    "aud": "https://backend.internal.polinetwork.org",
    "scope": "backend:tg:read backend:tg:ingest backend:tg:groups:sync backend:tg:audit backend:tg:act-as backend:tg:events",
    "pn_subject_type": "client",
    "iat": 1791462807,
    "exp": 1791466407
  }
}
```

**Snapshot-pull client-credentials access token** (`private_key_jwt`):

```json
{
  "header": { "alg": "EdDSA", "typ": "at+jwt" },
  "claims": {
    "iss": "http://localhost:35440/api/auth",
    "sub": "<backend-client-id>",
    "client_id": "<backend-client-id>",
    "azp": "<backend-client-id>",
    "aud": "https://auth.polinetwork.org/api/internal",
    "scope": "idp:access:read",
    "pn_subject_type": "client",
    "iat": 1791462808,
    "exp": 1791463108
  }
}
```

**Dashboard authorization-code + PKCE access token** (`resource` on authorize and token requests):

```json
{
  "header": { "alg": "EdDSA", "typ": "at+jwt" },
  "claims": {
    "iss": "http://localhost:35440/api/auth",
    "sub": "<test-user-id>",
    "client_id": "<dashboard-client-id>",
    "azp": "<dashboard-client-id>",
    "aud": [
      "https://backend.internal.polinetwork.org",
      "http://localhost:35440/api/auth/oauth2/userinfo"
    ],
    "scope": "openid profile email offline_access backend:admin",
    "pn_subject_type": "user",
    "iat": 1791462808,
    "exp": 1791463108
  }
}
```

The first refresh returns another EdDSA `at+jwt` with the same `aud`, `scope` and `pn_subject_type`, and a fresh refresh token. In this run its `iat` and `exp` were the same second as the original; the TTL was still 300 seconds. The ID token was also present, but is **not** an access token for the backend.

## Observations against the RFC

| Check                                             | Observed result                                                                                                                                                                                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bot / dashboard / snapshot access-token lifetimes | 3600 / 300 / 300 seconds; the backend resource did not raise the user TTL.                                                                                                                                                               |
| Dashboard refresh-token lifetime                  | 604800 seconds in persisted token rows (7 days).                                                                                                                                                                                         |
| `aud` shape                                       | M2M token: one resource string. OIDC user token: array containing backend resource and local UserInfo URL.                                                                                                                               |
| Missing `resource`                                | M2M endpoint returned 200 with an **opaque** access token; backend-bound requests must send `resource` at issuance and refresh.                                                                                                          |
| Client scope ceiling                              | Bot requesting an extra `backend:admin` scope got HTTP 400 `invalid_scope` rather than a reduced token.                                                                                                                                  |
| Resource scope ceiling                            | Test client allowed both `backend:public:read` and `idp:access:read`, but the backend resource issued only `backend:public:read`.                                                                                                        |
| Resource seed mode                                | After changing `allowed_scopes` in the disposable DB, constructing a new provider with `resourceSeedMode: "overwrite"` restored the configured list. Do **not** use this mode if administrators should edit resource policies in the DB. |
| Sequential replay within 10 seconds               | Reusing the original refresh token after a completed refresh returned the same successor refresh token (200).                                                                                                                            |
| Replay after reuse interval                       | Reusing the old token after 11 seconds returned 400 `invalid_grant`; the successor also returned `invalid_grant`, consistent with family invalidation.                                                                                   |
| **Concurrent refresh**                            | **Not guaranteed to replay cleanly.** Multiple runs produced both `[200, 200]` with **different** successor refresh tokens and `[400, 200]`. Do not assume the RFC §11.2 statement that the interval alone makes parallel refresh safe.  |

**Concurrency action before Phase 4c:** keep the dashboard BFF's per-session single-flight lock mandatory, including across replicas. Treat `invalid_grant` as session loss; exercise concurrent refresh and crash/retry in an integration test. Investigate whether the provider's concurrent-rotation behaviour and non-atomic family invalidation require an upstream fix or a tighter client retry policy before relying on the 10-second interval as a safety net. Do not change production token settings solely based on this local spike.

## Confirmed decisions

The owner answered Q1–Q8 on 8 October 2026. These are design decisions for the migration, not changes to the running services.

| RFC question          | Decision                                                                                                                                                                                                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1 — Master Admin     | Master Admin has every permission, including all present and future Telegram permissions. Preserve the IdP's existing catalog-wide wildcard; no namespace exclusions or scoped Master Admin.                                                                                                                                                                        |
| Q2 — Delegation       | Separate role-definition editing from role assignment. Add `idp:roles:assign` for assigning and revoking roles; `idp:roles:write` covers role definitions. Both remain bounded by the actor's effective authority, and neither may assign a managed role or escalate the actor. The current IdP combines these operations, so implementation must split the checks. |
| Q3 — Staleness        | Accept `MAX_STALE = 1 h` and `ENTRA_GRACE = 1 h`.                                                                                                                                                                                                                                                                                                                   |
| Q4 — Native admins    | Confirm today's `allowGroupAdmins` command set as the chat-local shortcut set. It does not authorize global actions or dashboard access.                                                                                                                                                                                                                            |
| Q5 — Service identity | Use IdP client credentials for service API calls, including backend → IdP snapshot pulls, with separate clients, keys, resources and scopes. IdP → backend change notices use IdP-signed security-event tokens (§5.6 of the RFC). Neither path uses Kubernetes ServiceAccount tokens as application authentication.                                                 |
| Q6 — Bot lookups      | The bot gets permissions through the backend, not directly from the IdP. Do not add a bot-side permission cache to this contract.                                                                                                                                                                                                                                   |
| Q7 — Azure writes     | The dashboard needs one dedicated capability: create a new socio. The backend performs the Entra operation. Do not expose general member editing, group listing or group membership editing in the dashboard. In particular, do not give the dashboard an arbitrary Entra group-write operation.                                                                    |
| Q8 — Role grants      | Role-to-permission grants are chosen and changed by administrators at runtime. Do not hardcode the RFC's Web Team or HR grant lists, or decide their Telegram grants in this phase. Authorization checks permissions, not role names.                                                                                                                               |

## Agreed changes incorporated in RFC revision 3

**Permission catalog (§4.1).** Keep the proposed operation-specific permissions except for these changes:

| Change                                      | Contract                                                                                                                                                                                                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add `idp:roles:assign`                      | Authorizes role assignment and revocation, subject to existing bounded-delegation rules. It is independent of `idp:roles:write`; neither permission implies the other. It implies `idp:roles:read` and `idp:people:read` to identify the role and person. |
| Keep `idp:roles:write`                      | Authorizes role-definition changes only; it no longer authorizes assignment or revocation. Existing callers must be migrated when this split is implemented.                                                                                              |
| Add `azure:members:create`                  | Authorizes the single create-socio workflow through the backend. It does not authorize arbitrary user updates or group operations.                                                                                                                        |
| Remove proposed dashboard Azure permissions | Do not introduce `azure:members:read`, `azure:members:write` or `azure:groups:write` for the dashboard migration. The create-socio workflow is the only dashboard Azure capability in scope.                                                              |

The create-socio workflow includes the necessary Entra user creation, profile and membership-number setup, addition of **that newly created user** to the fixed Soci group, and license assignment. The existing backend `createMember` code performs these steps; its Soci-group addition is an internal part of this one operation, not a general group-write permission. The backend must bind that addition to the user it just created and must not accept an arbitrary group ID or existing user ID for this operation. Existing `setAssocNumber`, group membership mutation and Azure browsing procedures are outside the dashboard's migration contract.

**Role mapping (§4.2).** Treat the RFC's old-role mapping as migration context, not a fixed grant matrix. The IdP remains the sole source of global permissions. Administrators configure role grants in the IdP and may change them at runtime; no backend, bot or dashboard authorization check may depend on a role name. Managed-role membership and the Master Admin wildcard retain their existing IdP semantics. Before each caller is cut over, configure and review the initial grants needed for its operations; no Web Team or HR Telegram grant is prescribed here.

**Enforcement table (§8).** Keep the RFC's actor, scope and permission checks for non-Azure operations, with permission decisions evaluated from the IdP projection. Replace the Azure rows as follows:

| Procedure                                                                                                                            | Actor | Scope           | Permission             | Contract                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----- | --------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `azure.members.create`                                                                                                               | User  | `backend:admin` | `azure:members:create` | Backend-only create-socio workflow; fixed Soci group and newly created user only. Validate inputs and audit the operation.                                                        |
| `azure.members.getAll`, `azure.groups.getAll`, `azure.members.setAssocNumber`, `azure.groups.addMember`, `azure.groups.removeMember` | —     | —               | —                      | Do not expose through the migrated dashboard. Remove or disable their dashboard paths during cutover; do not carry forward the proposed `AZURE_WRITABLE_GROUPS` dashboard policy. |

All other §8 rows remain the Phase 0 target. The role-to-permission assignments behind those checks remain runtime configuration. The complete revised tables and token evidence are in RFC revision 3; the original user-supplied attachment was left intact.

**Q7 local evidence:** `../backend/src/azure/functions/members.ts` currently creates an Entra user, sets profile fields and membership number, adds that user to the Soci group and assigns licenses. This was read from local code; live Entra configuration was not inspected.

## Closure and limits

The probe was rerun on 8 October 2026 against a newly migrated disposable PostgreSQL database. It passed the bot, dashboard authorization-code/PKCE, refresh, parallel refresh, late replay, snapshot-pull, scope and resource-seeding checks. The new run returned `[400, 200]` for simultaneous refreshes, reinforcing the mandatory BFF single-flight lock. The disposable database container was stopped after the run.

This is a **local test IdP instance**, created with Better Auth, the installed OAuth provider and the repository schema. It exercises the proposed §7 OAuth configuration without changing the application's current deployed IdP configuration. Real Entra sign-in, interactive consent, separate production client keys and deployed integration are Phase 1 or later work. The RFC's migration-specific sections now contain the frozen design contract; administrators still choose actual role grants at runtime before caller cutover.

No Phase 1 resource/client provisioning, production migration or rollout has begun. Read-only checks found the existing `allowGroupAdmins` command flags in `telegram`, role-based dashboard checks in `admin`, and unauthenticated procedures in `backend` consistent with the RFC. The `web` working tree has an unrelated `tsconfig.json` modification; it was not changed. A local `polinetwork-cd` checkout was not available for verification.
