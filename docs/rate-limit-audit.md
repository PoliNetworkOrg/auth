# Authentication rate-limit audit

Reviewed on 2026-10-10. Target: `PoliNetworkOrg/auth`, commit
[`82af618`](https://github.com/PoliNetworkOrg/auth/commit/82af618).
The audit did not change the admin repository.

The request is to keep protection against bots, brute-force attempts and denial
of service while fixing rate limits that reject normal use. This is an audit of
the authentication rate-limit paths, not a claim of complete security coverage.

## Conclusion

There are three reproduced defects in the current Auth dependency/configuration
combination: unresolved proxy chains collapse independent callers into one
quota, the database counter accumulates across windows during steady traffic,
and concurrent PostgreSQL updates can exceed the configured quota. A fourth
capacity issue affects server-to-server token traffic: a BFF's users share an
IP/path bucket, and calls with no accepted IP share the global fallback bucket.

The exact reason for the user's production 429 remains unverified: the original
image is unavailable in this context, and no production request trace, incoming
headers, limiter rows, logs, deployed dependency version or Cloudflare routing
configuration were captured. The earlier suggestion of an admin redirect loop
was a hypothesis, not an observed cause. It must not be presented as the finding.

## Resolution (2026-10-11)

Implemented in [`95ecf71`](https://github.com/PoliNetworkOrg/auth/commit/95ecf71).
The findings below are kept as the audit's
historical evidence; the README section "Rate limits and client addresses" holds the current
rules.

- **Client address (finding 1).** `AUTH_CLIENT_IP_HEADER` (`cf-connecting-ip`, `x-real-ip` or
  `x-forwarded-for`) and `AUTH_TRUSTED_PROXIES` (exact addresses or CIDR ranges, only with
  `x-forwarded-for`, never `/0`) feed Better Auth's `advanced.ipAddress`. Production startup
  refuses to run without the header. Malformed values and chains without a trusted proxy
  resolve no address, so a client cannot create buckets of its own.
- **Windows and concurrency (findings 2 and 3).** `src/auth/rate-limit.ts` replaces Better
  Auth's database storage with `rateLimit.customStorage`: one `INSERT ... ON CONFLICT DO
UPDATE` per request on the existing `rate_limit` table decides admission against the
  locked, latest row, using the database clock. `last_request` now holds the window start;
  neither accepted nor refused requests move it. No schema change or new infrastructure.
  Rows older than an hour are deleted at most once a minute per replica. Database errors
  still refuse the request.
- **Token budget (finding 4).** `/oauth2/token` allows 60 requests per minute per address
  (provider default 20). Authorization, sign-in and the student email limits are unchanged.
- **Responses (finding 5).** Limiter `429`s gain `Retry-After`, `Content-Type` and
  `Cache-Control: no-store`; document navigations get a short static page with no script or
  refresh. Other `429`s pass through unchanged.

Verified locally with dummy data and a disposable PostgreSQL 17 container:

- `vp check`, `vp test` (with and without `RATE_LIMIT_TEST_DATABASE_URL`) and `vp run build`.
- `src/auth/rate-limit.test.ts`: address resolution under multi-hop chains, forged
  `x-forwarded-for` entries, malformed values, IPv6 /64 grouping, startup validation and
  the normalized response.
- `src/auth/rate-limit.integration.test.ts`: the real handler with the Drizzle adapter and
  the new storage. 31 callers behind `192.0.2.N, 10.42.0.8` each keep their own quota under
  both contracts; one caller rotating forwarded entries is still refused on request 31;
  six authorizations a minute pass for five minutes and sixty storage requests over ten;
  burst refusal, exact expiry that refusals do not extend, and 60 then `429` for token
  exchanges without an address. Races of 40 requests over four pools admit exactly the
  limit on first use, in a warmed window and at rollover; 40 sign-ins over four handler
  replicas admit exactly three. Logs and `429` bodies contain no password, verifier, code,
  client ID or session cookie.
- Fail-before: with the previous configuration (`storage: "database"`, no address options,
  provider token default), the multi-hop, steady-traffic and token tests fail with `429`.
  The handler-level race did not reproduce the overshoot in three runs; the audit's
  `onRequestRateLimit` race admitted 4 of a quota of 3 in 4 of 20 runs before and exactly 3
  in 20 of 20 after.
- The production build started with `NODE_ENV=production`: it refused to start without
  `AUTH_CLIENT_IP_HEADER`; with `cf-connecting-ip`, 31 multi-hop callers each got `302`, a
  caller rotating `x-forwarded-for` got `429` on request 31 with `Retry-After`, and a
  navigation got the HTML page.

Still to verify in production, outside this repository:

- Deploy the matching CD setting for `AUTH_CLIENT_IP_HEADER` before the new Auth
  image, or startup fails (see the infrastructure follow-up below).
- Confirm which header reaches the Auth process on the live route, and that clients cannot
  reach the origin or set that header without passing Cloudflare (Tunnel-only exposure or a
  firewall). This audit did not observe the live route or edge rules.
- Callers that resolve no address, such as the admin BFF on a cluster-internal URL, share
  one bucket per path: 60 token requests a minute across all of them. Size against real
  traffic before adding more server clients.
- Per-address limits still pool users behind one NAT, such as a campus network: 3 sign-in
  attempts per 10 seconds and 30 authorizations per minute per public IPv4 address.
- The admin BFF's handling of `429` on refresh (see below) is unchanged.

## Infrastructure follow-up (2026-10-11)

Reviewed fetched `PoliNetworkOrg/polinetwork-cd` `main` at `628fab9` and
`PoliNetworkOrg/terraform` `stable` at `6b2128a`. The older local branches were
not used as evidence of the current deployment configuration.

The CD sources declare Cloudflare Tunnel → Traefik → Auth. The remote-managed
`k3s01` tunnel runs two cloudflared replicas; its hostname routes are configured
outside Git in Cloudflare Zero Trust. Traefik is a `ClusterIP` service, and the
Auth Ingress routes the `web` entrypoint without a header middleware.
`infrastructure/traefik/traefik-service.yaml` supplies no forwarded-header trust
configuration. With Traefik's defaults, an untrusted upstream's
`X-Forwarded-For` is removed and the downstream proxy header identifies the
upstream connection rather than the visitor. This provides a concrete likely
explanation for shared Auth quotas under the original default header, in
addition to the reproduced unresolved-chain fallback. It is an inference from
the declared configuration and upstream behavior, not a captured live request.

`CF-Connecting-IP` carries Cloudflare's visitor address and is not one of the
headers removed by Traefik's forwarded-header middleware. No repository header
rewrite was found on the Auth route. The CD Auth Deployment lacked the new
required `AUTH_CLIENT_IP_HEADER`.
[Deployment PR #25](https://github.com/PoliNetworkOrg/polinetwork-cd/pull/25)
sets it to `cf-connecting-ip` and was merged before the Auth fix. Vaultwarden
already uses the same header.

Terraform's active `environments/k3s/network.tf` attaches an NSG containing
`DenyAllInbound` to the node subnet. The node's public IP is for outbound
traffic; the host firewall also defaults to dropping inbound traffic. These
sources declare protection against public direct-origin bypass, so no Terraform
change is needed for this header contract. Auth has no dedicated NetworkPolicy:
cluster-internal callers are within the trusted boundary and can reach its
service directly. This is not an assertion that all internal traffic traverses
Cloudflare.

The CD admin, backend, web and bot-ts Deployments all configure a cluster-internal
IdP URL. Their token traffic consequently shares the fallback bucket when it
carries no accepted address, confirming the shared-server capacity concern.

Remaining runtime checks are the reconciled manifests/image, headers reaching
Auth, and the remote tunnel/Cloudflare header-transform settings. This audit
did not inspect live Azure or Cloudflare configuration.

References: [Traefik forwarded-header defaults](https://doc.traefik.io/traefik/reference/install-configuration/entrypoints/#forwarded-headers),
[Traefik forwarded-header implementation](https://github.com/traefik/traefik/blob/master/pkg/middlewares/forwardedheaders/forwarded_header.go),
and [Cloudflare request headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/).

## Reproduced findings

### 1. Proxy headers can pool unrelated users into a global quota

`src/auth/index.ts` configures `advanced.cookiePrefix`, but neither
`advanced.ipAddress.ipAddressHeaders` nor `trustedProxies`. Better Auth 1.7.2
checks `x-forwarded-for` by default and accepts a comma-separated chain only when
trusted proxy addresses are configured. Otherwise `getIP()` returns null in
production. Its limiter uses `no-trusted-ip|<endpoint>` for that case.

An isolated fixture using the installed Better Auth/OAuth provider and the real
HTTP handler sent one valid authorization request from each of 31 distinct dummy
addresses, represented as `192.0.2.N, 10.42.0.8`. Requests 1–30 redirected to
login; request 31 returned 429 with `X-Retry-After: 60`. All requests occupied
`no-trusted-ip|/oauth2/authorize`. The same test with single-value forwarded
headers allowed all 31 requests and created 31 independent buckets.

Two one-variable controls also allowed all callers: explicitly using the
single-value `cf-connecting-ip` header, or trusting the exact fixture proxy
`10.42.0.8`. Neither control disabled rate limiting or raised a quota. The real
PostgreSQL/Drizzle configuration independently reproduced the shared bucket.

Production condition still to verify: which sanitized header actually reaches
the Auth process. Local infrastructure sources show Cloudflare tunnel usage and
Traefik, but do not establish the current public HTTP route/header chain.

Fix: define and document a trusted client-IP contract. Accept a header that the
trusted edge overwrites, or configure exact proxy addresses/ranges and sanitize
the chain. Do not trust arbitrary leftmost forwarded addresses or broad private
networks; clients must not be able to reach the origin and forge the chosen
header. If production routing is configured outside this repository, state the
required deployment change rather than pretending the application alone proves
header authenticity. Preserve IPv6 normalization and subnet protection.

### 2. Database windows reset after inactivity, not after the window duration

The installed `better-auth/dist/api/rate-limiter/index.mjs` resets a counter only
when `now - lastRequest >= window * 1000`. Every accepted request also advances
`lastRequest`. Thus a steady stream spaced less than one window apart keeps
accumulating the count indefinitely, even if each minute contains far fewer
requests than the advertised quota.

With a fake clock, 31 valid authorization requests spaced 10 seconds apart over
five minutes produced 429 on request 31. There were at most seven requests in
any inclusive 60-second interval, below the configured 30. The final retry delay
was 50 seconds. This reproduced both through the HTTP handler with database
storage over the memory adapter and through the limiter with real
PostgreSQL/Drizzle. The latter stored `count = 30` despite five elapsed windows.

The same algorithm governs sign-in and token endpoints. A shared BFF token
bucket receiving six requests per minute will eventually exhaust its 20-count
limit unless there is a full minute with no accepted requests.

Fix: use a clearly specified, bounded window or refill algorithm with an atomic
shared store. A supported `rateLimit.customStorage.consume` implementation using
the existing PostgreSQL table is a narrow option. Keep timing state anchored to
the start of a fixed window if choosing that algorithm; subsequent accepted and
rejected requests must not extend the window. Retain per-endpoint rules and
cross-replica enforcement. Cover exact boundaries, steady traffic over multiple
windows, rejected-request expiry and accurate retry delays.

Merely upgrading is not an established fix. The examined upstream v1.7.7 and
main rate-limiter source still advances `lastRequest` on accepted requests and
resets on inactivity.

### 3. PostgreSQL concurrency can exceed the sign-in quota

The installed Drizzle adapter's `incrementOne` selects an ID in a subquery with
the count/time predicates, then updates with only `id IN (subquery)` as the outer
predicate. Concurrent operations can select a permitted row from their initial
snapshots and later update it after another operation already exhausted the
quota.

A disposable PostgreSQL 17 fixture used the actual exported
`onRequestRateLimit`, actual Drizzle adapter and repository `rateLimit` schema.
After one warm-up request, 12 concurrent `/sign-in/social` requests from the same
dummy IP were issued. The configured quota was three per 10 seconds. Seven
requests were accepted in total and the database recorded `count = 7`; six were
rejected. The finding is about limiter admission, not successful account
authentication. It demonstrates weakened brute-force/abuse admission control.

Fix: admission and count changes must be one atomic PostgreSQL operation that
checks the current locked row. Prefer an application-owned limiter with guarded
`INSERT ... ON CONFLICT ... DO UPDATE` or a transaction with a row lock and safe
first-row creation. Do not use an in-process lock, a read-then-write counter, or
the affected adapter method as the concurrency guarantee. Test concurrent first
use, a warmed bucket, expiry races and multiple independent DB connections.

### 4. The token quota is shared by BFF traffic, not by OAuth client or user

The OAuth plugin defaults are 20 token requests and 30 authorization requests
per IP/path bucket. The configuration does not override them. Neither the
client ID nor the authenticated user is part of the limiter key. All token
grants, including code exchange, refresh and client credentials, use the same
`/oauth2/token` path.

The admin BFF's `src/server/oidc.server.ts` performs token exchange/refresh from
the server and does not attach the browser's IP. An internal IdP URL therefore
normally supplies no accepted IP header. Public transport usually identifies
the BFF's egress address, which still pools its users. This does not pool browser
authorization traffic unless the proxy/header problem in finding 1 also applies.

In the isolated HTTP fixture, 20 valid authorization-code exchanges succeeded;
the 21st returned 429. All token calls without an accepted IP header occupied
`no-trusted-ip|/oauth2/token`. The PostgreSQL limiter reproduced that threshold.
This is expected quota behavior for the current key, but an unsuitable capacity
assumption for a shared server workload. Fixing finding 2 prevents cumulative
low-rate exhaustion; a burst of 21 legitimate grants still needs a deliberate
capacity policy.

Fix: document and size the token endpoint's IP-level budget for shared server
traffic, keeping a bounded limit. If introducing client-aware quotas, only
verified client authentication may select a privileged client quota: an
unvalidated `client_id` or spoofed IP header must not create arbitrary buckets
or evade admission. Retain a coarse unauthenticated/IP ceiling. Do not forward
browser-supplied IP headers as a shortcut. Avoid a complex client limiter unless
the traffic model requires it; a justified endpoint-specific budget and correct
window may be enough.

## Secondary observations and coverage

The IdP returns the library's raw JSON 429 on browser document navigation;
`src/routes/api/auth/$.ts` only customizes logout responses. `src/auth/client.ts`
has no global 429/retry-delay handling. The installed library sets
`X-Retry-After`, not standard `Retry-After`, and its 1.7.2 response lacks an
explicit JSON content type. A small response normalization and clear cooldown
message would improve recovery; it must not trigger automatic retry loops or
change admission decisions.

Inspected login/consent code initiates sign-in from user actions. No repeated
automatic authorization request was found. Server-side `auth.api.getSession`
calls bypass the HTTP limiter, so normal route loader counts do not explain an
authorization quota by themselves. The access-change dispatcher calls the
backend receiver, not `/oauth2/authorize` or `/oauth2/token`.

The student email verifier separately enforces a 60-second resend cooldown by
both user and recipient and a five-attempt challenge limit under the RBAC write
lock. Those controls should remain unchanged. The provider's sign-in limits,
PKCE, state, nonce, signature checks, disabled account-linking paths and
database-backed sharing must be retained.

Admin refresh handling treats a definite upstream 429 like an ambiguous
transport failure, leaving the durable refresh marker; after the existing
access token expires it may force sign-in. Its logs also discard status/retry
details. This is a source-grounded resilience concern outside the Auth fix, not
proof that the original 429 came from admin. No admin fix is required to remedy
the three confirmed Auth defects.

The initial audit used older deployment checkouts. The infrastructure follow-up
above supersedes that source limitation with fetched deployment and Terraform
refs, while still not proving live reconciliation. Edge bot/DDoS rules and
deployed image dependencies remain outside source visibility. Application
database limits remain one layer of protection; this audit makes no claim to
verify live Cloudflare or network-level protection.

## Evidence and acceptance criteria

Maintained regression coverage is in
[`src/auth/rate-limit.test.ts`](../src/auth/rate-limit.test.ts) and
[`src/auth/rate-limit.integration.test.ts`](../src/auth/rate-limit.integration.test.ts).
The initial reproductions used the actual HTTP handler with in-memory fixture
data and database storage, and the actual limiter with PostgreSQL and the
repository's Drizzle schema. All fixtures used dummy identities, addresses and
credentials. No production request or credential was used.

Execution used preinstalled `node:24.19.0-bookworm` and `postgres:17-alpine`
images, read-only target/toolchain mounts, an internal-only Docker network (or
no network), scratch-local environment and storage, explicit memory/CPU/process
limits, bounded temporary files and a 45-second command timeout. Temporary DB
containers are task-owned and stopped after validation.

The acceptance criteria are independent caller quotas under the documented trusted
header contract, sustained below-quota traffic without false 429s, exact
concurrent quota enforcement in real PostgreSQL, bounded token traffic,
cross-replica state, accurate expiry/retry handling and no weakened challenge or
client-authentication controls, passing repository checks and a production build.

Primary references: [Better Auth rate limiting](https://better-auth.com/docs/concepts/rate-limit),
[OAuth provider limits](https://better-auth.com/docs/plugins/oauth-provider#rate-limiting),
[upstream v1.7.7 limiter](https://github.com/better-auth/better-auth/blob/v1.7.7/packages/better-auth/src/api/rate-limiter/index.ts)
and [upstream Drizzle adapter](https://github.com/better-auth/better-auth/blob/v1.7.7/packages/drizzle-adapter/src/drizzle-adapter.ts).
