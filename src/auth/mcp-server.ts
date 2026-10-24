import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { and, desc, eq, like, lt } from "drizzle-orm";
import { createLocalJWKSet, decodeJwt, decodeProtectedHeader, jwtVerify, type JWK } from "jose";
import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import { db } from "../db/index";
import { oauthResource, rbacAuditEvent, user } from "../db/schema";
import { toActionError } from "./guard";
import { getIdentity } from "./identity";
import { auth, tokenLifetimes } from "./index";
import {
  checkAuthorizationRequest,
  diagnoseClient,
  explainPermission,
  type DiagnosisContext,
} from "./mcp-diagnostics";
import { issuer } from "./mcp-resource";
import {
  apiAccessEnabled,
  checkClientDraft,
  configuredResources,
  createOidcClient,
  deleteOidcClient,
  listOidcClients,
  rotateOidcClientSecret,
  updateOidcClient,
} from "./oidc-registry";
import {
  apiScopes,
  draftFromClient,
  emptyClientDraft,
  oidcScopes,
  type OidcClientDraft,
  type OidcClientSummary,
} from "./oidc-clients";
import {
  MASTER_ADMIN_ROLE_KEY,
  effectiveRolePermissions,
  emptyPermissionDraft,
  emptyRoleDraft,
  permissionDraftFrom,
  roleDraftFrom,
  staticRolesForStates,
  type ManagedPermissionKey,
  type RbacCatalog,
} from "./rbac";
import {
  RbacError,
  assignRole,
  deletePermission,
  deleteRole,
  listRoleMembers,
  loadCatalog,
  savePermission,
  saveRole,
  searchUsers,
  unassignRole,
  withAuthorizedRbacRead,
} from "./rbac-store";
import { getUserDetail, listUsers } from "./user-directory";
import { USER_PAGE_SIZES, userSearchSchema } from "./users";

/** Who an MCP request acts for, as checked by the endpoint before the server is built. */
export type McpPrincipal = {
  userId: string;
  clientId: string;
  /** The managed `idp:*` permissions they held when the request arrived. */
  permissions: string[];
  roles: string[];
};

const INSTRUCTIONS = `PoliNetwork Auth is PoliNetwork's identity provider (OpenID Connect, built on Better Auth). These tools read and change its configuration on behalf of the person who connected you, with exactly their permissions: anything they could not do on the website is refused here too, and every change is recorded in the audit log under their name.

To debug an application that cannot sign people in, start with get_application and diagnose_application. Pass the authorization URL the application sends to diagnose_application to see what /oauth2/authorize would answer, and decode tokens with inspect_token. get_server_info lists the endpoints, token formats and rules.

To change an application, role or permission, read it first: the update tools merge your changes into what exists, and lists replace the old list entirely. Client secrets are returned once; hand them to the person, never store them anywhere else. Ask before deleting anything.`;

/** A tool's input schema: every argument documented for the agent. */
const roleRef = z.string().min(1).describe("The role's key, such as group-moderator, or its ID.");
const permissionRef = z
  .string()
  .min(1)
  .describe("The permission's key, such as membership:read, or its ID.");

