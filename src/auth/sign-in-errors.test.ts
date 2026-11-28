import { describe, expect, it } from "vite-plus/test";
import {
  accountInUseAdvice,
  authorizationRequestOf,
  clientErrorFor,
  clientErrorUrl,
  describeError,
  errorCode,
  errorKind,
  isRegisteredRedirect,
  REFUSAL_CODES,
  responseModeOf,
  routeCallback,
  signedQueryExpiry,
} from "./sign-in-errors";

const issuer = "https://auth.polinetwork.org/api/auth";
const errorPage = "https://auth.polinetwork.org/error";
const dashboard = {
  redirectUri: "https://admin.polinetwork.org/auth/callback",
  state: "s-123",
  responseMode: "query" as const,
};

describe("describeError", () => {
  it.each([
    ["access_denied", "You cancelled signing in"],
    ["user_cancelled", "You cancelled signing in"],
    [REFUSAL_CODES.entraGuest, "This account can't use PoliNetwork APS"],
    ["TELEGRAM_LINK_ONLY", "Telegram can't be used to sign in"],
    ["unable_to_get_user_info", "We couldn't verify your account"],
    [
      "account_already_linked_to_different_user",
      "This account belongs to another PoliNetwork account",
    ],
    ["login_required", "This sign-in expired"],
    ["state_mismatch", "This sign-in couldn't be completed"],
    ["too_many_requests", "Too many attempts"],
    ["invalid_client", "This application can't sign you in"],
    ["invalid_redirect", "This application can't sign you in"],
    ["invalid_code", "Something went wrong"],
    ["something_new", "Something went wrong"],
  ])("%s → %s", (code, title) => {
    expect(describeError(code).title).toBe(title);
  });

  it("tells a guest to use Google", () => {
    expect(describeError(REFUSAL_CODES.entraGuest).message).toContain("Use Google instead");
  });

  it("names the provider when it knows it", () => {
    expect(
      describeError("account_already_linked_to_different_user", { provider: "google" }).title,
    ).toBe("This Google account belongs to another PoliNetwork account");
    expect(describeError("state_mismatch", { provider: "pn-entra" }).message).toContain(
      "with PoliNetwork APS",
    );
    expect(describeError("state_mismatch", { provider: "evil" }).message).not.toContain("evil");
  });

  it("says how long to wait", () => {
    expect(describeError("too_many_requests", { retryAfter: 42 }).message).toBe(
      "Wait 42 seconds, then try again.",
    );
    expect(describeError("too_many_requests", { retryAfter: 1 }).message).toContain("1 second,");
    expect(describeError("too_many_requests").message).toContain("a minute");
  });

  it("shows the code for support, except for a plain cancel", () => {
    expect(describeError("access_denied").showCode).toBe(false);
    expect(describeError("invalid_code").showCode).toBe(true);
    expect(describeError(REFUSAL_CODES.entraGuest).showCode).toBe(true);
  });

  it("doesn't treat inherited names as codes", () => {
    expect(errorKind("toString")).toBe("failed");
    expect(errorKind("__proto__")).toBe("failed");
  });
});

describe("errorCode", () => {
  it("keeps codes from Better Auth, the provider plugin and our providers", () => {
    for (const code of [
      "access_denied",
      "unable_to_get_user_info",
      "TELEGRAM_LINK_ONLY",
      REFUSAL_CODES.entraGuest,
      "invalid-code",
    ])
      expect(errorCode(code)).toBe(code);
  });

  it("turns anything else from the URL into unknown, so the page never shows it", () => {
    expect(errorCode(undefined)).toBe("unknown");
    expect(errorCode("")).toBe("unknown");
    expect(errorCode("Your account is locked. Call +39 000 0000")).toBe("unknown");
    expect(errorCode("<b>x</b>")).toBe("unknown");
    expect(errorCode("a".repeat(65))).toBe("unknown");
  });
});

describe("clientErrorFor", () => {
  it("is access_denied for a cancel or a refusal, login_required on expiry, else server_error", () => {
    expect(clientErrorFor("access_denied").error).toBe("access_denied");
    expect(clientErrorFor(REFUSAL_CODES.entraGuest).error).toBe("access_denied");
    expect(clientErrorFor("account_already_linked_to_different_user").error).toBe("access_denied");
    expect(clientErrorFor("login_required").error).toBe("login_required");
    expect(clientErrorFor("invalid_code").error).toBe("server_error");
    expect(clientErrorFor("state_mismatch").error).toBe("server_error");
  });
});

describe("clientErrorUrl", () => {
  const error = { error: "access_denied", description: "The person cancelled signing in." };

  it("adds error, description, state and iss to the query", () => {
    const url = new URL(clientErrorUrl(dashboard, error, issuer));
    expect(url.origin + url.pathname).toBe(dashboard.redirectUri);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      error: "access_denied",
      error_description: "The person cancelled signing in.",
      state: "s-123",
      iss: issuer,
    });
  });

  it("keeps a query the redirect URI already has", () => {
    const url = new URL(
      clientErrorUrl(
        { ...dashboard, redirectUri: `${dashboard.redirectUri}?tenant=a` },
        error,
        issuer,
      ),
    );
    expect(url.searchParams.get("tenant")).toBe("a");
    expect(url.searchParams.get("error")).toBe("access_denied");
  });

  it("uses the fragment when the request asked for it, and leaves out a missing state", () => {
    const url = new URL(
      clientErrorUrl({ ...dashboard, state: undefined, responseMode: "fragment" }, error, issuer),
    );
    expect(url.search).toBe("");
    const params = new URLSearchParams(url.hash.slice(1));
    expect(params.get("error")).toBe("access_denied");
    expect(params.has("state")).toBe(false);
  });
});

