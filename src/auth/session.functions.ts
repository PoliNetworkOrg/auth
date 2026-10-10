import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { studentVerificationEmailConfigured } from "./email";
import { getIdentity } from "./identity";
import { auth } from "./index";
import { actionMiddleware } from "./middleware";
import { providers } from "./providers";
import { env } from "../env";

/** Which accounts this deployment can sign in with, and which it can link afterwards. */
function providerCapabilities() {
  return {
    signIn: [
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? ["google"] : []),
      ...(providers.some((provider) => provider.providerId === "pn-entra") ? ["pn-entra"] : []),
    ],
    link: [
      ...(providers.some((provider) => provider.providerId === "telegram") ? ["telegram"] : []),
      ...(studentVerificationEmailConfigured ? ["polimi-email"] : []),
    ],
  };
}

/**
 * What every page needs before it renders: who is signed in and what they may do (null
 * when nobody is), and the sign-in methods for the login page any route can show. This
 * only shapes the UI; every server function checks the session again.
 */
export const getRootContext = createServerFn({ method: "GET" })
  .middleware([actionMiddleware])
  .handler(async () => {
    const providers = providerCapabilities();
    const session = await auth.api.getSession({ headers: getRequest().headers });
    if (!session) return { viewer: null, providers };
    const { permissions, roles } = await getIdentity(session.user.id);
    const { id, name, email, image } = session.user;
    return {
      viewer: { user: { id, name, email, image: image ?? null }, permissions, roles },
      providers,
    };
  });

type RootContext = Awaited<ReturnType<typeof getRootContext>>;
export type Viewer = NonNullable<RootContext["viewer"]>;
export type ProviderCapabilities = RootContext["providers"];
