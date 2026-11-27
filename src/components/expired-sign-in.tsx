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

  async function expire() {
    if (checking.current) return;
    checking.current = true;
    try {
      const result = await returnFromExpiredSignIn({ data: { search: window.location.search } });
      if (result.status === "expired") {
        setState({ status: "leaving", app: result.app });
        window.location.replace(result.href);
        return;
      }
      if (result.status === "active") {
        // This browser's clock is ahead of the server's: check again when it really expires.
        clearTimeout(timer.current);
        timer.current = setTimeout(() => void expire(), result.remainingMs + 1000);
      } else setState({ status: "expired" });
    } catch {
      setState({ status: "expired" });
    }
    checking.current = false;
  }

  useEffect(() => {
    if (expiresAt === null) return;
    timer.current = setTimeout(() => void expire(), Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer.current);
    // `expire` only reads refs and the current location.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt]);

  return {
    state,
    expire,
    /** Whether the page's query has expired by this browser's clock. */
    isExpired: () => expiresAt !== null && Date.now() >= expiresAt,
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
