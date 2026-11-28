import { constantTimeEqual, makeSignature } from "better-auth/crypto";
import { authorizationRequestOf } from "./sign-in-errors";

/**
 * Signed values that let `/error` and an expired sign-in page send someone back to the
 * application they came from without trusting anything in the URL. Each takes the auth secret,
 * so tests can run them without a server.
 */

/** Standard base64 in the base64url alphabet, without padding. */
function toBase64Url(value: string) {
  return value.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function canonical(params: URLSearchParams) {
  const sorted = [...params].sort(([keyA, valueA], [keyB, valueB]) =>
    keyA < keyB ? -1 : keyA > keyB ? 1 : valueA < valueB ? -1 : valueA > valueB ? 1 : 0,
  );
  return new URLSearchParams(sorted).toString();
}

/**
 * The authorization request behind a sign-in page's signed query, when the signature is the
 * provider plugin's own, whether or not it has expired. An expired query only has an old `exp`:
 * its client and redirect URI were checked when it was signed, so they can still be trusted to
 * send the person back with `login_required`.
 *
 * Mirrors the plugin's `buildSignedOAuthQuery` and `verifyOAuthQueryParams`, without the expiry.
 */
export async function verifySignedQueryIgnoringExpiry(search: string, secret: string) {
  const params = new URLSearchParams(search);
  const sigs = params.getAll("sig");
  const names = new Set(params.getAll("ba_param"));
  if (sigs.length !== 1 || !sigs[0] || !names.size) return null;
  const signed = new URLSearchParams();
  for (const [key, value] of params)
    if (key === "ba_param" || (key !== "sig" && names.has(key))) signed.append(key, value);
  const expected = await makeSignature(canonical(signed), secret);
  // Compared the way the plugin does: a `+` that became a space in the URL, or a signature
  // written in base64url, still verifies.
  if (!constantTimeEqual(toBase64Url(sigs[0].replace(/ /g, "+")), toBase64Url(expected)))
    return null;
  return authorizationRequestOf(signed);
}

/** How long `/error` can still send someone back: longer than any application keeps its state. */
export const APP_CONTEXT_TTL_SECONDS = 60 * 60;

const CONTEXT_PURPOSE = "pn-sign-in-error-context";

/**
 * A token for `/error` that carries the authorization request a failed sign-in belonged to.
 * It's opaque to the person and tamper-proof, and it expires after an hour.
 */
export async function signAppContext(
  request: URLSearchParams,
  secret: string,
  now = Date.now(),
): Promise<string> {
  const payload = Buffer.from(
    JSON.stringify({
      q: request.toString(),
      exp: Math.floor(now / 1000) + APP_CONTEXT_TTL_SECONDS,
    }),
  ).toString("base64url");
  const sig = await makeSignature(`${CONTEXT_PURPOSE}.${payload}`, secret);
  return `${payload}.${Buffer.from(sig, "base64").toString("base64url")}`;
}

/** The authorization request in a token from `signAppContext`, or null if it isn't valid. */
export async function readAppContext(token: string, secret: string, now = Date.now()) {
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  const expected = Buffer.from(
    await makeSignature(`${CONTEXT_PURPOSE}.${payload}`, secret),
    "base64",
  ).toString("base64url");
  if (!constantTimeEqual(sig, expected)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("q" in parsed) ||
    !("exp" in parsed) ||
    typeof parsed.q !== "string" ||
    typeof parsed.exp !== "number" ||
    parsed.exp * 1000 < now
  )
    return null;
  return new URLSearchParams(parsed.q);
}
