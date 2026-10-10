import { useRouter } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { cn } from "cn";
import { BadgeCheck, Link2, Unlink } from "lucide-react";
import { toast } from "sonner";
import {
  confirmStudentVerificationFn,
  requestStudentVerificationFn,
  type AccountDetails,
} from "@/auth/account.functions";
import { isLoginProvider } from "@/auth/policy";
import type { ProviderCapabilities } from "@/auth/session.functions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/action-error";
import { Email } from "./email";
import { Spinner } from "./panel";
import type { AccountActions } from "./use-account-actions";

function BrandMark({ name, className }: { name: string; className?: string }) {
  return (
    <img
      src={`/brands/${name}.svg`}
      alt=""
      width={56}
      height={56}
      draggable={false}
      className={cn("size-14", className)}
    />
  );
}

const cardButton = "h-10 w-full transition-[scale,background-color,color] active:scale-[0.97]";

function LinkAction({
  icon,
  label,
  busy,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button className={cardButton} disabled={disabled} onClick={onClick}>
      {busy ? <Spinner /> : icon}
      {label}
    </Button>
  );
}

function UnlinkAction({
  busy,
  disabled,
  reason,
  onClick,
}: {
  busy: boolean;
  disabled: boolean;
  /** Why it is disabled, on hover. A disabled button gets no pointer events, so it sits on a wrapper. */
  reason?: string;
  onClick: () => void;
}) {
  return (
    <span title={reason} className="block">
      <Button
        variant="destructive-soft"
        className={cardButton}
        disabled={disabled}
        onClick={onClick}
      >
        {busy ? <Spinner /> : <Unlink />}
        Unlink
      </Button>
    </span>
  );
}

/** One linkable account: its logo, what it's linked to, and the one thing to do with it. */
function AccountCard({
  mark,
  name,
  linked,
  detail,
  action,
}: {
  mark: ReactNode;
  name: string;
  linked: boolean;
  detail: ReactNode;
  action: ReactNode;
}) {
  return (
    <article
      className={cn(
        "relative flex min-w-0 flex-col items-center rounded-2xl border bg-card px-5 pt-7 pb-5 text-center",
        !linked && "border-dashed",
      )}
    >
      <div className="flex h-14 items-center">{mark}</div>
      <h3 className="mt-4 text-base font-semibold tracking-tight">{name}</h3>
      <p
        className={cn(
          "mt-1 min-h-10 w-full text-[13px] leading-5 text-balance [overflow-wrap:anywhere]",
          linked ? "text-primary" : "text-muted-foreground",
        )}
      >
        {detail}
      </p>
      <div className="mt-auto w-full pt-5">{action}</div>
    </article>
  );
}

function CardGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid min-w-0 grid-rows-[auto_1fr] gap-3">
      <h2 className="px-1 text-lg font-semibold tracking-tight">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">{children}</div>
    </section>
  );
}

const LOGINS = [
  { id: "google", name: "Google", mark: "google" },
  { id: "pn-entra", name: "PoliNetwork", mark: "polinetwork" },
] as const;

