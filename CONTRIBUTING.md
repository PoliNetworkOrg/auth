# Contributing to PoliNetwork Auth

This guide gets a development environment ready for this repository, and then connects it to the
[backend](https://github.com/PoliNetworkOrg/backend) and the [admin dashboard](https://github.com/PoliNetworkOrg/admin)
so the three run together on your machine. The [README](README.md) explains how Auth works; read its
[Run locally](README.md#run-locally) section for the details behind the steps below.

## Prerequisites

- **Git**.
- **Docker** with Compose, for the local PostgreSQL database.
- **[Vite+](https://viteplus.dev/guide/)** (`vp`), which runs Node, pnpm and every project command here:

  ```sh
  curl -fsSL https://vite.plus | bash
  ```

  Open a new shell afterwards. The pnpm version comes from `devEngines` in `package.json` and is downloaded when needed.
  Production images use Node 22.

## Set up Auth on its own

```sh
git clone git@github.com:PoliNetworkOrg/auth.git
cd auth
vp install
cp .env.local.example .env.local
vp run dev:setup
vp run dev
```

- `vp run dev:setup` starts PostgreSQL with `compose.yaml` (on `localhost:55432`), applies the migrations and seeds four
  test personas plus 60 fake people. It refuses to run against anything but a local database.
- `vp run dev` serves Auth on **http://localhost:3003**. Pick a persona under **Dev sign-in** on the login page:
  **Ada Admin** is Master Admin and holds every permission.

No provider credentials (Google, Microsoft, Telegram) are needed: the personas cover sign-in. To try a real provider,
copy its variables from `.env.example` into `.env.local`.

## Everyday commands

| Command              | What it does                                                                  |
| -------------------- | ----------------------------------------------------------------------------- |
| `vp run dev`         | Development server on http://localhost:3003                                   |
| `vp run dev:db`      | Starts the local database again, e.g. after a reboot                          |
| `vp run dev:seed`    | Restores the personas and the fake people, updating them in place             |
| `vp run db:generate` | Generates a Drizzle migration after a change to `src/db/schema.ts`            |
| `vp run db:migrate`  | Applies the migrations to the database in `.env.local`                        |
| `vp check`           | Formatting, lint and type checks                                              |
| `vp test`            | Tests (integration suites are opt-in: see [Validation](README.md#validation)) |
| `vp run build`       | Production build                                                              |

Change the database only through migrations (`db:generate`, then `db:migrate`). `db:push` changes the schema without
recording a migration, so a later `db:migrate` fails on changes that already exist.

## Connect the local stack

The backend accepts only access tokens issued by Auth, and the admin dashboard signs people in through Auth. To work
on them with real data, run all three and register two applications in your local Auth. Do this once; the
[backend](https://github.com/PoliNetworkOrg/backend/blob/main/CONTRIBUTING.md) and
[admin](https://github.com/PoliNetworkOrg/admin/blob/main/CONTRIBUTING.md) guides link here.

| Service | URL                   | Its own services (Docker)                               |
| ------- | --------------------- | ------------------------------------------------------- |
| Auth    | http://localhost:3003 | PostgreSQL on 55432                                     |
| Backend | http://localhost:3000 | PostgreSQL on 55433, Redis on 56379                     |
| Admin   | http://localhost:3001 | Redis on 56380, for sessions only (never the backend's) |

### 1. Turn on the backend resources in Auth

Add to Auth's `.env.local`, then restart `vp run dev`:

```sh
OAUTH_BACKEND_RESOURCE_URI=https://backend.internal.polinetwork.org
OAUTH_INTERNAL_RESOURCE_URI=https://localhost:3003/api/internal
```

These are identifiers (token audiences), not addresses: nothing is ever requested at them. Auth requires both, as
distinct HTTPS URLs, and the backend and the dashboard must use the same values.

### 2. Generate the backend's key pair

The backend proves who it is to Auth with a private key. Generate an Ed25519 pair:

```sh
node -e 'const c=require("node:crypto");const{privateKey}=c.generateKeyPairSync("ed25519");const jwk={...privateKey.export({format:"jwk"}),kid:c.randomUUID(),alg:"EdDSA"};const{d,...pub}=jwk;console.log("OAUTH_BACKEND_PRIVATE_JWK=\x27"+JSON.stringify(jwk)+"\x27\n\nPublic JWKS to paste in Auth:\n"+JSON.stringify({keys:[pub]}))'
```

The first line goes into the backend's `.env`. Paste only the **public** JWKS into Auth: the private key never leaves
the backend.

### 3. Register the backend

Sign in as Ada Admin and open **Applications** → new application (`/applications/new`):

1. **Basics**: any name, e.g. `Backend (local)`.
2. **Usage**: **Calls APIs as itself** only.
3. **Authentication**: **Private key**, and paste the public JWKS from step 2.
4. **Access**, under _PoliNetwork APIs it may call as itself_: `idp:access:read` (the access snapshot, required) and
   `idp:people:roles` (only needed to change People roles).
5. Create it and copy its **client ID**.

Put the client ID in Auth's `.env.local` and restart Auth:

```sh
OAUTH_BACKEND_CLIENT_ID=<the backend's client ID>
```

Then finish the backend's `.env` as described in the
[backend guide](https://github.com/PoliNetworkOrg/backend/blob/main/CONTRIBUTING.md#connect-it-to-auth), and start it.

Optionally, let Auth notify the backend at once when access changes, instead of waiting for its 30-second poll:

```sh
OAUTH_BACKEND_EVENTS_URL=http://localhost:3000/internal/events
```

### 4. Register the admin dashboard

New application again:

1. **Basics**: any name, e.g. `Admin Dashboard (local)`.
2. **Usage**: **Signs people in** only.
3. **Authentication**: **Client secret**.
4. **Access**:
   - Redirect URI type: **Also localhost and app schemes**, because the dashboard runs on `http://localhost`.
   - **Redirect URIs**: `http://localhost:3001/auth/callback`
   - _What it may ask people for_: `openid`, `profile`, `email`, `offline_access`
   - _PoliNetwork APIs it may call for them_: `backend:admin`
   - **Post-logout redirect URIs**: `http://localhost:3001/login`
5. Create it, and copy the **client ID** and the **client secret**: the secret is shown only once.

They go into the dashboard's `.env`, as described in the
[admin guide](https://github.com/PoliNetworkOrg/admin/blob/main/CONTRIBUTING.md#connect-it-to-auth).

### 5. Check it works

With all three running, open http://localhost:3001, sign in as Ada Admin and open a page with backend data, such as
the Telegram groups. If it fails, the backend log names the cause: a missing scope, an unknown client, or a snapshot
that could not be pulled.

A persona can only see what its permissions allow, and a permission that does not exist in Auth is held by nobody,
not even Master Admin. If a dashboard page stays hidden for Ada Admin, check that its permission exists at
`/access/permissions`.

## Pull requests

- Run `vp check`, `vp test` and `vp run build` before pushing.
- Use [Conventional Commits](https://www.conventionalcommits.org) for commit messages and PR titles:
  `type(scope): summary`, e.g. `feat(auth): …` or `fix(account): …`, with `!` after the scope for breaking changes. A
  squash merge turns the PR title into the commit on `main`.
- A schema change ships with its generated migration in `drizzle/`.