const draftFields = {
  name: z.string().max(80).describe("Shown on the sign-in and consent pages."),
  uri: z.string().describe("Homepage, an https URL. Empty for none."),
  logo: z.string().describe("Logo, an https URL. Empty for none."),
  logoDark: z.string().describe("Logo for dark backgrounds, an https URL. Empty for none."),
  redirectUris: z
    .array(z.string())
    .max(50)
    .describe("Exact callback URLs. Web apps need https on a public host."),
  postLogoutRedirectUris: z
    .array(z.string())
    .max(50)
    .describe("Where sign-out may send people back. Needs enableEndSession."),
  contacts: z.array(z.string()).max(20).describe("Contact email addresses."),
  tosUri: z.string().describe("Terms of service, an https URL. Empty for none."),
  policyUri: z.string().describe("Privacy policy, an https URL. Empty for none."),
  applicationType: z
    .enum(["web", "native"])
    .describe(
      "web: https redirects on public hosts only. native: also http://localhost, http://127.0.0.1, http://[::1] and reverse-domain schemes such as org.polinetwork.app:/callback.",
    ),
  credential: z
    .enum(["secret", "private-key", "public"])
    .describe(
      "secret: client_secret_basic, a secret is returned once. private-key: private_key_jwt with the public JWKS in `jwks`. public: no credential, PKCE only, sign-in only.",
    ),
  jwks: z
    .string()
    .max(20_000)
    .describe("The public JWKS as JSON (Ed25519 or P-256 keys), only with credential private-key."),
  signIn: z.boolean().describe("Signs people in with the authorization code flow."),
  scopes: z
    .array(z.string())
    .max(10)
    .describe(
      `Scopes it may ask people for: ${oidcScopes.map((scope) => scope.id).join(", ")}. openid is required; offline_access adds refresh tokens.`,
    ),
  serviceAccess: z
    .boolean()
    .describe("Obtains tokens as itself with client credentials. Needs API access (Master Admin)."),
  apiScopes: z
    .array(z.string())
    .max(20)
    .describe("PoliNetwork API scopes it may ask for on behalf of people (Master Admin)."),
  serviceScopes: z
    .array(z.string())
    .max(20)
    .describe("PoliNetwork API scopes it may use as itself (Master Admin)."),
  resources: z
    .array(z.enum(["backend", "internal"]))
    .max(2)
    .describe("API resources its tokens may be addressed to; must cover the API scopes."),
  enableEndSession: z.boolean().describe("Allows sign-out through /oauth2/end-session."),
};

function text(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

/** Refusals keep their message and field errors; anything unexpected is logged, not shown. */
function failure(cause: unknown): CallToolResult {
  const error = toActionError(cause);
  const body =
    error instanceof ActionError
      ? { error: error.message, status: error.status, fields: error.fields }
      : { error: "Something went wrong. Try again." };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
}

async function respond(run: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return text(await run());
  } catch (cause) {
    return failure(cause);
  }
}

function diagnosisContext(): DiagnosisContext {
  return { resources: configuredResources() };
}

/** The token policy of every resource, which the provider seeds from its configuration. */
async function resourcePolicies() {
  const rows = await db
    .select({
      identifier: oauthResource.identifier,
      allowedScopes: oauthResource.allowedScopes,
      disabled: oauthResource.disabled,
    })
    .from(oauthResource);
  return Object.fromEntries(
    rows.map((row) => [
      row.identifier,
      { allowedScopes: row.allowedScopes, disabled: row.disabled ?? false },
    ]),
  );
}

function compactClient(client: OidcClientSummary) {
  return {
    clientId: client.clientId,
    name: client.name,
    credential: client.credential,
    applicationType: client.applicationType,
    grantTypes: client.grantTypes,
    scopes: client.scopes,
    redirectUris: client.redirectUris,
    disabled: client.disabled,
    restricted: client.restricted,
    authorizedUsers: client.authorizedUsers,
    updatedAt: client.updatedAt,
  };
}

function findRole(catalog: RbacCatalog, ref: string) {
  const found = catalog.roles.find((entry) => entry.key === ref || entry.id === ref);
  if (!found) throw new RbacError(404, `No role ${ref}.`);
  return found;
}

function findPermission(catalog: RbacCatalog, ref: string) {
  const found = catalog.permissions.find((entry) => entry.key === ref || entry.id === ref);
  if (!found) throw new RbacError(404, `No permission ${ref}.`);
  return found;
}

