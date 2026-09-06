import { ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import { env } from "../env";

type MembersPage = { value: { id: string }[]; "@odata.nextLink"?: string };

// Match the backend's direct Soci membership, including members beyond the first page.
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

let graphClient: Client | undefined;

export async function checkPnMemberGroup(objectId: string): Promise<boolean | null> {
  if (!env.PN_ENTRA_TENANT_ID || !env.PN_ENTRA_CLIENT_ID || !env.PN_ENTRA_CLIENT_SECRET) {
    console.warn("PN membership check unavailable: configure PN_ENTRA credentials.");
    return null;
  }
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
    return await readGroupMembership(
      (path) => client.api(path).get(),
      env.PN_ENTRA_MEMBER_GROUP_ID,
      objectId,
    );
  } catch (error) {
    // Do not log Graph errors wholesale: they may contain tokens or personal data.
    const status = error instanceof Error && "statusCode" in error ? error.statusCode : null;
    console.warn(
      "PN membership check failed.",
      typeof status === "number"
        ? `Graph HTTP ${status}.`
        : "Check PN Entra credentials/connectivity.",
      "The PN_ENTRA_CLIENT_ID app needs Graph application GroupMember.Read.All with admin consent; check PN_ENTRA_MEMBER_GROUP_ID too.",
    );
    return null;
  }
}

export function membershipEvidence(member: boolean | null, now = new Date()) {
  return {
    state: member === true ? "socio" : null,
    // An unsuccessful check must not be cached as a confirmed nonmember.
    validUntil: new Date(
      now.getTime() + (member === null ? 0 : env.PN_ENTRA_MEMBER_REFRESH_HOURS * 3_600_000),
    ),
  };
}
