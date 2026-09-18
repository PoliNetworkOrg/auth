import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

import { validateSecurityConfiguration } from "../scripts/security-config.mjs";

validateSecurityConfiguration(process.env);

export const env = createEnv({
  server: {
    DB_HOST: z.string().min(1).default("localhost"),
    DB_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
    DB_USER: z.string().min(1),
    DB_PASS: z.string().min(1),
    DB_NAME: z.string().min(3).default("polinetwork_auth"),

    BETTER_AUTH_URL: z.url().default("https://auth.polinetwork.org"),
    BETTER_AUTH_SECRET: z.string().min(32),

    PN_ENTRA_CLIENT_ID: z.string().min(1).optional(),
    PN_ENTRA_CLIENT_SECRET: z.string().min(1).optional(),
    PN_ENTRA_TENANT_ID: z.uuid().optional(),
    PN_ENTRA_MEMBER_GROUP_ID: z.uuid().default("1c68dbb8-4ac3-4569-a886-283b5a825cbd"),
    // Optional Entra group whose direct members hold the built-in Direttivo role.
    // Unset: nobody is inferred as Direttivo.
    PN_ENTRA_DIRETTIVO_GROUP_ID: z.uuid().optional(),
    PN_ENTRA_MEMBER_REFRESH_HOURS: z.coerce.number().int().positive().default(24),
    // Optional stricter Entra group whose direct members hold the built-in Master Admin
    // role, and through it every permission.
    // Unset: only the explicit break-glass allowlist can hold Master Admin.
    PN_ENTRA_OIDC_ADMIN_GROUP_ID: z.uuid().optional(),

    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),

    TELEGRAM_CLIENT_ID: z.string().min(1).optional(),
    TELEGRAM_CLIENT_SECRET: z.string().min(1).optional(),

    AZURE_TENANT_ID: z.string().min(1).optional(),
    AZURE_CLIENT_ID: z.string().min(1).optional(),
    AZURE_CLIENT_SECRET: z.string().min(1).optional(),
    AZURE_EMAIL_SENDER: z.email().default("noreply@polinetwork.org"),
    STUDENT_VERIFICATION_TTL_DAYS: z.coerce.number().int().positive().default(365),

    // Break-glass allowlist of local user IDs that always hold Master Admin. Every other
    // administrative right is an ordinary permission granted through a role.
    IDP_ADMIN_USER_IDS: z
      .string()
      .default("")
      .transform((value) =>
        value
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean),
      ),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
