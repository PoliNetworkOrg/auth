import { useState } from "react";
import { Check, GraduationCap, Unlink } from "lucide-react";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Button } from "./ui/button";

type LinkedAccount = { id: string; accountId: string };

type Props = {
  configured: boolean;
  verified: boolean;
  signedIn: boolean;
  linkedAccount?: LinkedAccount;
  canUnlink: boolean;
  onChanged: () => void;
  onUnlink: (accountId: string) => Promise<void>;
};

export function StudentVerificationForm({
  configured,
  verified,
  signedIn,
  linkedAccount,
  canUnlink,
  onChanged,
  onUnlink,
}: Props) {
  const [email, setEmail] = useState(linkedAccount?.accountId ?? "");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(action: "request" | "confirm") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/student-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, email, code }),
      });
      const result: { error?: string } = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Student verification failed.");
      if (action === "request") {
        setCodeSent(true);
        setMessage("We sent a six-digit code to your university email.");
      } else {
        setCode("");
        setCodeSent(false);
        setMessage("Your student status is verified.");
        onChanged();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Student verification failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="mb-4 flex items-start gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border bg-background text-primary">
          <GraduationCap className="size-5" aria-hidden="true" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">Politecnico di Milano</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Verify your student status with a code sent to your @mail.polimi.it address.
          </p>
        </div>
      </div>
      {!signedIn ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Sign in with Google or PoliNetwork before connecting your student email.
        </p>
      ) : linkedAccount && verified ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/50 p-4">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
              <Check className="size-3.5" />
              Student verified
            </p>
            <p className="mt-1 break-all text-sm">{linkedAccount.accountId}</p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            disabled={busy || !canUnlink}
            onClick={() => void onUnlink(linkedAccount.id)}
          >
            <Unlink />
            Unlink
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 rounded-xl bg-muted/50 p-4">
          <Label htmlFor="student-email" className="text-sm font-medium">
            University email
          </Label>
          <Input
            id="student-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@mail.polimi.it"
            disabled={busy}
            className="bg-card"
          />
          {codeSent && (
            <>
              <Label htmlFor="student-code" className="text-sm font-medium">
                Verification code
              </Label>
              <Input
                id="student-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                placeholder="123456"
                disabled={busy}
                className="bg-card tracking-widest"
              />
            </>
          )}
          {message && (
            <p role="status" className="text-sm text-primary">
              {message}
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="text-sm text-destructive-foreground bg-destructive rounded-lg p-3"
            >
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || !configured || !email || (codeSent && code.length !== 6)}
              onClick={() => void submit(codeSent ? "confirm" : "request")}
            >
              {!configured ? "Not configured" : codeSent ? "Verify code" : "Send code"}
            </Button>
            {codeSent && (
              <Button disabled={busy} onClick={() => void submit("request")} variant="ghost">
                Send another code
              </Button>
            )}
            {linkedAccount && (
              <Button
                variant="destructive"
                disabled={busy || !canUnlink}
                onClick={() => void onUnlink(linkedAccount.id)}
              >
                Unlink
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
