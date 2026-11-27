import { getOAuthState } from "better-auth/api";

/**
 * Why a provider refused an account during this callback. Better Auth only reports a refusal
 * as `unable_to_get_user_info`; this keeps our own reason for the error page. Keyed by the
 * callback's OAuth state, which lives exactly as long as the request.
 */
const refusals = new WeakMap<object, string>();

export async function recordRefusal(code: string) {
  const state = await getOAuthState();
  if (state) refusals.set(state, code);
}

export async function readRefusal() {
  const state = await getOAuthState();
  return state ? (refusals.get(state) ?? null) : null;
}

/** An account a provider won't accept, with the code `/error` explains it by. */
export class AccountRefused extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AccountRefused";
  }
}
