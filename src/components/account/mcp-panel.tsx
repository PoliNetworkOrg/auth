import { useState } from "react";
import { Bot, Unplug } from "lucide-react";
import type { AccountDetails } from "@/auth/account.functions";
import { mcpSetupCommands } from "@/auth/mcp-clients";
import { CopyButton } from "@/components/copy-button";
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

type Mcp = NonNullable<AccountDetails["mcp"]>;

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex min-h-14 items-center gap-3.5 px-5 py-2.5">
      <span className="w-24 shrink-0 text-sm font-medium">{label}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-muted-foreground">
        {value}
      </code>
      <CopyButton value={value} label={`Copy ${label}`} />
    </li>
  );
}

/** Where agents connect to the MCP server, and the agents this person has connected. */
export function McpPanel({ mcp, actions }: { mcp: Mcp; actions: AccountActions }) {
  const [pending, setPending] = useState<{ clientId: string; name: string } | null>(null);
  const locked = actions.busy !== null;
  return (
    <Panel title="MCP" count={mcp.agents.length || undefined}>
      <ul className="divide-y">
        <CopyRow label="Server" value={mcp.serverUrl} />
        {mcpSetupCommands(mcp.serverUrl).map((entry) => (
          <CopyRow key={entry.id} label={entry.label} value={entry.command} />
        ))}
        {mcp.agents.map((agent) => {
          const name = agent.name ?? "Agent";
          return (
            <li key={agent.clientId} className="flex min-h-16 items-center gap-3.5 px-5 py-3">
              <Bot className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{name}</p>
                <p className="truncate text-[13px] text-muted-foreground">
                  {agent.redirectHost && <>{agent.redirectHost} · </>}
                  {agent.lastUsedAt ? (
                    <>
                      Active <TimeAgo value={agent.lastUsedAt} />
                    </>
                  ) : (
                    <>
                      Connected <TimeAgo value={agent.connectedAt} />
                    </>
                  )}
                </p>
              </div>
              <Button
                variant="destructive-soft"
                size="icon-sm"
                className="border-0"
                aria-label={`Disconnect ${name}`}
                title="Disconnect"
                disabled={locked}
                onClick={() => setPending({ clientId: agent.clientId, name })}
              >
                {actions.busy === agent.clientId ? <Spinner /> : <Unplug />}
              </Button>
            </li>
          );
        })}
      </ul>

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent aria-describedby={undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {pending?.name}?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={buttonVariants({ variant: "ghost" })}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive-soft" })}
              onClick={() => {
                if (pending) void actions.disconnectAgent(pending.clientId);
              }}
            >
              <Unplug />
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}
