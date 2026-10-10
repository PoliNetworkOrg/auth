import { createHash } from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import { hashClientSecret, issueClientSecret } from "./client-secret";

describe("client secrets", () => {
  it("stores the unpadded base64url SHA-256 digest the provider verifies against", () => {
    expect(hashClientSecret("abc")).toBe("ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");
  });

  it("issues 32 random letters, as the provider's rotation does, and stores only their hash", () => {
    const first = issueClientSecret();
    expect(first.secret).toMatch(/^[A-Za-z]{32}$/);
    expect(first.stored).toBe(createHash("sha256").update(first.secret).digest("base64url"));
    expect(first.stored).not.toContain(first.secret);
    expect(issueClientSecret().secret).not.toBe(first.secret);
  });
});
