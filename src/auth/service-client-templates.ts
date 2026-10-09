/** Reviewed Phase 1 client ceilings. UI and server read the same policy. */
export const SERVICE_CLIENT_TEMPLATES = {
  "telegram-bot": {
    name: "Telegram Bot",
    scopes: [
      "backend:tg:read",
      "backend:tg:ingest",
      "backend:tg:groups:sync",
      "backend:tg:audit",
      "backend:tg:act-as",
      "backend:tg:events",
    ],
    resource: "backend",
    interactive: false,
  },
  website: {
    name: "Website",
    scopes: ["backend:public:read"],
    resource: "backend",
    interactive: false,
  },
  "admin-dashboard": {
    name: "Admin Dashboard",
    scopes: ["openid", "profile", "email", "offline_access", "backend:admin"],
    resource: "backend",
    interactive: true,
  },
  backend: {
    name: "Backend snapshot pull",
    scopes: ["idp:access:read"],
    resource: "internal",
    interactive: false,
  },
} as const;

export type ServiceClientKind = keyof typeof SERVICE_CLIENT_TEMPLATES;