/** Decodes and verifies a JWT this identity provider issued, and says what is wrong with it. */
async function inspectToken(token: string) {
  const findings: { level: "error" | "warning" | "info"; message: string }[] = [];
  const trimmed = token.trim().replace(/^Bearer\s+/i, "");
  if (trimmed.split(".").length !== 3)
    return {
      kind: "opaque",
      findings: [
        {
          level: "info",
          message:
            "This is not a JWT. Access tokens are opaque unless the authorization and token requests name a `resource`; an opaque token works at /oauth2/userinfo and can be checked at /oauth2/introspect with the client's credentials.",
        },
      ],
    };
  let header: ReturnType<typeof decodeProtectedHeader>;
  let claims: ReturnType<typeof decodeJwt>;
  try {
    header = decodeProtectedHeader(trimmed);
    claims = decodeJwt(trimmed);
  } catch {
    return {
      kind: "malformed",
      findings: [{ level: "error", message: "The JWT cannot be decoded." }],
    };
  }
  const kind =
    header.typ === "at+jwt"
      ? "access token"
      : claims.events && typeof claims.events === "object"
        ? "logout token"
        : "ID token";
  const jwks = await auth.api.getJwks();
  if (!jwks.keys.some((key) => key.kid === header.kid))
    findings.push({
      level: "error",
      message: `Key ${String(header.kid)} is not in this provider's JWKS: it was issued elsewhere or its key was retired.`,
    });
  try {
    await jwtVerify(trimmed, createLocalJWKSet({ keys: jwks.keys as JWK[] }), {
      currentDate: new Date((Number(claims.iat) || Date.now() / 1000) * 1000),
    });
    findings.push({ level: "info", message: `The ${String(header.alg)} signature is valid.` });
  } catch (cause) {
    findings.push({
      level: "error",
      message: `The signature does not verify: ${(cause as Error).message}`,
    });
  }
  if (claims.iss !== issuer)
    findings.push({ level: "error", message: `iss is ${String(claims.iss)}, not ${issuer}.` });
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp === "number" && claims.exp <= now)
    findings.push({
      level: "error",
      message: `It expired ${now - claims.exp} seconds ago (${new Date(claims.exp * 1000).toISOString()}).`,
    });
  if (typeof claims.nbf === "number" && claims.nbf > now)
    findings.push({ level: "error", message: "It is not valid yet (nbf is in the future)." });
  if (typeof claims.iat === "number" && claims.iat > now + 60)
    findings.push({
      level: "warning",
      message: "It was issued in the future: a clock on one side is wrong.",
    });
  if (kind === "ID token") {
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (typeof claims.azp === "string" && !audience.includes(claims.azp))
      findings.push({ level: "warning", message: "Its audience does not include its azp." });
    findings.push({
      level: "info",
      message: `Its audience is the client ID ${String(claims.aud)}; the client must check that, the issuer, the RS256 signature and the expiry. It is not an access token: APIs must not accept it.`,
    });
  } else if (kind === "access token")
    findings.push({
      level: "info",
      message: `It is addressed to ${JSON.stringify(claims.aud)} with scope "${typeof claims.scope === "string" ? claims.scope : ""}". The API must check that its own identifier is in aud.`,
    });
  return { kind, header, claims, findings };
}

/**
 * The MCP server for one request, with the tools `principal` may use. Each tool calls the same
 * store function as the matching page, which checks the permission again inside its own
 * transaction, so a tool offered here never grants more than the website would.
 */
