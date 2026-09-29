import type {
  OidcClientDraft,
  OidcClientDraftErrors,
  OidcClientSummary,
} from "@/auth/oidc-clients";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fields?: OidcClientDraftErrors,
  ) {
    super(message);
  }
}

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const details =
      body && typeof body === "object"
        ? (body as { error?: string; fields?: OidcClientDraftErrors })
        : {};
    throw new ApiError(details.error ?? fallback, response.status, details.fields);
  }
  return body as T;
}

export function fetchOidcClients(clientId?: string, signal?: AbortSignal) {
  const query = clientId ? `?client_id=${encodeURIComponent(clientId)}` : "";
  return fetch(`/api/oidc/clients${query}`, { signal }).then((response) =>
    readJson<OidcClientSummary[]>(response, "Unable to load applications."),
  );
}

export type OidcClientUpdate = {
  clientId: string;
  draft?: OidcClientDraft;
  disabled?: boolean;
  skipConsent?: boolean;
};

export function saveOidcClient(update: OidcClientUpdate) {
  return fetch("/api/oidc/client-update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  }).then((response) => readJson<OidcClientSummary>(response, "Unable to save the application."));
}

export function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
