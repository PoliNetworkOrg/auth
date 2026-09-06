import { useState } from "react";
import { Button } from "./ui/button";

type LinkedAccount = { id: string; accountId: string };

type Props = {
  configured: boolean;
  signedIn: boolean;
  linkedAccount?: LinkedAccount;
  canUnlink: boolean;
  onChanged: () => void;
  onUnlink: (accountId: string) => Promise<void>;
};

export function StudentVerificationForm({
  configured,
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
    <section className="rounded-xl border border-slate-200 p-6">
      <h2 className="text-xl font-semibold">Politecnico di Milano</h2>
      <p className="mt-2 text-slate-600">
        Verify your student status with a code sent to your @mail.polimi.it address.
      </p>
      {!signedIn ? (
        <p className="mt-4 text-sm text-slate-600">
          Sign in with Google or PoliNetwork before connecting your student email.
        </p>
      ) : (
        <div className="mt-4 grid max-w-md gap-3">
          <label htmlFor="student-email" className="text-sm font-medium">
            University email
          </label>
          <input
            id="student-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@mail.polimi.it"
            disabled={busy}
            className="rounded-lg border border-slate-300 px-3 py-2"
          />
          {codeSent && (
            <>
              <label htmlFor="student-code" className="text-sm font-medium">
                Verification code
              </label>
              <input
                id="student-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                placeholder="123456"
                disabled={busy}
                className="rounded-lg border border-slate-300 px-3 py-2 tracking-widest"
              />
            </>
          )}
          {message && (
            <p role="status" className="text-sm text-green-700">
              {message}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <div>
            <button
              disabled={busy || !configured || !email || (codeSent && code.length !== 6)}
              onClick={() => void submit(codeSent ? "confirm" : "request")}
              className="rounded-lg bg-blue-700 px-4 py-2 text-white disabled:opacity-40"
            >
              {!configured ? "Not configured" : codeSent ? "Verify code" : "Send code"}
            </button>
            {codeSent && (
              <button
                disabled={busy}
                onClick={() => void submit("request")}
                className="ml-4 underline disabled:opacity-40"
              >
                Send another code
              </button>
            )}
            {linkedAccount && (
              <Button
                variant="destructive"
                disabled={busy || !canUnlink}
                onClick={() => void onUnlink(linkedAccount.id)}
                className="ml-4"
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
