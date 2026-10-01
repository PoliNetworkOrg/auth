import { z } from "zod";

const optional = (schema) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
// Published in `.env.local.example` so a fresh clone runs as is; worthless as a secret.
const LOCAL_EXAMPLE_SECRET = "local-development-only-secret-never-deploy-this";
const isLoopback = (value) => {
  try {
    return LOOPBACK_HOSTS.includes(new URL(value).hostname);
  } catch {
    return false;
  }
};
const schema = z
  .object({
    BETTER_AUTH_URL: z
      .url()
      .default("https://auth.polinetwork.org")
      .refine((value) => {
        const url = new URL(value);
        if (url.username || url.password) return false;
        // Cleartext HTTP would expose sessions and identity claims, so it is only ever
        // tolerated for local development.
        if (url.protocol === "http:") return LOOPBACK_HOSTS.includes(url.hostname);
        return url.protocol === "https:";
      }, "BETTER_AUTH_URL must be an HTTPS URL without credentials, or HTTP on localhost."),
    BETTER_AUTH_SECRET: z.string().trim().min(32),
    PN_ENTRA_MEMBER_GROUP_ID: optional(z.uuid()),
    PN_ENTRA_DIRETTIVO_GROUP_ID: optional(z.uuid()),
    PN_ENTRA_MEMBER_REFRESH_HOURS: optional(z.coerce.number().int().positive()),
    STUDENT_VERIFICATION_TTL_DAYS: optional(z.coerce.number().int().positive()),
    GOOGLE_CLIENT_ID: optional(z.string().trim().min(1)),
    GOOGLE_CLIENT_SECRET: optional(z.string().trim().min(1)),
    TELEGRAM_CLIENT_ID: optional(z.string().trim().min(1)),
    TELEGRAM_CLIENT_SECRET: optional(z.string().trim().min(1)),
    AZURE_TENANT_ID: optional(z.string().trim().min(1)),
    AZURE_CLIENT_ID: optional(z.string().trim().min(1)),
    AZURE_CLIENT_SECRET: optional(z.string().trim().min(1)),
    AZURE_EMAIL_SENDER: optional(z.email()),
    PN_ENTRA_TENANT_ID: optional(z.uuid()),
    PN_ENTRA_CLIENT_ID: optional(z.string().trim().min(1)),
    PN_ENTRA_CLIENT_SECRET: optional(z.string().trim().min(1)),
    PN_ENTRA_OIDC_ADMIN_GROUP_ID: optional(z.uuid()),
    IDP_ADMIN_USER_IDS: z
      .string()
      .default("")
      .transform((value) => (value.trim() === "" ? [] : value.split(",").map((id) => id.trim())))
      .pipe(z.array(z.string().regex(/^[a-zA-Z0-9_-]+$/))),
    // Turns on the dev sign-in in `vp dev`. Production builds do not contain it at all;
    // this only keeps a stray setting from ever pairing with a public origin.
    DEV_LOGIN: optional(z.literal("1", { error: "DEV_LOGIN must be 1 or unset." })),
    NODE_ENV: z.string().optional(),
  })
  .superRefine((config, context) => {
    for (const keys of [
      ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
      ["TELEGRAM_CLIENT_ID", "TELEGRAM_CLIENT_SECRET"],
      ["AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET"],
    ]) {
      if (keys.some((key) => config[key]) && !keys.every((key) => config[key]))
        context.addIssue({ code: "custom", message: `Configure ${keys.join(", ")} together.` });
    }
    const credentials = [
      config.PN_ENTRA_TENANT_ID,
      config.PN_ENTRA_CLIENT_ID,
      config.PN_ENTRA_CLIENT_SECRET,
    ];
    if (
      (credentials.some(Boolean) ||
        config.PN_ENTRA_OIDC_ADMIN_GROUP_ID ||
        config.PN_ENTRA_DIRETTIVO_GROUP_ID) &&
      !credentials.every(Boolean)
    )
      context.addIssue({
        code: "custom",
        message: "PN Entra requires tenant, client ID and client secret together.",
      });
    const local = config.NODE_ENV !== "production" && isLoopback(config.BETTER_AUTH_URL);
    if (config.BETTER_AUTH_SECRET === LOCAL_EXAMPLE_SECRET && !local)
      context.addIssue({
        code: "custom",
        message: "BETTER_AUTH_SECRET is the public example from .env.local.example.",
      });
    if (config.DEV_LOGIN && !local)
      context.addIssue({
        code: "custom",
        message: "DEV_LOGIN is only allowed outside production, with BETTER_AUTH_URL on localhost.",
      });
    if (!config.PN_ENTRA_OIDC_ADMIN_GROUP_ID && config.IDP_ADMIN_USER_IDS.length === 0)
      context.addIssue({
        code: "custom",
        message:
          "Configure PN_ENTRA_OIDC_ADMIN_GROUP_ID or a nonempty IDP_ADMIN_USER_IDS break-glass allowlist.",
      });
  });

/** Validate before migrations or serving requests; never include configuration values in errors. */
export function validateSecurityConfiguration(environment) {
  const result = schema.safeParse(environment);
  if (!result.success)
    throw new Error(
      `Invalid security configuration: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
    );
}
