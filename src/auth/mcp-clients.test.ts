import { describe, expect, it } from "vite-plus/test";
import {
  MCP_CLIENT_SCOPES,
  checkMcpRegistration,
  isLoopbackRedirect,
  mcpSetupCommands,
  narrowMcpScope,
} from "./mcp-clients";
import { describeScope } from "./oidc-clients";

// What Claude Code and Codex actually send when they register themselves.
const claudeCode = {
  client_name: "Claude Code (polinetwork-auth)",
  redirect_uris: ["http://localhost:51234/callback"],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
};
const codex = {
  client_name: "Codex",
  redirect_uris: ["http://127.0.0.1:41234/callback"],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
  scope: "openid profile email polinetwork:identity offline_access idp:mcp",
  application_type: "native",
};

describe("MCP agent registration", () => {
  it("accepts the agents' own registrations", () => {
    expect(checkMcpRegistration(claudeCode)).toEqual({
      problem: null,
      // Better Auth would read the missing type as web, which refuses loopback redirects.
      applicationType: "native",
      scope: MCP_CLIENT_SCOPES.join(" "),
    });
    expect(checkMcpRegistration(codex)).toEqual({
      problem: null,
      applicationType: "native",
      // Agents ask for every scope the server lists; they get the ones they may have.
      scope: "offline_access idp:mcp",
    });
  });

  it("accepts hosted agents' exact callbacks as web clients", () => {
    const hosted = checkMcpRegistration({
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      token_endpoint_auth_method: "client_secret_post",
    });
    expect(hosted).toMatchObject({ problem: null, applicationType: "web" });
    const vscode = checkMcpRegistration({
      redirect_uris: ["https://vscode.dev/redirect", "http://127.0.0.1:33418/"],
      token_endpoint_auth_method: "none",
    });
    expect(vscode).toMatchObject({ problem: null, applicationType: "native" });
  });

  it("refuses redirects that would send the code to someone else's machine", () => {
    for (const uri of [
      "https://evil.example/callback",
      "https://claude.ai/api/mcp/auth_callback/../../evil",
      "https://claude.ai.evil.example/api/mcp/auth_callback",
      "http://192.168.1.10/callback",
      "http://localhost.evil.example/callback",
      "https://localhost/callback",
      "cursor://anysphere.cursor-mcp/oauth/callback",
    ])
      expect(checkMcpRegistration({ ...claudeCode, redirect_uris: [uri] }).problem).toMatch(
        /may only redirect/,
      );
    expect(
      checkMcpRegistration({
        ...claudeCode,
        redirect_uris: ["http://localhost:1/cb", "https://evil.example/cb"],
      }).problem,
    ).toMatch(/may only redirect/);
  });

  it("refuses everything an agent does not need", () => {
    expect(checkMcpRegistration({ ...claudeCode, redirect_uris: [] }).problem).toBeTruthy();
    expect(checkMcpRegistration({ token_endpoint_auth_method: "none" }).problem).toBeTruthy();
    expect(
      checkMcpRegistration({ ...claudeCode, grant_types: ["client_credentials"] }).problem,
    ).toMatch(/authorization code/);
    expect(checkMcpRegistration({ ...claudeCode, grant_types: ["refresh_token"] }).problem).toMatch(
      /authorization code/,
    );
    expect(
      checkMcpRegistration({ ...claudeCode, token_endpoint_auth_method: "private_key_jwt" })
        .problem,
    ).toMatch(/secret or as public/);
    expect(
      checkMcpRegistration({ ...claudeCode, jwks_uri: "https://evil.example/jwks" }).problem,
    ).toMatch(/keys/);
    expect(checkMcpRegistration({ ...claudeCode, application_type: "web" }).problem).toMatch(
      /native/,
    );
  });
});

describe("MCP scopes", () => {
  it("keeps only what an agent may have", () => {
    expect(narrowMcpScope("openid profile idp:mcp offline_access", MCP_CLIENT_SCOPES)).toBe(
      "idp:mcp offline_access",
    );
    expect(narrowMcpScope("idp:mcp idp:mcp", MCP_CLIENT_SCOPES)).toBe("idp:mcp");
    // Without openid an agent gets no ID token and cannot read UserInfo.
    expect(narrowMcpScope("openid profile email", MCP_CLIENT_SCOPES)).toBeNull();
    expect(narrowMcpScope(undefined, MCP_CLIENT_SCOPES)).toBeNull();
  });

  it("explains the MCP scope on the consent page", () => {
    expect(describeScope("idp:mcp").label).not.toBe("idp:mcp");
  });
});

describe("loopback redirects", () => {
  it("matches the exact loopback hosts over http on any port", () => {
    expect(isLoopbackRedirect("http://localhost:3000/callback")).toBe(true);
    expect(isLoopbackRedirect("http://127.0.0.1/callback")).toBe(true);
    expect(isLoopbackRedirect("http://[::1]:8080/callback")).toBe(true);
    expect(isLoopbackRedirect("http://127.0.0.2/callback")).toBe(false);
    expect(isLoopbackRedirect("http://user:pw@localhost/callback")).toBe(false);
    expect(isLoopbackRedirect("http://localhost/callback#x")).toBe(false);
    expect(isLoopbackRedirect("not a url")).toBe(false);
  });
});

describe("setup commands", () => {
  it("names the server URL in every command", () => {
    const url = "https://auth.polinetwork.org/api/mcp";
    const commands = mcpSetupCommands(url);
    expect(commands.map((entry) => entry.id)).toEqual(["claude", "codex", "gemini", "vscode"]);
    for (const entry of commands) expect(entry.command).toContain(url);
  });
});
