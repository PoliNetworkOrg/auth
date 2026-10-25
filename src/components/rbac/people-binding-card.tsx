import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { parsePeopleBinding } from "@/auth/people-binding";
import type { RoleSummary } from "@/auth/rbac";
import { setRolePeopleBindingFn } from "@/auth/rbac.functions";
import { Field } from "@/components/rbac/fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorMessage } from "@/lib/action-error";

type Kind = "none" | "admin" | "member" | "lead";

const KINDS: { value: Kind; label: string }[] = [
  { value: "none", label: "Not managed from People" },
  { value: "admin", label: "Admin of the Telegram groups" },
  { value: "member", label: "Team member" },
  { value: "lead", label: "Team Lead" },
];

function bindingOf(kind: Kind, team: string) {
  if (kind === "none") return null;
  if (kind === "admin") return "admin";
  return `team:${team.trim().toLowerCase()}:${kind}`;
}

/**
 * What holding this role means in the admin dashboard's People register. A bound role is
 * listed there and can be given or taken back from People by whoever may change it.
 */
export function PeopleBindingCard({
  role,
  canEdit,
  problem,
}: {
  role: RoleSummary;
  canEdit: boolean;
  /** Why the role can't be bound, if it can't. */
  problem: string | null;
}) {
  const router = useRouter();
  const current = parsePeopleBinding(role.peopleBinding);
  const [kind, setKind] = useState<Kind>(
    current?.kind === "team" ? current.role : (current?.kind ?? "none"),
  );
  const [team, setTeam] = useState(current?.kind === "team" ? current.team : "");
  const [busy, setBusy] = useState(false);
  const next = bindingOf(kind, team);
  const teamMissing =
    (kind === "member" || kind === "lead") && !/^[a-z0-9-]{1,32}$/.test(team.trim().toLowerCase());

  async function save() {
    setBusy(true);
    try {
      await setRolePeopleBindingFn({ data: { roleId: role.id, binding: next } });
      await router.invalidate({ sync: true });
      toast.success(next ? "People now manages this role." : "People no longer manages this role.");
    } catch (cause) {
      toast.error(errorMessage(cause, "Unable to save."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>People register</CardTitle>
        <CardDescription>
          Holders of a role managed from People appear in the admin dashboard's People register.
          Whoever may change that part of the register there can give or take back the role, never
          to themselves, and never beyond the permissions they hold.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!canEdit ? (
          <p className="text-sm leading-6 text-muted-foreground">
            {KINDS.find((entry) => entry.value === kind)?.label}
            {(kind === "member" || kind === "lead") && ` of team ${team}`}. Only Master Admin can
            change this.
          </p>
        ) : problem && !current ? (
          <p className="text-sm leading-6 text-muted-foreground">{problem}</p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="people-binding-kind" label="In People, holders are">
                <Select value={kind} onValueChange={(value) => setKind(value as Kind)}>
                  <SelectTrigger id="people-binding-kind" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KINDS.map((entry) => (
                      <SelectItem key={entry.value} value={entry.value}>
                        {entry.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {(kind === "member" || kind === "lead") && (
                <Field
                  id="people-binding-team"
                  label="Team key"
                  hint="As in the admin dashboard: it, hr, design, intl or events."
                  error={team && teamMissing ? "Use lowercase letters, digits and -." : undefined}
                >
                  <Input
                    id="people-binding-team"
                    value={team}
                    onChange={(event) => setTeam(event.target.value)}
                    className="font-mono"
                  />
                </Field>
              )}
            </div>
            <Button
              disabled={busy || teamMissing || next === role.peopleBinding}
              onClick={() => void save()}
            >
              Save
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
