import { useEffect, useMemo, useRef, useState } from "react";
import { Clock, LoaderCircle } from "lucide-react";
import { signedQueryExpiry } from "@/auth/sign-in-errors";
import { returnFromExpiredSignIn } from "@/auth/sign-in-errors.functions";
import { Card, CardContent } from "@/components/ui/card";

export type SignInExpiry =
  | { status: "active" }
  /** Expired: the page is on its way back to the application. */
  | { status: "leaving"; app: string }
  /** Expired, with no application Auth can send the person back to. */
  | { status: "expired" };

/**
 * Watches the signed query of an application's sign-in page (`searchStr`). When it expires,
 * whether the page sat open or was opened late, the page sends the person back to the
 * application with `login_required`, so it starts a fresh sign-in: a button on an expired page
 * could only ever fail. Call `expire()` when a request fails because the query expired.
 */
export function useSignInExpiry(searchStr: string) {
  const expiresAt = useMemo(() => signedQueryExpiry(searchStr), [searchStr]);
  const [state, setState] = useState<SignInExpiry>({ status: "active" });
  const checking = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Cleared on unmount, so a check still in flight can't navigate or schedule another. */
  const mounted = useRef(false);
  /**
   * When the query expires by this browser's clock. It starts as the query's own `exp`, and
   * moves to the server's answer when the server says it's still valid: a browser clock running
   * ahead would otherwise disable every button until the server agreed.
   */
  const deadline = useRef(expiresAt);

  function schedule(at: number) {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void expire(), Math.max(0, at - Date.now()));
  }

  /**
   * Asks the server whether the query expired. True when the page is leaving or shows that it
   * expired; false when it's still valid and the page stays as it is.
   */
  async function expire(): Promise<boolean> {
    if (checking.current) return false;
    checking.current = true;
    try {
      const result = await returnFromExpiredSignIn({ data: { search: window.location.search } });
      if (!mounted.current) return false;
      if (result.status === "expired") {
        setState({ status: "leaving", app: result.app });
        window.location.replace(result.href);
        // Stays checking: the page is on its way out.
        return true;
      }
      if (result.status === "active") {
        // This browser's clock is ahead of the server's: wait for the server's expiry.
        deadline.current = Date.now() + result.remainingMs;
        schedule(deadline.current + 1000);
        checking.current = false;
        return false;
      }
      setState({ status: "expired" });
    } catch {
      if (mounted.current) setState({ status: "expired" });
    }
    checking.current = false;
    return true;
  }

  useEffect(() => {
    mounted.current = true;
    deadline.current = expiresAt;
    if (expiresAt !== null) schedule(expiresAt);
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
    // `expire` and `schedule` only read refs and the current location.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt]);

  return {
    state,
    expire,
    /** Whether the page's query has expired, by the server's latest answer when there is one. */
    isExpired: () => deadline.current !== null && Date.now() >= deadline.current,
  };
}

/** What an expired sign-in page shows instead of its buttons, inside its `LoginLayout`. */
export function ExpiredSignIn({ state }: { state: Exclude<SignInExpiry, { status: "active" }> }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 px-6 py-10 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl border bg-background text-muted-foreground">
          {state.status === "leaving" ? (
            <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
          ) : (
            <Clock className="size-5" aria-hidden="true" />
          )}
        </div>
        <div role="status">
          <h1 className="text-xl font-bold tracking-tight text-balance">
            This sign-in page expired
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {state.status === "leaving"
              ? `Taking you back to ${state.app} to start again…`
              : "For your security, sign-in pages only last a few minutes. Go back to the application and start again."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
