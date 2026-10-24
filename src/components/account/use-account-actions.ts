import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  disconnectMcpAgentFn,
  revokeOtherSessionsFn,
  revokeSessionFn,
  unlinkAccountFn,
} from "@/auth/account.functions";
import { authClient } from "@/auth/client";
import { errorMessage } from "@/lib/action-error";

/**
 * Every action on the account page, sharing one busy key so only the button that started an
 * action spins. Outcomes show as toasts.
 */
export function useAccountActions() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<string | void>, fallback: string) {
    setBusy(key);
    try {
      const message = await action();
      if (message) toast.success(message);
    } catch (cause) {
      toast.error(errorMessage(cause, fallback));
    } finally {
      setBusy(null);
    }
  }
  /** Brings the accounts, membership, sessions and passkeys up to date. */
  const refresh = () => router.invalidate({ sync: true });

  return {
    busy,
    link: (provider: string) =>
      run(
        provider,
        async () => {
          const result = await authClient.linkSocial({ provider, callbackURL: "/" });
          if (result.error) throw new Error(result.error.message ?? "Sign-in failed.");
        },
        "Unable to contact the identity service.",
      ),
    unlink: (accountId: string) =>
      run(
        accountId,
        async () => {
          await unlinkAccountFn({ data: { accountId } });
          await refresh();
        },
        "Unable to unlink account.",
      ),
    signOut: () =>
      run(
        "sign-out",
        async () => {
          const result = await authClient.signOut();
          if (result.error) throw new Error(result.error.message ?? "Unable to sign out.");
          // The root context still holds the old session until it loads again.
          await refresh();
        },
        "Unable to sign out.",
      ),
    addPasskey: () =>
      run(
        "add-passkey",
        async () => {
          if (!window.isSecureContext || !window.PublicKeyCredential)
            throw new Error("Passkeys aren't available in this browser.");
          const result = await authClient.passkey.addPasskey();
          if (result.error) throw new Error(result.error.message ?? "Unable to add a passkey.");
          await refresh();
          return "Passkey added.";
        },
        "Unable to add a passkey.",
      ),
    removePasskey: (id: string) =>
      run(
        id,
        async () => {
          const result = await authClient.passkey.deletePasskey({ id });
          if (result.error) throw new Error(result.error.message ?? "Unable to remove passkey.");
          await refresh();
          return "Passkey removed.";
        },
        "Unable to remove this passkey.",
      ),
    revokeSession: (sessionId: string) =>
      run(
        sessionId,
        async () => {
          await revokeSessionFn({ data: { sessionId } });
          await refresh();
          return "Signed out of that session.";
        },
        "Unable to sign out of that session.",
      ),
    revokeOtherSessions: () =>
      run(
        "revoke-others",
        async () => {
          await revokeOtherSessionsFn();
          await refresh();
          return "Signed out everywhere else.";
        },
        "Unable to sign out of the other sessions.",
      ),
    disconnectAgent: (clientId: string) =>
      run(
        clientId,
        async () => {
          await disconnectMcpAgentFn({ data: { clientId } });
          await refresh();
          return "Agent disconnected.";
        },
        "Unable to disconnect this agent.",
      ),
  };
}

export type AccountActions = ReturnType<typeof useAccountActions>;
