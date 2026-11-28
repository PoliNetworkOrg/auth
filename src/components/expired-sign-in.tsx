import { useEffect, useMemo, useRef, useState } from "react";
import { Clock, LoaderCircle } from "lucide-react";
import { signedQueryExpiry } from "@/auth/sign-in-errors";
import { returnFromExpiredSignIn } from "@/auth/sign-in-errors.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export type SignInExpiry =
  | { status: "active" }
  /** Expired: the page is on its way back to the application. */
  | { status: "leaving"; app: string }
  /**
   * Expired. With `back`, a button takes the person back to the application; without it, Auth
   * has nowhere to send them.
   */
  | { status: "expired"; back?: { app: string; href: string } };

/**
 * Watches the signed query of an application's sign-in page (`searchStr`). When it expires,
 * whether the page sat open or was opened late, the page sends the person back to the
 * application with `login_required`, so it starts a fresh sign-in: a button on an expired page
 * could only ever fail. Call `expire()` when a request fails because the query expired.
 *
 * With `leave: "ask"`, the page shows a **Back to {application}** button instead of leaving on its
 * own, for pages someone may still be reading (consent) or acting on (adding a passkey).
 */
export function useSignInExpiry(
  searchStr: string,
  { leave = "auto" }: { leave?: "auto" | "ask" } = {},
) {
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
  /** Set once the page leaves or shows that it expired. */
  const settled = useRef(false);

  function schedule(at: number) {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void expire(), Math.max(0, at - Date.now()));
  }

  /**
   * Asks the server whether the query expired. True when the page is leaving or shows that it
   * expired; false when it's still valid and the page stays as it is.
   */
  async function expire(): Promise<boolean> {
    // Already showing that it expired, or on its way out: nothing else to do.
    if (settled.current) return true;
    if (checking.current) return false;
    checking.current = true;
    try {
      const result = await returnFromExpiredSignIn({ data: { search: window.location.search } });
      if (!mounted.current) {
        checking.current = false;
        return false;
      }
      if (result.status === "expired" && leave === "ask") {
        settled.current = true;
        setState({ status: "expired", back: { app: result.app, href: result.href } });
        return true;
      }
      if (result.status === "expired") {
        settled.current = true;
        setState({ status: "leaving", app: result.app });
        window.location.replace(result.href);
        return true;
      }
      if (result.status === "active") {
        // This browser's clock is ahead of the server's: wait for the server's expiry.
        deadline.current = Date.now() + result.remainingMs;
        schedule(deadline.current + 1000);
        checking.current = false;
        return false;
      }
      settled.current = true;
      setState({ status: "expired" });
    } catch {
      if (mounted.current) {
        settled.current = true;
        setState({ status: "expired" });
      }
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
              : state.back
                ? `For your security, sign-in pages only last a few minutes. Go back to ${state.back.app} and start again.`
                : "For your security, sign-in pages only last a few minutes. Go back to the application and start again."}
          </p>
        </div>
        {state.status === "expired" && state.back && (
          <Button asChild className="mt-2 h-11 w-full">
            <a href={state.back.href}>Back to {state.back.app}</a>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
