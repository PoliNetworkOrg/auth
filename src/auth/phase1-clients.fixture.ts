// Test fixture: the four reviewed Phase 1 clients (RFC §9) as application form drafts.
// Application code must not import it.
import type { OidcClientDraft } from "./oidc-clients";

export type Phase1Client = {
  id: "telegram-bot" | "website" | "admin-dashboard" | "backend";
  name: string;
  draft: Partial<OidcClientDraft>;
};

export const PHASE1_CLIENTS: Phase1Client[] = [
  {
    id: "telegram-bot",
    name: "Telegram Bot",
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
