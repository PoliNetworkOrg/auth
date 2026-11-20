import { Hint } from "@/components/ui/tooltip";
import { useState } from "react";
import { LogOut, Monitor, Smartphone } from "lucide-react";
import type { AccountDetails } from "@/auth/account.functions";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Panel, Spinner } from "./panel";
import { TimeAgo } from "./time";
import type { AccountActions } from "./use-account-actions";

/** "Chrome on macOS" from a user agent: a label for people, never something to decide on. */
export function describeAgent(agent: string | null) {
  if (!agent) return { label: "Unknown device", phone: false };
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /OPR\//.test(agent)
      ? "Opera"
      : /Firefox\//.test(agent)
        ? "Firefox"
        : /Chrome\//.test(agent)
          ? "Chrome"
          : /Safari\//.test(agent)
            ? "Safari"
            : "Browser";
  const os = /iPhone|iPad|iPod/.test(agent)
    ? "iOS"
    : /Android/.test(agent)
      ? "Android"
      : /Windows NT/.test(agent)
        ? "Windows"
        : /CrOS/.test(agent)
          ? "ChromeOS"
          : /Mac OS X|Macintosh/.test(agent)
            ? "macOS"
            : /Linux/.test(agent)
              ? "Linux"
              : null;
  return { label: os ? `${browser} on ${os}` : browser, phone: /Mobi|iPhone|Android/.test(agent) };
}

/** What the confirmation is about: one session by id, or every session but this one. */
type Pending = { kind: "one"; id: string; label: string } | { kind: "others"; count: number };

export function SessionsPanel({
  sessions,
  actions,
}: {
  sessions: AccountDetails["sessions"];
  actions: AccountActions;
}) {
  const [pending, setPending] = useState<Pending | null>(null);
  const locked = actions.busy !== null;
  const others = sessions.filter((entry) => !entry.current).length;
  const ordered = [...sessions].sort((a, b) => Number(b.current) - Number(a.current));

  return (
    <Panel
      title="Sessions"
      count={sessions.length || undefined}
      action={
        others > 0 && (
          <Button
            variant="destructive-soft"
            size="sm"
            disabled={locked}
            onClick={() => setPending({ kind: "others", count: others })}
          >
            {actions.busy === "revoke-others" ? <Spinner /> : <LogOut />}
            Sign out everywhere else
          </Button>
        )
      }
    >
      <ul className="divide-y">
        {ordered.map((entry) => {
          const agent = describeAgent(entry.userAgent);
          const Icon = agent.phone ? Smartphone : Monitor;
          return (
            <li key={entry.id} className="flex min-h-16 items-center gap-3.5 px-5 py-3">
              <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                  {agent.label}
                  {entry.current && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                      This device
                    </span>
                  )}
                </p>
                <p className="text-[13px] text-muted-foreground">
                  {entry.current ? (
                    "Active now"
                  ) : (
                    <>
                      Active <TimeAgo value={entry.updatedAt} />
                    </>
                  )}
                </p>
              </div>
              {!entry.current && (
                <Hint content="Sign out">
                  <Button
                    variant="destructive-soft"
                    size="icon-sm"
                    className="border-0"
                    aria-label={`Sign out of ${agent.label}`}

                    disabled={locked}
                    onClick={() => setPending({ kind: "one", id: entry.id, label: agent.label })}
                  >
                    {actions.busy === entry.id ? <Spinner /> : <LogOut />}
                  </Button>
                </Hint>
              )}
            </li>
          );
        })}
      </ul>

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent aria-describedby={undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.kind === "one"
                ? `Sign out of ${pending.label}?`
                : `Sign out of ${pending?.count ?? 0} other ${pending?.count === 1 ? "session" : "sessions"}?`}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={buttonVariants({ variant: "ghost" })}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive-soft" })}
              onClick={() => {
                if (!pending) return;
                if (pending.kind === "one") void actions.revokeSession(pending.id);
                else void actions.revokeOtherSessions();
              }}
            >
              <LogOut />
              Sign out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}
