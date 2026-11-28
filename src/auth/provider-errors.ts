import { getOAuthState } from "better-auth/api";

/**
 * Why one of our providers couldn't return an account during this callback. Better Auth reports
 * every such failure as `unable_to_get_user_info`, a refused guest and an unreachable key set
 * alike; this keeps our own code for the error page. Keyed by the callback's OAuth state, which
 * lives exactly as long as the request.
 */
const providerErrors = new WeakMap<object, string>();

export async function recordProviderError(code: string) {
  const state = await getOAuthState();
  if (state) providerErrors.set(state, code);
}

export async function readProviderError() {
  const state = await getOAuthState();
  return state ? (providerErrors.get(state) ?? null) : null;
}

/**
 * An account a provider deliberately won't accept, with the code `/error` explains it by.
 * Anything else a provider throws is a failure on our side or the provider's, not a refusal.
 */
export class AccountRefused extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AccountRefused";
  }
}
