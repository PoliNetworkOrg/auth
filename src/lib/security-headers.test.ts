import { describe, expect, it } from "vite-plus/test";

import { securityHeaders, withSecurityHeaders } from "./security-headers";

describe("securityHeaders", () => {
  it("forbids framing and sniffing and sends HSTS on an https origin", () => {
    expect(
      Object.fromEntries(securityHeaders("https://auth.polinetwork.org", new Headers())),
    ).toEqual({
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    });
  });

  it("leaves HSTS out on an http origin", () => {
    const names = securityHeaders("http://localhost:3003", new Headers()).map(([name]) => name);
    expect(names).not.toContain("Strict-Transport-Security");
    expect(names).toContain("X-Frame-Options");
  });

  it("keeps a policy the response already has", () => {
    const existing = new Headers({ "Content-Security-Policy": "default-src 'none'" });
    const names = securityHeaders("https://auth.polinetwork.org", existing).map(([name]) => name);
    expect(names).not.toContain("Content-Security-Policy");
    expect(names).toContain("X-Frame-Options");
  });
});

describe("withSecurityHeaders", () => {
  it("adds the headers without touching the ones already there", () => {
    const response = new Response("{}", {
      headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
    });
    const result = withSecurityHeaders(response, "https://auth.polinetwork.org");
    expect(result.headers.get("X-Frame-Options")).toBe("DENY");
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect(result.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("copies a response whose headers cannot change", async () => {
    const response = Response.redirect("https://example.com/", 302);
    const result = withSecurityHeaders(response, "https://auth.polinetwork.org");
    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toBe("https://example.com/");
    expect(result.headers.get("X-Frame-Options")).toBe("DENY");
  });
});
