import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.url(),
    BETTER_AUTH_URL: z.url().default("https://auth.polinetwork.org"),
    BETTER_AUTH_SECRET: z.string().min(32),

    PN_ENTRA_CLIENT_ID: z.string().min(1).optional(),
    PN_ENTRA_CLIENT_SECRET: z.string().min(1).optional(),
    PN_ENTRA_TENANT_ID: z.uuid().optional(),
    PN_ENTRA_MEMBER_GROUP_ID: z.uuid().default("1c68dbb8-4ac3-4569-a886-283b5a825cbd"),
    PN_ENTRA_MEMBER_REFRESH_HOURS: z.coerce.number().int().positive().default(24),

    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),

    TELEGRAM_CLIENT_ID: z.string().min(1).optional(),
    TELEGRAM_CLIENT_SECRET: z.string().min(1).optional(),

    AZURE_TENANT_ID: z.string().min(1).optional(),
    AZURE_CLIENT_ID: z.string().min(1).optional(),
    AZURE_CLIENT_SECRET: z.string().min(1).optional(),
    AZURE_EMAIL_SENDER: z.email().default("noreply@polinetwork.org"),
    STUDENT_VERIFICATION_TTL_DAYS: z.coerce.number().int().positive().default(365),

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
