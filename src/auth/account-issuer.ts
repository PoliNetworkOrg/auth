/**
 * The issuer each linked account belongs to. `account.issuer` joins an account to its identity
 * evidence, whose key is (issuer, subject), and `account_issuer_subject_uidx` keeps one
 * (issuer, subject) pair to one person.
 *
 * Better Auth 1.7.0 to 1.7.2 wrote this column itself. From 1.7.3 it identifies accounts by
 * (providerId, accountId) again and no longer knows the column, so this app fills it in: the
 * `account.create.before` database hook in `index.ts` sets it on every account Better Auth
 * creates, and the app's own inserts (Polimi email, dev fixtures) set it directly.
 *
 * Each provider here has exactly one issuer, so the provider decides it. The values are the
 * ones Better Auth 1.7.2 stored, which keeps existing rows joined to their evidence.
 */

/**
 * `account.additionalFields` for the column. Declared so Better Auth's schema check accepts it
 * (it refuses a required column it does not know), and `input: false` so no client can set it.
 */
export const accountIssuerField = {
  issuer: { type: "string", required: true, input: false },
} as const;

/** Google's issuer, as declared by Better Auth's Google provider. */
export const GOOGLE_ISSUER = "https://accounts.google.com";

/** Telegram's OpenID Connect issuer, from its discovery document. */
export const TELEGRAM_ISSUER = "https://oauth.telegram.org";

/** The issuer this app uses for Polimi email addresses it verified itself. */
export const POLIMI_EMAIL_ISSUER = "https://mail.polimi.it";

/** The single-tenant Entra issuer from the tenant's v2.0 discovery document. */
export function entraIssuer(tenantId: string) {
  return `https://login.microsoftonline.com/${tenantId}/v2.0`;
}

/**
 * The issuer of an account at this provider. Throws for a provider with no known issuer, so an
 * account is never stored without one: a sign-in through such a provider fails instead.
 */
export function accountIssuer(providerId: string, entraTenantId: string | undefined): string {
  switch (providerId) {
    case "google":
      return GOOGLE_ISSUER;
    case "telegram":
      return TELEGRAM_ISSUER;
    case "polimi-email":
      return POLIMI_EMAIL_ISSUER;
    case "pn-entra":
      if (!entraTenantId) throw new Error("pn-entra accounts need PN_ENTRA_TENANT_ID.");
      return entraIssuer(entraTenantId);
    default:
      throw new Error(`No account issuer is defined for provider ${JSON.stringify(providerId)}.`);
  }
}
