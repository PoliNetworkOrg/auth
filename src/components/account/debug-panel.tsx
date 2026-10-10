import type { ReactNode } from "react";
import type { AccountDetails } from "@/auth/account.functions";
import { CollapsiblePanel } from "./panel";
import { SecretText } from "./secret-text";
import { LocalTime } from "./time";

function Unknown() {
  return <span className="text-sm text-muted-foreground">Unknown</span>;
}

function Keys({ keys }: { keys: string[] }) {
  return keys.length ? (
    <span className="font-mono text-xs text-muted-foreground">{keys.join(", ")}</span>
  ) : (
    <span className="text-sm text-muted-foreground">None</span>
  );
}

/** IDs and session facts for whoever is debugging a sign-in. Anything identifying starts hidden. */
export function DebugPanel({ debug }: { debug: AccountDetails["debug"] }) {
  const { session } = debug;
  const rows: [string, ReactNode][] = [
    ["User ID", <SecretText value={debug.userId} label="user ID" />],
    ...(session
      ? ([
          ["Session ID", <SecretText value={session.id} label="session ID" />],
          ["Session started", <LocalTime value={session.createdAt} withRelative />],
          ["Session expires", <LocalTime value={session.expiresAt} withRelative />],
          [
            "IP address",
            session.ipAddress ? (
              <SecretText value={session.ipAddress} label="IP address" />
            ) : (
              <Unknown />
            ),
          ],
          [
            "User agent",
            session.userAgent ? (
              <SecretText value={session.userAgent} label="user agent" maxChars={60} />
            ) : (
              <Unknown />
            ),
          ],
        ] satisfies [string, ReactNode][])
      : []),
    [
      "Account created",
      debug.userCreatedAt ? <LocalTime value={debug.userCreatedAt} /> : <Unknown />,
    ],
    ["Role keys", <Keys keys={debug.roleKeys} />],
    ["States", <Keys keys={debug.states} />],
  ];
  return (
    <CollapsiblePanel title="Debug">
      <dl className="divide-y">
        {rows.map(([term, value]) => (
          <div
            key={term}
            className="grid gap-1 px-5 py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-center sm:gap-4"
          >
            <dt className="text-sm text-muted-foreground">{term}</dt>
            <dd className="min-w-0">{value}</dd>
          </div>
        ))}
      </dl>
    </CollapsiblePanel>
  );
}
