import { describe, expect, it } from "vite-plus/test";
import {
  USER_PAGE_SIZE,
  hasUserFilters,
  isPlaceholderEmail,
  parseUserSearch,
  userSearchParams,
  userSearchSchema,
} from "./users";

describe("user directory filters", () => {
  it("reads every filter from a query string", () => {
    const params = new URLSearchParams(
      "q=Ada&role=moderator&sort=newest&page=3&socio=yes&telegram=no&passkey=yes",
    );
    expect(parseUserSearch(params)).toEqual({
      q: "Ada",
      role: "moderator",
      sort: "newest",
      page: 3,
      socio: "yes",
      telegram: "no",
      passkey: "yes",
    });
  });

  it("drops malformed values instead of refusing the whole request", () => {
    const params = new URLSearchParams(
      "q=%20%20&sort=random&page=0&pageSize=30&student=maybe&extra=1",
    );
    expect(parseUserSearch(params)).toEqual({});
    expect(parseUserSearch(new URLSearchParams("page=two"))).toEqual({});
  });

  it("round-trips through the API query string", () => {
    const search = { q: "123456789", student: "yes", page: 2, pageSize: 50 } as const;
    expect(parseUserSearch(userSearchParams(search))).toEqual(search);
  });

  it("defaults to 25 rows and accepts the admin page sizes", () => {
    expect(USER_PAGE_SIZE).toBe(25);
    for (const pageSize of [10, 20, 25, 50, 100]) {
      expect(parseUserSearch(new URLSearchParams(`pageSize=${pageSize}`)).pageSize).toBe(pageSize);
    }
  });

  it("keeps a numeric search from the page URL as text", () => {
    // The router parses `?q=123456789` into a number before validating it.
    expect(userSearchSchema.parse({ q: 123456789 })).toEqual({ q: "123456789" });
  });

  it("tells filters apart from sorting and paging", () => {
    expect(hasUserFilters({ sort: "newest", page: 2, pageSize: 50 })).toBe(false);
    expect(hasUserFilters({ telegram: "no" })).toBe(true);
    expect(hasUserFilters({ role: "moderator" })).toBe(true);
  });

  it("recognizes the placeholder addresses given to providers without an email", () => {
    expect(isPlaceholderEmail("telegram.abc@identity.invalid")).toBe(true);
    expect(isPlaceholderEmail("ada@polinetwork.org")).toBe(false);
  });
});
