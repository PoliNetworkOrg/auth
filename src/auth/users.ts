// Shared by the server and the browser: keep this file free of server-only imports.
import { z } from "zod";
import { MAX_KEY_LENGTH } from "./rbac";

/**
 * What an administrator can see about someone at a glance, and filter the directory by.
 * Socio, Direttivo, and Student are the identity states behind the built-in roles; the rest
 * say which accounts the person has linked.
 */
export const USER_TRAITS = [
  { key: "socio", label: "Socio", description: "Member of PoliNetwork APS" },
  { key: "direttivo", label: "Direttivo", description: "Member of the board" },
  { key: "student", label: "Student", description: "Verified Polimi student" },
  { key: "telegram", label: "Telegram", description: "Telegram linked" },
  { key: "google", label: "Google", description: "Signs in with Google" },
  { key: "polinetwork", label: "PoliNetwork", description: "Signs in with PoliNetwork APS" },
  { key: "passkey", label: "Passkey", description: "Has a passkey" },
] as const;

export type UserTrait = (typeof USER_TRAITS)[number]["key"];

/** The traits that are group memberships in PoliNetwork Entra, checked through Graph. */
export type GroupTrait = "socio" | "direttivo";

export const USER_SORTS = ["name", "newest", "oldest"] as const;

export const USER_PAGE_SIZE = 50;

// The router parses search values as JSON, so a Telegram ID typed into the search box
// arrives as a number.
const text = (max: number) =>
  z
    .preprocess(
      (value) => (typeof value === "number" ? String(value) : value),
      z.string().trim().min(1).max(max),
    )
    .optional()
    .catch(undefined);
const presence = z.enum(["yes", "no"]).optional().catch(undefined);

/**
 * The directory's filters, as they appear in the page URL and in the API query string.
 * Anything malformed is dropped rather than refused, so an edited link still opens.
 */
export const userSearchSchema = z.object({
  q: text(200),
  /** A role given by hand, by key. */
  role: text(MAX_KEY_LENGTH),
  sort: z.enum(USER_SORTS).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100_000).optional().catch(undefined),
  socio: presence,
  direttivo: presence,
  student: presence,
  telegram: presence,
  google: presence,
  polinetwork: presence,
  passkey: presence,
});

export type UserSearch = z.infer<typeof userSearchSchema>;

export function parseUserSearch(params: URLSearchParams): UserSearch {
  return userSearchSchema.parse(Object.fromEntries(params));
}

export function userSearchParams(search: UserSearch): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search))
    if (value !== undefined) params.set(key, String(value));
  return params;
}

/** The filters that narrow the list, ignoring sorting and paging. */
export function hasUserFilters(search: UserSearch) {
  return (
    search.q !== undefined ||
    search.role !== undefined ||
    USER_TRAITS.some((trait) => search[trait.key] !== undefined)
  );
}

/** Providers without a usable login email get a placeholder under this domain. */
export function isPlaceholderEmail(email: string) {
  return email.toLowerCase().endsWith("@identity.invalid");
}

/**
 * Where the directory's Socio and Direttivo answers came from: the group in Entra right
 * now, what was recorded at each person's last PoliNetwork sign-in because Graph could not
 * be reached, or nowhere because the group is not configured and so nobody holds it.
 */
export type MembershipSource = "live" | "recorded" | "unconfigured";

export type UserListItem = {
  id: string;
  name: string;
  /** Null when the only address on file is a placeholder. */
  email: string | null;
  image: string | null;
  createdAt: string;
  traits: Record<UserTrait, boolean>;
  telegramId: string | null;
  /** The linked Polimi address. Whether it still proves student status is `traits.student`. */
  polimiEmail: string | null;
  /** Keys of the roles given by hand. Null when the caller may not read roles. */
  roles: string[] | null;
};

export type UserListPage = {
  users: UserListItem[];
  total: number;
  page: number;
  pageSize: number;
  membership: Record<GroupTrait, MembershipSource>;
};

export type UserAccountSummary = {
  id: string;
  providerId: string;
  /** What identifies the account to a person: the Telegram ID or the Polimi address. */
  identifier: string | null;
  linkedAt: string;
  /** When the status this account proves stops counting, for accounts that prove one. */
  validUntil: string | null;
};

export type UserRoleAssignment = {
  key: string;
  name: string;
  assignedAt: string | null;
  assignedBy: { id: string; name: string | null } | null;
};

export type UserDetail = {
  id: string;
  name: string;
  email: string | null;
  image: string | null;
  createdAt: string;
  updatedAt: string;
  accounts: UserAccountSummary[];
  passkeys: number;
  telegramId: string | null;
  /** Identity states checked now, the same way their next token would be. */
  states: string[];
  /** Roles given by hand. Null when the caller may not read roles. */
  assignedRoles: UserRoleAssignment[] | null;
  /** Every role they hold, including built-in and inherited ones. Null without role access. */
  roles: string[] | null;
  /** Every permission they hold. Null when the caller may read neither roles nor permissions. */
  permissions: string[] | null;
};