export function createMcpServer(principal: McpPrincipal) {
  const server = new McpServer(
    { name: "polinetwork-auth", title: "PoliNetwork Auth", version: "1.0.0" },
    { instructions: INSTRUCTIONS },
  );
  const actor = principal.userId;
  const can = (...permissions: ManagedPermissionKey[]) =>
    permissions.every((permission) => principal.permissions.includes(permission));
  const masterAdmin = principal.roles.includes(MASTER_ADMIN_ROLE_KEY);
  const offered: string[] = [];
  const offer = (name: string) => {
    offered.push(name);
    return name;
  };

  server.registerTool(
    offer("whoami"),
    {
      title: "Who am I",
      description:
        "The person this connection acts for, their roles and permissions, and the tools they can use here.",
      annotations: { readOnlyHint: true },
    },
    () =>
      respond(async () => {
        const [person] = await db
          .select({ id: user.id, name: user.name })
          .from(user)
          .where(eq(user.id, actor));
        const identity = await getIdentity(actor);
        return {
          user: person ?? { id: actor },
          states: identity.states,
          roles: identity.roles,
          permissions: identity.permissions,
          agentClientId: principal.clientId,
          tools: offered,
        };
      }),
  );

  server.registerTool(
    offer("get_server_info"),
    {
      title: "Identity provider settings",
      description:
        "The issuer, endpoints, scopes, token formats and lifetimes, and the rules clients must follow. Use it to check a client's configuration against what this provider expects.",
      annotations: { readOnlyHint: true },
    },
    () =>
      respond(async () => {
        const metadata = await auth.api.getOpenIdConfig();
        return {
          issuer,
          discovery: `${issuer}/.well-known/openid-configuration`,
          metadata,
          scopes: oidcScopes.map(({ id, label, description }) => ({ id, label, description })),
          apiScopes: apiAccessEnabled()
            ? apiScopes.map(({ id, description, resource }) => ({ id, description, resource }))
            : [],
          resources: configuredResources(),
          tokens: {
            idToken: `RS256 JWT, valid ${tokenLifetimes.idToken} s, aud is the client ID.`,
            accessToken: `Opaque, valid ${tokenLifetimes.accessToken} s, usable at UserInfo. When the request names a configured resource, an EdDSA JWT (typ at+jwt) addressed to it.`,
            clientCredentials: `EdDSA JWT for the requested resource, valid ${tokenLifetimes.clientCredentialsAccessToken} s.`,
            refreshToken: `Only with offline_access and the refresh_token grant. Valid ${tokenLifetimes.refreshToken / 86_400} days and rotated on every use; reusing a rotated one within 10 s replays the same answer.`,
          },
          rules: [
            "Every authorization request needs PKCE with S256 (code_challenge and code_challenge_method=S256).",
            "redirect_uri must exactly match a registered one; only on 127.0.0.1 and [::1] may the port differ.",
            "Web apps redirect to https on public hosts; native apps may also use http on localhost, 127.0.0.1 or [::1], or a reverse-domain scheme.",
            "Clients authenticate with client_secret_basic, private_key_jwt (Ed25519 or P-256), or not at all when public.",
            "polinetwork:identity adds states, roles, permissions and the Telegram ID under the claim named after /api/identity, plus space-separated polinetwork_* claims and a groups array.",
            "Applications with API scopes, client credentials or resource links can be changed only by Master Admin.",
            "Dynamic client registration is open to MCP agents only.",
          ],
        };
      }),
  );

  if (can("idp:applications:read")) {
    server.registerTool(
      offer("list_applications"),
      {
        title: "List applications",
        description: "Every application in the shared pool with its main settings.",
        annotations: { readOnlyHint: true },
      },
      () => respond(async () => (await listOidcClients(actor)).map(compactClient)),
    );

    server.registerTool(
      offer("get_application"),
      {
        title: "Get an application",
        description:
          "One application's full settings, and the same settings as an editable draft for update_application. Secrets are never returned.",
        inputSchema: z.object({ clientId: z.string().min(1) }),
        annotations: { readOnlyHint: true },
      },
      ({ clientId }) =>
        respond(async () => {
          const [client] = await listOidcClients(actor, clientId);
          if (!client) throw new RbacError(404, "Application not found.");
          return { application: client, draft: draftFromClient(client) };
        }),
    );

    server.registerTool(
      offer("diagnose_application"),
      {
        title: "Diagnose an application",
        description:
          "Finds misconfigurations in an application. With `authorizationUrl` (the URL the application sends people to, or its query string), also says what /oauth2/authorize would answer and why.",
        inputSchema: z.object({
          clientId: z.string().min(1),
          authorizationUrl: z.string().max(8_000).optional(),
        }),
        annotations: { readOnlyHint: true },
      },
      ({ clientId, authorizationUrl }) =>
        respond(async () => {
          const [client] = await listOidcClients(actor, clientId);
          if (!client) throw new RbacError(404, "Application not found.");
          const context = diagnosisContext();
          return {
            application: compactClient(client),
            settings: diagnoseClient(client, context),
            ...(authorizationUrl
              ? {
                  authorizationRequest: checkAuthorizationRequest(client, authorizationUrl, {
                    resourcePolicies: await resourcePolicies(),
                    authorizeEndpoint: `${issuer}/oauth2/authorize`,
                  }),
                }
              : {}),
          };
        }),
    );
  }

  if (can("idp:applications:write")) {
    server.registerTool(
      offer("create_application"),
      {
        title: "Register an application",
        description:
          "Registers an application in the shared pool. Unset fields take the form's defaults: a web app with a client secret that signs people in with openid and profile. Returns the client ID, and the secret once.",
        inputSchema: z.object(draftFields).partial().required({ name: true }),
      },
      (input) =>
        respond(async () => {
          const draft = checkClientDraft({ ...emptyClientDraft(), redirectUris: [], ...input });
          const created = await createOidcClient(actor, draft);
          // The application exists and its secret is shown only now, so failing to read it
          // back, for someone who may register applications without seeing them, must not
          // lose the credentials.
          const [client] = can("idp:applications:read")
            ? await listOidcClients(actor, created.clientId).catch(() => [])
            : [];
          return {
            clientId: created.clientId,
            clientSecret: created.clientSecret,
            ...(client
              ? { application: client, findings: diagnoseClient(client, diagnosisContext()) }
              : {}),
          };
        }),
    );

    server.registerTool(
      offer("rotate_application_secret"),
      {
        title: "Rotate a client secret",
        description:
          "Replaces an application's client secret. The old one stops working at once; the new one is returned once.",
        inputSchema: z.object({ clientId: z.string().min(1) }),
        annotations: { destructiveHint: true },
      },
      ({ clientId }) =>
        respond(async () => {
          const result = await rotateOidcClientSecret(actor, clientId);
          if (!result) throw new RbacError(404, "Application not found.");
          return result;
        }),
    );
  }

  // Changing or deleting an application starts from reading it.
  if (can("idp:applications:write", "idp:applications:read")) {
    server.registerTool(
      offer("update_application"),
      {
        title: "Change an application",
        description:
          "Merges `changes` into the application's current settings and saves them; a list given replaces the old list. `disabled` pauses sign-ins, `skipConsent` skips the consent screen. Switching to a secret returns the new secret once.",
        inputSchema: z.object({
          clientId: z.string().min(1),
          changes: z.object(draftFields).partial().optional(),
          disabled: z.boolean().optional(),
          skipConsent: z.boolean().optional(),
        }),
        annotations: { idempotentHint: true },
      },
      ({ clientId, changes, disabled, skipConsent }) =>
        respond(async () => {
          const [current] = await listOidcClients(actor, clientId);
          if (!current) throw new RbacError(404, "Application not found.");
          const draft: OidcClientDraft | undefined = changes
            ? checkClientDraft({ ...draftFromClient(current), ...changes })
            : undefined;
          const result = await updateOidcClient(actor, clientId, { draft, disabled, skipConsent });
          if (!result) throw new RbacError(404, "Application not found.");
          return {
            application: result.client,
            clientSecret: result.clientSecret,
            findings: diagnoseClient(result.client, diagnosisContext()),
          };
        }),
    );

    server.registerTool(
      offer("delete_application"),
      {
        title: "Delete an application",
        description:
          "Deletes an application with its tokens and consents. `confirmName` must repeat its name exactly.",
        inputSchema: z.object({ clientId: z.string().min(1), confirmName: z.string() }),
        annotations: { destructiveHint: true },
      },
      ({ clientId, confirmName }) =>
        respond(async () => {
          const [client] = await listOidcClients(actor, clientId);
          if (!client) throw new RbacError(404, "Application not found.");
          if (client.name !== confirmName)
            throw new RbacError(400, `confirmName must be exactly "${client.name}".`);
          if (!(await deleteOidcClient(actor, clientId)))
            throw new RbacError(404, "Application not found.");
          return { deleted: clientId };
        }),
    );
  }

  server.registerTool(
    offer("inspect_token"),
    {
      title: "Inspect a token",
      description:
        "Decodes a JWT this provider issued (ID token, access token or logout token), verifies its signature against the provider's keys, and explains what is wrong with it.",
      inputSchema: z.object({ token: z.string().min(1).max(20_000) }),
      annotations: { readOnlyHint: true },
    },
    ({ token }) => respond(() => inspectToken(token)),
  );

  if (can("idp:people:read")) {
    server.registerTool(
      offer("search_people"),
      {
        title: "Find people",
        description:
          "Up to 25 people matching a name, email, Polimi address, Telegram ID or user ID. With `role`, each result says whether they hold that role.",
        inputSchema: z.object({ query: z.string().max(200), role: roleRef.optional() }),
        annotations: { readOnlyHint: true },
      },
      ({ query, role }) =>
        respond(async () => {
          const roleId = role ? findRole(await loadCatalog(actor), role).id : undefined;
          return searchUsers(actor, query, roleId);
        }),
    );
  }

  if (can("idp:users:read")) {
    server.registerTool(
      offer("list_users"),
      {
        title: "List users",
        description:
          "One page of the user directory. Filters take yes or no; `role` is a role key given by hand.",
        inputSchema: z.object({
          query: z.string().max(200).optional(),
          role: z.string().max(64).optional(),
          socio: z.enum(["yes", "no"]).optional(),
          direttivo: z.enum(["yes", "no"]).optional(),
          student: z.enum(["yes", "no"]).optional(),
          telegram: z.enum(["yes", "no"]).optional(),
          google: z.enum(["yes", "no"]).optional(),
          polinetwork: z.enum(["yes", "no"]).optional(),
          passkey: z.enum(["yes", "no"]).optional(),
          sort: z.enum(["name", "newest", "oldest"]).optional(),
          page: z.number().int().min(1).optional(),
          pageSize: z.union(USER_PAGE_SIZES.map((size) => z.literal(size))).optional(),
        }),
        annotations: { readOnlyHint: true },
      },
      ({ query, ...filters }) =>
        respond(() => listUsers(actor, userSearchSchema.parse({ ...filters, q: query }))),
    );

    server.registerTool(
      offer("get_user"),
      {
        title: "Get a user",
        description:
          "One person: linked accounts, status checked live, and (with role access) the roles and permissions they hold.",
        inputSchema: z.object({ userId: z.string().min(1) }),
        annotations: { readOnlyHint: true },
      },
      ({ userId }) => respond(() => getUserDetail(actor, userId)),
    );
  }

  if (can("idp:users:read", "idp:roles:read")) {
    server.registerTool(
      offer("explain_access"),
      {
        title: "Explain a permission",
        description:
          "Whether a person holds a permission, and every path that gives it to them: the role they hold, the roles it inherits, and the permissions that imply it.",
        inputSchema: z.object({ userId: z.string().min(1), permission: permissionRef }),
        annotations: { readOnlyHint: true },
      },
      ({ userId, permission }) =>
        respond(async () => {
          const [detail, catalog] = await Promise.all([
            getUserDetail(actor, userId),
            loadCatalog(actor),
          ]);
          const target = findPermission(catalog, permission);
          const directRoles = [
            ...(detail.assignedRoles ?? []).map((entry) => entry.key),
            ...staticRolesForStates(detail.states),
            ...((detail.roles ?? []).includes(MASTER_ADMIN_ROLE_KEY)
              ? [MASTER_ADMIN_ROLE_KEY]
              : []),
          ];
          return {
            permission: target.key,
            holds: (detail.permissions ?? []).includes(target.key),
            directRoles,
            sources: explainPermission(catalog, directRoles, target.key),
          };
        }),
    );
  }

  if (can("idp:roles:read")) {
    server.registerTool(
      offer("list_roles"),
      {
        title: "List roles",
        description:
          "Every role with what it grants directly, what it inherits from, everything it confers in the end, and how many people hold it by hand.",
        annotations: { readOnlyHint: true },
      },
      () =>
        respond(async () => {
          const catalog = await loadCatalog(actor);
          return catalog.roles.map((role) => ({
            ...role,
            effectivePermissions: effectiveRolePermissions(catalog, role.key),
          }));
        }),
    );

    server.registerTool(
      offer("get_role"),
      {
        title: "Get a role",
        description:
          "One role with its effective permissions, the roles that inherit from it, and a page of the people holding it by hand (100 at a time, continue with `after`).",
        inputSchema: z.object({ role: roleRef, after: z.string().optional() }),
        annotations: { readOnlyHint: true },
      },
      ({ role, after }) =>
        respond(async () => {
          const catalog = await loadCatalog(actor);
          const found = findRole(catalog, role);
          return {
            role: found,
            effectivePermissions: effectiveRolePermissions(catalog, found.key),
            inheritedBy: catalog.roles
              .filter((entry) => entry.parents.includes(found.key))
              .map((entry) => entry.key),
            members: found.managed
              ? "Built-in roles are held through identity evidence, not by hand."
              : await listRoleMembers(actor, found.id, after),
          };
        }),
    );
  }

  if (can("idp:permissions:read")) {
    server.registerTool(
      offer("list_permissions"),
      {
        title: "List permissions",
        description:
          "Every permission with what it implies and how many roles grant it directly. Built-in (managed) ones are the idp:* keys.",
        annotations: { readOnlyHint: true },
      },
      () => respond(async () => (await loadCatalog(actor)).permissions),
    );
  }

  if (can("idp:roles:write")) {
    const roleFields = {
      key: z.string().describe("Lowercase letters, digits and . _ -, such as group-moderator."),
      name: z.string(),
      description: z.string(),
      parents: z.array(z.string()).max(50).describe("Keys of the roles it inherits from."),
      permissions: z.array(z.string()).max(200).describe("Keys of the permissions it grants."),
    };
    server.registerTool(
      offer("create_role"),
      {
        title: "Create a role",
        description:
          "Creates a role. You can only create roles whose permissions you hold yourself, unless you are Master Admin.",
        inputSchema: z.object(roleFields).partial().required({ key: true, name: true }),
      },
      (input) => respond(() => saveRole(actor, { ...emptyRoleDraft(), ...input })),
    );

    server.registerTool(
      offer("update_role"),
      {
        title: "Change a role",
        description:
          "Merges `changes` into a role and saves it; a list given replaces the old list. Built-in roles keep their key.",
        inputSchema: z.object({ role: roleRef, changes: z.object(roleFields).partial() }),
        annotations: { idempotentHint: true },
      },
      ({ role, changes }) =>
        respond(async () => {
          const current = findRole(await loadCatalog(actor), role);
          return saveRole(actor, { ...roleDraftFrom(current), ...changes }, current.id);
        }),
    );

    server.registerTool(
      offer("delete_role"),
      {
        title: "Delete a role",
        description:
          "Deletes a role, removing it from everyone who holds it and every role inheriting it. `confirmKey` must repeat its key.",
        inputSchema: z.object({ role: roleRef, confirmKey: z.string() }),
        annotations: { destructiveHint: true },
      },
      ({ role, confirmKey }) =>
        respond(async () => {
          const current = findRole(await loadCatalog(actor), role);
          if (current.key !== confirmKey)
            throw new RbacError(400, `confirmKey must be exactly "${current.key}".`);
          await deleteRole(actor, current.id);
          return { deleted: current.key };
        }),
    );
  }

  if (can("idp:roles:assign")) {
    for (const action of ["assign", "unassign"] as const)
      server.registerTool(
        offer(`${action}_role`),
        {
          title: action === "assign" ? "Give a role" : "Take a role away",
          description:
            action === "assign"
              ? "Gives a role to a person. You can only hand out access you hold yourself, unless you are Master Admin."
              : "Takes a role given by hand away from a person.",
          inputSchema: z.object({ role: roleRef, userId: z.string().min(1) }),
          annotations: { idempotentHint: true, destructiveHint: action === "unassign" },
        },
        ({ role, userId }) =>
          respond(async () => {
            const found = findRole(await loadCatalog(actor), role);
            if (action === "assign") await assignRole(actor, found.id, userId);
            else await unassignRole(actor, found.id, userId);
            return { [action === "assign" ? "assigned" : "unassigned"]: found.key, userId };
          }),
      );
  }

  if (can("idp:permissions:write")) {
    const permissionFields = {
      key: z.string().describe("Lowercase letters, digits and . _ - :, such as membership:read."),
      name: z.string(),
      description: z.string(),
      implies: z.array(z.string()).max(50).describe("Keys of the permissions it also grants."),
    };
    server.registerTool(
      offer("create_permission"),
      {
        title: "Create a permission",
        description:
          "Defines a permission. It confers nothing until a role grants it, and only someone who holds it can delegate it.",
        inputSchema: z.object(permissionFields).partial().required({ key: true, name: true }),
      },
      (input) => respond(() => savePermission(actor, { ...emptyPermissionDraft(), ...input })),
    );

    server.registerTool(
      offer("update_permission"),
      {
        title: "Change a permission",
        description:
          "Merges `changes` into a permission and saves it; a list given replaces the old list. Built-in permissions keep their key.",
        inputSchema: z.object({
          permission: permissionRef,
          changes: z.object(permissionFields).partial(),
        }),
        annotations: { idempotentHint: true },
      },
      ({ permission, changes }) =>
        respond(async () => {
          const current = findPermission(await loadCatalog(actor), permission);
          return savePermission(actor, { ...permissionDraftFrom(current), ...changes }, current.id);
        }),
    );

    server.registerTool(
      offer("delete_permission"),
      {
        title: "Delete a permission",
        description:
          "Deletes a permission and removes it from every role. Built-in permissions cannot be deleted. `confirmKey` must repeat its key.",
        inputSchema: z.object({ permission: permissionRef, confirmKey: z.string() }),
        annotations: { destructiveHint: true },
      },
      ({ permission, confirmKey }) =>
        respond(async () => {
          const current = findPermission(await loadCatalog(actor), permission);
          if (current.key !== confirmKey)
            throw new RbacError(400, `confirmKey must be exactly "${current.key}".`);
          await deletePermission(actor, current.id);
          return { deleted: current.key };
        }),
    );
  }

  if (masterAdmin) {
    server.registerTool(
      offer("list_audit_events"),
      {
        title: "Read the audit log",
        description:
          "Changes to roles, permissions, assignments, applications, Telegram links and student verification, newest first, with who made them and the state before and after. Master Admin only.",
        inputSchema: z.object({
          targetId: z
            .string()
            .optional()
            .describe("A client ID, role ID, permission ID or user ID."),
          actorId: z.string().optional(),
          operation: z
            .string()
            .max(64)
            .optional()
            .describe("An operation or its prefix, such as oidc-client. or role.assign."),
          before: z.iso.datetime().optional().describe("Only events older than this time."),
          limit: z.number().int().min(1).max(100).default(25),
        }),
        annotations: { readOnlyHint: true },
      },
      ({ targetId, actorId, operation, before, limit }) =>
        respond(() =>
          withAuthorizedRbacRead(actor, ["idp:mcp"], async (transaction, _catalog, access) => {
            if (!access.roles.includes(MASTER_ADMIN_ROLE_KEY))
              throw new RbacError(403, "Only Master Admin may read the audit log.");
            return transaction
              .select()
              .from(rbacAuditEvent)
              .where(
                and(
                  targetId ? eq(rbacAuditEvent.targetId, targetId) : undefined,
                  actorId ? eq(rbacAuditEvent.actorId, actorId) : undefined,
                  operation
                    ? like(rbacAuditEvent.operation, `${operation.replace(/[\\%_]/g, "\\$&")}%`)
                    : undefined,
                  before ? lt(rbacAuditEvent.createdAt, new Date(before)) : undefined,
                ),
              )
              .orderBy(desc(rbacAuditEvent.createdAt))
              .limit(limit);
          }),
        ),
    );
  }

  return server;
}
