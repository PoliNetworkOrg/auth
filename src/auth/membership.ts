import { ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import { env } from "../env";

type MembersPage = { value: { id: string }[]; "@odata.nextLink"?: string };

// Match the backend's direct group membership, including members beyond the first page.
export async function readGroupMembership(
  getPage: (path: string) => Promise<MembersPage>,
  groupId: string,
  objectId: string,
): Promise<boolean> {
  let path: string | undefined = `/groups/${groupId}/members?$select=id&$top=999`;
  while (path) {
    const page = await getPage(path);
    if (page.value.some((member) => member.id === objectId)) return true;
    path = page["@odata.nextLink"];
  }
  return false;
}

/** Every direct member's object ID, following every page. */
export async function readGroupMembers(
  getPage: (path: string) => Promise<MembersPage>,
  groupId: string,
): Promise<Set<string>> {
  const members = new Set<string>();
  let path: string | undefined = `/groups/${groupId}/members?$select=id&$top=999`;
  while (path) {
    const page = await getPage(path);
    for (const member of page.value) members.add(member.id);
    path = page["@odata.nextLink"];
  }
  return members;
}

let graphClient: Client | undefined;
export const GRAPH_CHECK_TIMEOUT_MS = 5_000;

/**
 * Runs a read against Microsoft Graph with the PN credentials and a deadline. Returns null
 * when it could not be completed; callers must not treat that as an empty answer.
 */
async function readGraph<T>(
  read: (getPage: (path: string) => Promise<MembersPage>) => Promise<T>,
): Promise<T | null> {
  if (!env.PN_ENTRA_TENANT_ID || !env.PN_ENTRA_CLIENT_ID || !env.PN_ENTRA_CLIENT_SECRET) {
    console.warn("Entra group check unavailable: configure PN_ENTRA credentials.");
    return null;
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!graphClient) {
      const credential = new ClientSecretCredential(
        env.PN_ENTRA_TENANT_ID,
        env.PN_ENTRA_CLIENT_ID,
        env.PN_ENTRA_CLIENT_SECRET,
      );
      graphClient = Client.initWithMiddleware({
        authProvider: {
          getAccessToken: async () =>
            (await credential.getToken("https://graph.microsoft.com/.default")).token,
        },
      });
    }
    const client = graphClient;
    return await Promise.race([
      read((path) => client.api(path).option("signal", controller.signal).get()),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Graph membership check timed out."));
        }, GRAPH_CHECK_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    // Do not log Graph errors wholesale: they may contain tokens or personal data.
    const status = error instanceof Error && "statusCode" in error ? error.statusCode : null;
    console.warn(
      "Entra group check failed.",
      typeof status === "number"
        ? `Graph HTTP ${status}.`
        : "Check PN Entra credentials/connectivity.",
      "The PN_ENTRA_CLIENT_ID app needs Graph application GroupMember.Read.All with admin consent; check the group ID too.",
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Checks whether an Entra object is a direct member of a group through Microsoft Graph.
 * Returns null when the check could not be performed; callers must not treat that as
 * confirmed nonmembership.
 */
export async function checkEntraGroupMember(
  groupId: string,
  objectId: string,
): Promise<boolean | null> {
  return readGraph((getPage) => readGroupMembership(getPage, groupId, objectId));
}

/**
 * Every direct member of a group, for showing many people's membership at once. Returns
 * null when the listing could not be completed, never a partial set.
 */
export async function listEntraGroupMembers(groupId: string): Promise<Set<string> | null> {
  return readGraph((getPage) => readGroupMembers(getPage, groupId));
}

/**
 * The states the PoliNetwork Entra groups currently prove for an Entra object. Returns null
 * when any configured check could not be performed, so a Graph outage never looks like a
 * confirmed loss of membership.
 */
export async function checkPnGroupStates(objectId: string): Promise<string[] | null> {
  const groups = [
    { state: "socio", groupId: env.PN_ENTRA_MEMBER_GROUP_ID },
    { state: "direttivo", groupId: env.PN_ENTRA_DIRETTIVO_GROUP_ID },
  ].filter((group): group is { state: string; groupId: string } => Boolean(group.groupId));
  const memberships = await Promise.all(
    groups.map((group) => checkEntraGroupMember(group.groupId, objectId)),
  );
  if (memberships.some((member) => member === null)) return null;
  return groups.flatMap((group, index) => (memberships[index] ? [group.state] : []));
}

/**
 * Evidence to store for an Entra account. An unsuccessful check expires immediately instead
 * of being cached as a confirmed nonmember, so the next request retries.
 */
export function membershipEvidence(states: string[] | null, now = new Date()) {
  return {
    states: states ?? [],
    validUntil: new Date(
      now.getTime() + (states === null ? 0 : env.PN_ENTRA_MEMBER_REFRESH_HOURS * 3_600_000),
    ),
  };
}
