/**
 * Reads a pasted public JWKS, with a message that says what to fix. The server checks the
 * same rules again; this only spares the person a generic "Invalid request.".
 */
export function publicJwks(input: string): { keys: Record<string, unknown>[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error("Paste a valid public JWKS JSON object.");
  }
  if (!parsed || typeof parsed !== "object" || !("keys" in parsed))
    throw new Error("The JWKS needs a keys array.");
  const keys = (parsed as { keys: unknown }).keys;
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > 5)
    throw new Error("The JWKS needs between one and five public keys.");
  for (const key of keys) {
    if (!key || typeof key !== "object") throw new Error("Each key must be an object.");
    if (["d", "p", "q", "dp", "dq", "qi", "oth", "k"].some((field) => field in key))
      throw new Error("Paste public keys only. Keep private keys in the service's Key Vault.");
  }
  return { keys: keys as Record<string, unknown>[] };
}