/** The two ways to sign in, then the two accounts that prove who you are elsewhere. */
export function AccountCards({
  details,
  providers,
  actions,
}: {
  details: AccountDetails;
  providers: ProviderCapabilities;
  actions: AccountActions;
}) {
  const [verifying, setVerifying] = useState(false);
  const { accounts, identity } = details;
  const locked = actions.busy !== null;
  const linkedTo = (providerId: string) =>
    accounts.find((entry) => entry.providerId === providerId);
  const loginCount = accounts.filter((entry) => isLoginProvider(entry.providerId)).length;
  const telegram = linkedTo("telegram");
  const student = linkedTo("polimi-email");
  const studentVerified = !!student && identity.states.includes("student");
  const studentConfigured = providers.link.includes("polimi-email");

  return (
    <div className="grid gap-8 lg:grid-cols-2 lg:gap-6">
      <CardGroup title="Sign in with">
        {LOGINS.map((login) => {
          const linked = linkedTo(login.id);
          const onlyWay = !!linked && loginCount < 2;
          const available = providers.signIn.includes(login.id);
          const email = linked ? details.emails[login.id] : null;
          return (
            <AccountCard
              key={login.id}
              mark={<BrandMark name={login.mark} />}
              name={login.name}
              linked={!!linked}
              detail={email ? <Email address={email} /> : null}
              action={
                linked ? (
                  <UnlinkAction
                    busy={actions.busy === linked.id}
                    disabled={locked || onlyWay}
                    reason={onlyWay ? "Link another account first" : undefined}
                    onClick={() => void actions.unlink(linked.id)}
                  />
                ) : (
                  <LinkAction
                    icon={<Link2 />}
                    label={available ? "Link" : "Unavailable"}
                    busy={actions.busy === login.id}
                    disabled={locked || !available}
                    onClick={() => void actions.link(login.id)}
                  />
                )
              }
            />
          );
        })}
      </CardGroup>

      <CardGroup title="Connected accounts">
        <AccountCard
          // The seal is drawn in white only, so in light mode it sits on a navy disc.
          mark={
            <span className="flex size-14 items-center justify-center rounded-full bg-[#1f3a68] dark:bg-transparent">
              <BrandMark name="polimi" className="scale-90 dark:scale-100" />
            </span>
          }
          name="PoliMi"
          linked={studentVerified}
          detail={studentVerified ? <Email address={student.accountId} /> : null}
          action={
            studentVerified ? (
              <UnlinkAction
                busy={actions.busy === student.id}
                disabled={locked}
                onClick={() => void actions.unlink(student.id)}
              />
            ) : (
              <LinkAction
                icon={<BadgeCheck />}
                label={studentConfigured ? "Verify" : "Unavailable"}
                busy={false}
                disabled={locked || !studentConfigured}
                onClick={() => setVerifying(true)}
              />
            )
          }
        />
        <AccountCard
          mark={<BrandMark name="telegram" />}
          name="Telegram"
          linked={!!telegram}
          detail={
            telegram
              ? [
                  details.telegramUsername && `@${details.telegramUsername}`,
                  `ID ${identity.telegramId ?? telegram.accountId}`,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : null
          }
          action={
            telegram ? (
              <UnlinkAction
                busy={actions.busy === telegram.id}
                disabled={locked}
                onClick={() => void actions.unlink(telegram.id)}
              />
            ) : (
              <LinkAction
                icon={<Link2 />}
                label={providers.link.includes("telegram") ? "Link" : "Unavailable"}
                busy={actions.busy === "telegram"}
                disabled={locked || !providers.link.includes("telegram")}
                onClick={() => void actions.link("telegram")}
              />
            )
          }
        />
      </CardGroup>

      <Dialog open={verifying} onOpenChange={setVerifying}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Verify your student status</DialogTitle>
          </DialogHeader>
          <StudentVerification onDone={() => setVerifying(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Address, then the six-digit code sent to it. */
function StudentVerification({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      if (!sent) {
        await requestStudentVerificationFn({ data: { email } });
        setSent(true);
      } else {
        await confirmStudentVerificationFn({ data: { email, code } });
        // Shows the linked address and the student status before the dialog closes.
        await router.invalidate({ sync: true });
        toast.success("Your student status is verified.");
        onDone();
      }
    } catch (cause) {
      toast.error(errorMessage(cause, "Student verification failed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label htmlFor="student-verification" className="text-sm font-medium">
        {sent ? `Code sent to ${email}` : "Your @mail.polimi.it address"}
      </label>
      <div className="flex flex-wrap gap-2">
        {sent ? (
          <Input
            key="code"
            id="student-verification"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6-digit code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            disabled={busy}
            className="h-10 min-w-0 flex-1 basis-48 text-base sm:text-sm"
          />
        ) : (
          <Input
            key="email"
            id="student-verification"
            type="email"
            autoComplete="email"
            spellCheck={false}
            placeholder="name.surname@mail.polimi.it"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
            className="h-10 min-w-0 flex-1 basis-48 text-base sm:text-sm"
          />
        )}
        <Button type="submit" className="h-10 active:scale-[0.97]" disabled={busy}>
          {busy && <Spinner />}
          {sent ? "Verify" : "Send code"}
        </Button>
      </div>
    </form>
  );
}
