import { ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js";
import { env } from "../env";

export const studentVerificationEmailConfigured = Boolean(
  env.AZURE_TENANT_ID && env.AZURE_CLIENT_ID && env.AZURE_CLIENT_SECRET,
);

let graphClient: Client | undefined;

function getGraphClient() {
  if (graphClient) return graphClient;
  if (!env.AZURE_TENANT_ID || !env.AZURE_CLIENT_ID || !env.AZURE_CLIENT_SECRET) {
    throw new Error("Azure email credentials are not configured");
  }
  const credential = new ClientSecretCredential(
    env.AZURE_TENANT_ID,
    env.AZURE_CLIENT_ID,
    env.AZURE_CLIENT_SECRET,
  );
  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: ["https://graph.microsoft.com/.default"],
  });
  graphClient = Client.initWithMiddleware({ authProvider });
  return graphClient;
}

export async function sendStudentVerificationEmail(email: string, code: string) {
  await getGraphClient()
    .api(`/users/${encodeURIComponent(env.AZURE_EMAIL_SENDER)}/sendMail`)
    .post({
      message: {
        subject: "Verify your Polimi student status",
        body: {
          contentType: "HTML",
          content: [
            "<p>Use this code to verify your Politecnico di Milano student email for PoliNetwork:</p>",
            `<p style="font-size: 28px; font-weight: 700; letter-spacing: 4px">${code}</p>`,
            "<p>The code expires in 10 minutes. If you did not request it, ignore this message.</p>",
          ].join(""),
        },
        toRecipients: [{ emailAddress: { address: email } }],
      },
      saveToSentItems: false,
    });
}
