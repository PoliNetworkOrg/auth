import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { APIError } from "better-auth/api";
import { z } from "zod";
import { validate } from "@/lib/validate";
import { disconnectAccount } from "./accounts";
import { getIdentity } from "./identity";
import { auth } from "./index";
import { sessionMiddleware } from "./middleware";
import { confirmStudentVerification, requestStudentVerification } from "./student-verification";

/**
 * Everything the account page shows about the signed-in person: the accounts they linked,
 * their identity (the same claims `/api/identity` returns), and their passkeys.
 */
export const getAccount = createServerFn({ method: "GET" })
  .middleware([sessionMiddleware])
  .handler(async ({ context }) => {
    const headers = getRequest().headers;
    const [accounts, identity, passkeys] = await Promise.all([
      auth.api.listUserAccounts({ headers }),
      getIdentity(context.session.userId),
      // The `after` hook in `./index` names each passkey after its authenticator.
      auth.api.listPasskeys({ headers }),
    ]);
    return {
      accounts: accounts.map(({ id, providerId, accountId }) => ({ id, providerId, accountId })),
      identity,
      passkeys: passkeys.map(({ id, name, createdAt }) => ({
        id,
        name: name ?? null,
        createdAt,
      })),
    };
  });

/** Removes one of the person's linked accounts; the last login method is refused. */
export const unlinkAccountFn = createServerFn({ method: "POST" })
  .middleware([sessionMiddleware])
  .validator(validate(z.object({ accountId: z.string().min(1).max(200) })))
  .handler(async ({ context, data }) => {
    await disconnectAccount(context.session.userId, data.accountId);
  });

/** Emails a six-digit code to the person's @mail.polimi.it address. */
export const requestStudentVerificationFn = createServerFn({ method: "POST" })
  .middleware([sessionMiddleware])
  .validator(validate(z.object({ email: z.string().max(254) })))
  .handler(({ context, data }) => requestStudentVerification(context.session.userId, data.email));

/** Checks the code and links the Polimi email, which grants the student status. */
export const confirmStudentVerificationFn = createServerFn({ method: "POST" })
  .middleware([sessionMiddleware])
  .validator(validate(z.object({ email: z.string().max(254), code: z.string().max(32) })))
  .handler(({ context, data }) => confirmStudentVerification(context.session.userId, data));

export type ConsentApp =
  | {
      status: "ready";
      app: {
        name: string;
        logo: string | null;
        uri: string | null;
        policyUri: string | null;
        tosUri: string | null;
      };
    }
  | { status: "unavailable" | "error"; app: null };

/**
 * The public details of the application asking for consent. A missing or disabled
 * application is "unavailable"; any other failure is "error", and the person can still decide.
 */
export const getConsentApp = createServerFn({ method: "GET" })
  .middleware([sessionMiddleware])
  .validator(validate(z.object({ clientId: z.string().min(1) })))
  .handler(async ({ data }): Promise<ConsentApp> => {
    try {
      const client = await auth.api.getOAuthClientPublic({
        query: { client_id: data.clientId },
        headers: getRequest().headers,
      });
      return {
        status: "ready",
        app: {
          name: client.client_name ?? "This application",
          logo: client.logo_uri ?? null,
          uri: client.client_uri ?? null,
          policyUri: client.policy_uri ?? null,
          tosUri: client.tos_uri ?? null,
        },
      };
    } catch (cause) {
      if (cause instanceof APIError && cause.statusCode === 404)
        return { status: "unavailable", app: null };
      console.error(cause);
      return { status: "error", app: null };
    }
  });
