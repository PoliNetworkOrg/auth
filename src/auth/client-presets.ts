import type { OidcClientDraft } from "./oidc-clients";

export type ClientPreset = {
  id: string;
  name: string;
  description: string;
  draft: Partial<OidcClientDraft>;
};

/**
 * Starting points for the reviewed Phase 1 clients. They only fill in the form: every field
 * stays editable, and the server checks the result like any other draft.
 */
export const CLIENT_PRESETS: ClientPreset[] = [
  {
    id: "telegram-bot",
    name: "Telegram Bot",
    description: "Calls the backend's Telegram APIs as itself.",
    draft: {
      name: "Telegram Bot",
      credential: "private-key",
      signIn: false,
      serviceAccess: true,
      serviceScopes: [
        "backend:tg:read",
        "backend:tg:ingest",
        "backend:tg:groups:sync",
        "backend:tg:audit",
        "backend:tg:act-as",
        "backend:tg:events",
      ],
      resources: ["backend"],
    },
  },
  {
    id: "website",
    name: "Website",
    description: "Reads the backend's public data as itself.",
    draft: {
      name: "Website",
      credential: "private-key",
      signIn: false,
      serviceAccess: true,
      serviceScopes: ["backend:public:read"],
      resources: ["backend"],
    },
  },
  {
    id: "admin-dashboard",
    name: "Admin Dashboard",
    description: "Signs administrators in and calls the backend for them.",
    draft: {
      name: "Admin Dashboard",
      credential: "private-key",
      signIn: true,
      scopes: ["openid", "profile", "email", "offline_access"],
      serviceAccess: false,
      apiScopes: ["backend:admin"],
      resources: ["backend"],
      enableEndSession: true,
    },
  },
  {
    id: "backend",
    name: "Backend snapshot pull",
    description: "Pulls the access snapshot from this identity provider.",
    draft: {
      name: "Backend",
      credential: "private-key",
      signIn: false,
      serviceAccess: true,
      serviceScopes: ["idp:access:read"],
      resources: ["internal"],
    },
  },
];
