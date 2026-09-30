import { listEntraGroupMembers } from "./membership";

type GroupListing = (groupId: string) => Promise<Set<string> | null>;

/**
 * Remembers whole group listings for a short time, so paging through the user directory
 * does not page through Graph on every request. Freshness is measured from when the
 * listing started, concurrent requests share one listing, and failures are never cached.
 */
export function createGroupListingCache(list: GroupListing, ttlMs: number, now = Date.now) {
  type Entry = { members: Set<string>; expiresAt: number };
  const cache = new Map<string, Entry>();
  const pending = new Map<string, Promise<Set<string> | null>>();
  return async (groupId: string): Promise<Set<string> | null> => {
    const cached = cache.get(groupId);
    if (cached && cached.expiresAt > now()) return cached.members;
    const inFlight = pending.get(groupId);
    if (inFlight) return inFlight;
    const startedAt = now();
    const listing = list(groupId)
      .catch(() => null)
      .then((members) => {
        if (members && now() < startedAt + ttlMs)
          cache.set(groupId, { members, expiresAt: startedAt + ttlMs });
        else cache.delete(groupId);
        return members;
      })
      .finally(() => pending.delete(groupId));
    pending.set(groupId, listing);
    return listing;
  };
}

/** Same bound as the per-person membership checks behind authorization. */
export const GROUP_LISTING_CACHE_MS = 60_000;

export const groupMembers = createGroupListingCache(listEntraGroupMembers, GROUP_LISTING_CACHE_MS);
