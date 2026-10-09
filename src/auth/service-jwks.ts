import { calculateJwkThumbprint, importJWK, type JWK } from "jose";
import type { db } from "../db";
import { oauthClient } from "../db/schema";

type Reader = Pick<typeof db, "select">;
export type PublicJwks = { keys: Record<string, unknown>[] };

export class ServiceJwksError extends Error {
  constructor(
    readonly status: 400 | 409,
    message: string,
  ) {
    super(message);
  }
}

/** Accept the two asymmetric algorithms in the migration recipe and reject reused keys. */
export async function validateServiceJwks(
  jwks: PublicJwks,
  reader: Reader,
  excludeClientId?: string,
) {
  const thumbprints: string[] = [];
  for (const key of jwks.keys) {
    if (["d", "p", "q", "dp", "dq", "qi", "oth", "k"].some((field) => field in key))
      throw new ServiceJwksError(400, "Only public keys may be registered.");
    const algorithm =
      key.kty === "OKP" && key.crv === "Ed25519"
        ? "EdDSA"
        : key.kty === "EC" && key.crv === "P-256"
          ? "ES256"
          : null;
    if (!algorithm || (key.alg !== undefined && key.alg !== algorithm))
      throw new ServiceJwksError(400, "Use an Ed25519 or P-256 public signing key.");
    try {
      await importJWK(key as JWK, algorithm);
      thumbprints.push(await calculateJwkThumbprint(key as JWK));
    } catch {
      throw new ServiceJwksError(400, "The public JWKS is invalid.");
    }
  }
  if (new Set(thumbprints).size !== thumbprints.length)
    throw new ServiceJwksError(400, "The JWKS contains the same key twice.");
  const registered = await reader
    .select({ clientId: oauthClient.clientId, jwks: oauthClient.jwks })
    .from(oauthClient);
  for (const row of registered) {
    if (!row.jwks || row.clientId === excludeClientId) continue;
    let existing: { keys?: JWK[] };
    try {
      existing = JSON.parse(row.jwks) as { keys?: JWK[] };
    } catch {
      continue;
    }
    for (const key of existing.keys ?? []) {
      try {
        if (thumbprints.includes(await calculateJwkThumbprint(key)))
          throw new ServiceJwksError(409, "This public key already belongs to another client.");
      } catch (error) {
        if (error instanceof ServiceJwksError) throw error;
      }
    }
  }
  return jwks;
}
