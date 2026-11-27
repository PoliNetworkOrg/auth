# Security policy

PoliNetwork Auth is the identity provider behind PoliNetwork's services: a flaw here can let
someone sign in as another person or gain permissions they were never given. Reports are
welcome and are handled before any other work.

## Reporting a vulnerability

Report it privately through GitHub: open the repository's **Security** tab and choose
**Report a vulnerability**. Only the maintainers can read the report, and the fix is
discussed and prepared in a private advisory.

Do not open a public issue, pull request or discussion for a vulnerability, and do not
mention it in other PoliNetwork channels until a fix is released.

A useful report says:

- what an attacker can do, and what they need first (an account, a role, a client, nothing);
- the steps or requests that show it, against a local instance (`vp run dev:setup`);
- the commit or deployed version you tested.

## Scope

In scope: this repository's code and its deployment at `auth.polinetwork.org`, including
sign-in and account linking, OpenID Connect and OAuth endpoints, tokens and keys, roles and
permissions, the admin pages, and the MCP server.

Out of scope: vulnerabilities in a dependency that this app does not use in a way that
exposes them (report those upstream), denial of service by sheer request volume, and
findings that need a compromised device or an already-compromised administrator account.

## Testing

Test against your own local instance. Do not run automated scanners against
`auth.polinetwork.org`, and never access, change or delete other people's data; if you
reach some by accident, stop and say so in your report.

## Supported versions

Fixes land on `main` and ship in the next published container image. Older images are not
patched.
