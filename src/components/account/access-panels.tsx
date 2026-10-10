import { useState, type ReactNode } from "react";
import { cn } from "cn";
import { BadgeCheck, Fingerprint, Plus, Search, Trash2 } from "lucide-react";
import type { AccountDetails } from "@/auth/account.functions";
import { Button } from "@/components/ui/button";
import { CollapsiblePanel, Panel, Spinner } from "./panel";
import { shortDate } from "./time";
import type { AccountActions } from "./use-account-actions";

export function PasskeysPanel({
  passkeys,
  actions,
}: {
  passkeys: AccountDetails["passkeys"];
  actions: AccountActions;
}) {
  const locked = actions.busy !== null;
  return (
    <Panel
      title="Passkeys"
      count={passkeys.length || undefined}
      action={
        <Button
          variant="outline"
          size="sm"
          className="active:scale-[0.97]"
          disabled={locked}
          onClick={() => void actions.addPasskey()}
        >
          {actions.busy === "add-passkey" ? <Spinner /> : <Plus />}
          Add passkey
        </Button>
      }
    >
      {passkeys.length ? (
        <ul className="divide-y">
          {passkeys.map((passkey) => (
            <li key={passkey.id} className="flex min-h-16 items-center gap-3.5 px-5 py-3">
              <Fingerprint className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{passkey.name || "Passkey"}</p>
                <p className="text-[13px] text-muted-foreground">
                  Added {shortDate.format(new Date(passkey.createdAt))}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive active:scale-[0.97] dark:hover:text-red-300"
                disabled={locked}
                onClick={() => void actions.removePasskey(passkey.id)}
              >
                {actions.busy === passkey.id ? <Spinner /> : <Trash2 />}
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex items-center gap-3.5 px-5 py-5">
          <Fingerprint className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">No passkeys yet.</p>
        </div>
      )}
    </Panel>
  );
}

/** Socio and Direttivo come from Entra rather than an admin, so they stand out as filled chips. */
export function GroupsPanel({ groups }: { groups: AccountDetails["groups"] }) {
  return (
    <Panel title="Groups" count={groups.length || undefined}>
      {groups.length ? (
        <ul className="flex flex-wrap gap-2 px-5 py-4">
          {groups.map((group) => (
            <li
              key={group.key}
              title={group.description ?? undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full py-1.5 text-sm font-medium",
                group.automatic
                  ? "bg-primary pr-3 pl-2 text-primary-foreground"
                  : "border bg-muted/40 px-3",
              )}
            >
              {group.automatic && <BadgeCheck className="size-4" aria-hidden="true" />}
              {group.name}
              {group.automatic && <span className="sr-only">(automatic)</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-5 text-sm text-muted-foreground">No groups yet.</p>
      )}
    </Panel>
  );
}

/** Every case-insensitive occurrence of the query in the text, marked. */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return text;
  const parts: ReactNode[] = [];
  const lower = text.toLowerCase();
  let from = 0;
  for (let at = lower.indexOf(query); at !== -1; at = lower.indexOf(query, from)) {
    parts.push(text.slice(from, at));
    parts.push(
      <mark key={at} className="rounded-sm bg-primary/25 text-inherit">
        {text.slice(at, at + query.length)}
      </mark>,
    );
    from = at + query.length;
  }
  parts.push(text.slice(from));
  return parts;
}

type Permission = AccountDetails["permissions"][number];

/** Permissions bucketed by the part of their key before the first colon, in key order. */
export function groupByPrefix(permissions: Permission[]) {
  const groups = new Map<string, Permission[]>();
  for (const permission of [...permissions].sort((a, b) => a.key.localeCompare(b.key))) {
    const prefix = permission.key.split(":")[0];
    groups.set(prefix, [...(groups.get(prefix) ?? []), permission]);
  }
  return [...groups];
}

export function PermissionsPanel({ permissions }: { permissions: Permission[] }) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const matching = query
    ? permissions.filter(
        (permission) =>
          permission.key.toLowerCase().includes(query) ||
          permission.name.toLowerCase().includes(query),
      )
    : permissions;

  return (
    <CollapsiblePanel title="Permissions" count={permissions.length} disabled={!permissions.length}>
      <div className="flow-root px-5 py-4">
        <div className="relative float-right mb-3 ml-4 w-full sm:w-64">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setSearch("");
            }}
            aria-label="Search permissions"
            placeholder="Search"
            autoComplete="off"
            spellCheck={false}
            className="h-9 w-full rounded-md border bg-background pr-2.5 pl-8 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:text-sm dark:bg-input/30"
          />
        </div>
        {matching.length ? (
          groupByPrefix(matching).map(([prefix, group], index) => (
            <section key={prefix} className={cn("grid gap-2", index > 0 && "mt-4")}>
              <h3 className="flex items-baseline gap-1.5 font-mono text-xs text-muted-foreground">
                {prefix}
                <span className="tabular-nums opacity-70">{group.length}</span>
              </h3>
              <ul className="flex flex-wrap gap-1.5">
                {group.map((permission) => (
                  <li
                    key={permission.key}
                    className="inline-flex items-baseline gap-2 rounded-md bg-muted px-2 py-1"
                  >
                    <span className="text-[13px]">
                      <Highlight text={permission.name} query={query} />
                    </span>
                    <code className="text-[11px] text-muted-foreground">
                      <Highlight text={permission.key.slice(prefix.length + 1)} query={query} />
                    </code>
                  </li>
                ))}
              </ul>
            </section>
          ))
        ) : (
          <p role="status" className="py-1.5 text-sm text-muted-foreground">
            You don't have “{search.trim()}”.
          </p>
        )}
      </div>
    </CollapsiblePanel>
  );
}
