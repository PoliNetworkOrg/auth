-- Signing keys without a stored algorithm are read as the configured default. That default
-- moves from EdDSA to RS256, and every key minted so far was Ed25519, so record it.
UPDATE jwks SET alg = 'EdDSA', crv = COALESCE(crv, 'Ed25519') WHERE alg IS NULL;
