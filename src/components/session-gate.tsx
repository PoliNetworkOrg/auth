import { useEffect, useState } from "react";
import { authClient } from "@/auth/client";
import { LoginLayout } from "@/components/login-page";
import { Button } from "@/components/ui/button";

/** Quiet retries before a failed first load asks the person to try again. */
const RETRY_DELAYS_MS = [1000, 3000];

type SessionGate = {
  session: typeof authClient.$Infer.Session | null;
  status: "loading" | "error" | "ready";
  retry: () => void;
};

/**
 * The session for pages that need to know who is signed in.
 *
 * Only a failed load with no session at all is an error. better-auth refetches on focus and
 * when the network returns, and a failed refetch keeps the session it already had, so a phone
 * waking up never replaces a page with an error. A failed first load is retried quietly before
 * the person is asked to.
 */
export function useSessionGate(): SessionGate {
  const { data: session, isPending, isRefetching, error, refetch } = authClient.useSession();
  const [attempt, setAttempt] = useState(0);
  const failed = !!error && !session && !isPending;
  const retrying = failed && attempt < RETRY_DELAYS_MS.length;

  useEffect(() => {
    if (!retrying) return;
    const timer = setTimeout(() => {
      setAttempt((value) => value + 1);
      void refetch();
    }, RETRY_DELAYS_MS[attempt]);
    return () => clearTimeout(timer);
  }, [retrying, attempt, refetch]);

  useEffect(() => {
    if (!error && !isRefetching) setAttempt(0);
  }, [error, isRefetching]);

  return {
    session,
    status: isPending || retrying ? "loading" : failed ? "error" : "ready",
    retry: () => {
      setAttempt(0);
      void refetch();
    },
  };
}

/** What to show while the session is loading or could not be loaded. */
export function SessionFallback({ gate, wide }: { gate: SessionGate; wide?: boolean }) {
  return (
    <LoginLayout wide={wide}>
      {gate.status === "error" ? (
        <div className="space-y-4 text-center">
          <p role="alert">
            We couldn't reach PoliNetwork Auth. Check your connection and try again.
          </p>
          <Button onClick={gate.retry}>Try again</Button>
        </div>
      ) : (
        <p role="status" className="text-center text-sm text-muted-foreground">
          Loading your session…
        </p>
      )}
    </LoginLayout>
  );
}