describe("responseModeOf", () => {
  it("follows response_mode, then the response type", () => {
    expect(responseModeOf(new URLSearchParams("response_type=code"))).toBe("query");
    expect(responseModeOf(new URLSearchParams("response_type=code&response_mode=fragment"))).toBe(
      "fragment",
    );
    expect(responseModeOf(new URLSearchParams("response_type=id_token"))).toBe("fragment");
    expect(responseModeOf(new URLSearchParams("response_mode=form_post"))).toBe("query");
  });
});

describe("isRegisteredRedirect", () => {
  it("matches exactly", () => {
    expect(isRegisteredRedirect([dashboard.redirectUri], dashboard.redirectUri)).toBe(true);
    expect(isRegisteredRedirect([dashboard.redirectUri], `${dashboard.redirectUri}/`)).toBe(false);
    expect(
      isRegisteredRedirect([dashboard.redirectUri], "https://evil.example/auth/callback"),
    ).toBe(false);
    expect(isRegisteredRedirect([dashboard.redirectUri], "not a url")).toBe(false);
  });

  it("lets a loopback IP change port, but not a DNS name", () => {
    expect(isRegisteredRedirect(["http://127.0.0.1:3000/cb"], "http://127.0.0.1:51234/cb")).toBe(
      true,
    );
    expect(isRegisteredRedirect(["http://[::1]:3000/cb"], "http://[::1]:4000/cb")).toBe(true);
    expect(isRegisteredRedirect(["http://localhost:3000/cb"], "http://localhost:4000/cb")).toBe(
      false,
    );
    expect(isRegisteredRedirect(["http://127.0.0.1:3000/cb"], "http://127.0.0.1:4000/other")).toBe(
      false,
    );
  });
});

describe("authorizationRequestOf", () => {
  it("drops what the provider plugin added when it signed the request", () => {
    const signed = new URLSearchParams(
      "client_id=c&redirect_uri=r&state=s&exp=1&sig=x&ba_iat=2&ba_pl=3&ba_param=client_id&ba_param=exp",
    );
    expect(authorizationRequestOf(signed).toString()).toBe("client_id=c&redirect_uri=r&state=s");
  });
});

describe("signedQueryExpiry", () => {
  it("reads exp from a signed query only", () => {
    expect(signedQueryExpiry("?client_id=c&exp=1700000000&sig=x")).toBe(1_700_000_000_000);
    expect(signedQueryExpiry("?client_id=c&exp=1700000000")).toBeNull();
    expect(signedQueryExpiry("?sig=x&exp=soon")).toBeNull();
  });
});

describe("routeCallback", () => {
  const base = { errorPage, refusal: null, provider: "google", client: dashboard, issuer };

  it("sends a cancel inside an application straight back to it", () => {
    const route = routeCallback({
      ...base,
      location: `${errorPage}?error=access_denied&error_description=x`,
    });
    expect(route?.to).toBe("client");
    const url = new URL(route?.to === "client" ? route.url : "");
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe("s-123");
    expect(url.searchParams.get("iss")).toBe(issuer);
  });

  it("explains a refused guest on Auth first, with the application", () => {
    expect(
      routeCallback({
        ...base,
        provider: "pn-entra",
        refusal: REFUSAL_CODES.entraGuest,
        location: `${errorPage}?error=unable_to_get_user_info`,
      }),
    ).toEqual({ to: "page", code: REFUSAL_CODES.entraGuest, provider: "pn-entra", withApp: true });
  });

  it("keeps Better Auth's code when no refusal was recorded", () => {
    expect(
      routeCallback({ ...base, location: `${errorPage}?error=unable_to_get_user_info` }),
    ).toMatchObject({ to: "page", code: "unable_to_get_user_info" });
  });

  it("shows other failures on Auth, with the application to go back to", () => {
    expect(routeCallback({ ...base, location: `${errorPage}?error=invalid_code` })).toEqual({
      to: "page",
      code: "invalid_code",
      provider: "google",
      withApp: true,
    });
  });

  it("shows a cancel outside an application on Auth", () => {
    expect(
      routeCallback({ ...base, client: null, location: `${errorPage}?error=access_denied` }),
    ).toEqual({ to: "page", code: "access_denied", provider: "google", withApp: false });
  });

  it("leaves errors bound for another page alone, like /link's", () => {
    for (const location of [
      "/link?method=telegram&result=failed&error=access_denied",
      "https://auth.polinetwork.org/?error=access_denied",
      "https://evil.example/error?error=access_denied",
      "/",
    ])
      expect(routeCallback({ ...base, location }), location).toBeNull();
  });
});

describe("accountInUseAdvice", () => {
  it("offers unlinking Telegram, which is never an account's only login", () => {
    expect(accountInUseAdvice("telegram")).toContain("unlink Telegram from it");
  });

  it("points to IT for a login that may be the other account's only one", () => {
    for (const provider of ["google", "pn-entra", undefined]) {
      const advice = accountInUseAdvice(provider);
      expect(advice).toContain("If that account has another way to sign in");
      expect(advice).toContain("ask the IT team");
    }
    expect(accountInUseAdvice("google")).toContain("unlink Google there");
  });
});
