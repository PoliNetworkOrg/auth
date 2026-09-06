import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { authClient } from "@/auth/client";

export const Route = createFileRoute("/consent")({ component: Consent });
function Consent() {
  const [request, setRequest] = useState<{
    clientId: string;
    scope: string;
    claims: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRequest({
      clientId: params.get("client_id") ?? "",
      scope: params.get("scope") ?? "",
      claims: params.get("claims") ?? "",
    });
  }, []);
  async function decide(accept: boolean) {
    setBusy(true);
    setError("");
    try {
      const result = await authClient.oauth2.consent({ accept });
      if (result.error) setError(result.error.message ?? "Unable to process consent.");
      else if (result.data?.url) window.location.assign(result.data.url);
    } catch {
      setError("Unable to process consent.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-3xl font-bold">Authorize application</h1>
      <p className="mt-6 break-all">Application ID: {request?.clientId}</p>
      <p className="mt-3">Requested access: {request?.scope}</p>
      {request?.claims && (
        <p className="mt-3 break-all">Requested profile fields: {request.claims}</p>
      )}
      <p className="mt-3">
        The polinetwork:identity scope shares your verified states, permissions, and linked Telegram
        ID.
      </p>
      {error && (
        <p role="alert" className="mt-4 text-red-700">
          {error}
        </p>
      )}
      <button
        disabled={busy || !request?.clientId}
        onClick={() => void decide(true)}
        className="mt-6 rounded bg-blue-700 px-5 py-2 text-white disabled:opacity-40"
      >
        Allow
      </button>
      <button
        disabled={busy || !request?.clientId}
        onClick={() => void decide(false)}
        className="ml-4 underline"
      >
        Deny
      </button>
    </main>
  );
}
