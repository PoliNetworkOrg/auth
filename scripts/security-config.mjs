import { z } from "zod";

const optional = (schema) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
const schema = z
  .object({
    PN_ENTRA_TENANT_ID: optional(z.uuid()),
    PN_ENTRA_CLIENT_ID: optional(z.string().trim().min(1)),
    PN_ENTRA_CLIENT_SECRET: optional(z.string().trim().min(1)),
    PN_ENTRA_OIDC_ADMIN_GROUP_ID: optional(z.uuid()),
    IDP_ADMIN_USER_IDS: z
      .string()
      .default("")
      .transform((value) => (value.trim() === "" ? [] : value.split(",").map((id) => id.trim())))
      .pipe(z.array(z.string().regex(/^[a-zA-Z0-9_-]+$/))),
  })
  .superRefine((config, context) => {
    const credentials = [
      config.PN_ENTRA_TENANT_ID,
      config.PN_ENTRA_CLIENT_ID,
      config.PN_ENTRA_CLIENT_SECRET,
    ];
    if (
      (credentials.some(Boolean) || config.PN_ENTRA_OIDC_ADMIN_GROUP_ID) &&
      !credentials.every(Boolean)
    )
      context.addIssue({
        code: "custom",
        message: "PN Entra requires tenant, client ID and client secret together.",
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
