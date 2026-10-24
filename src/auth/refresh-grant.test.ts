import { afterEach, expect, it, vi } from "vite-plus/test";
import { serializeRefreshGrant } from "./refresh-grant";

afterEach(() => {
  vi.useRealTimers();
});

function refreshRequest(token: string) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: token,
  }).toString();
  return new Request("https://auth.polinetwork.test/api/auth/oauth2/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "content-length": String(body.length),
    },
    body,
  });
}

/** A handler that records its calls and only answers when `finish` is called. */
function blockedHandler() {
  const calls: string[] = [];
  let finish = () => {};
  const finished = new Promise<void>((resolve) => (finish = resolve));
  return {
    calls,
    finish,
    handler: (name: string) => async () => {
      calls.push(name);
      await finished;
      return new Response(name);
    },
  };
}

it("runs a second refresh of the same token after the first", async () => {
  const { calls, finish, handler } = blockedHandler();
  const first = serializeRefreshGrant(refreshRequest("token"), handler("first"));
  const second = serializeRefreshGrant(refreshRequest("token"), handler("second"));
  await vi.waitFor(() => expect(calls).toEqual(["first"]));
  finish();
  await Promise.all([first, second]);
  expect(calls).toEqual(["first", "second"]);
});

it("keeps the queue going when a refresh throws", async () => {
  const failed = serializeRefreshGrant(refreshRequest("token"), async () => {
    throw new Error("refresh failed");
  });
  const waiting = serializeRefreshGrant(
    refreshRequest("token"),
    async () => new Response("second"),
  );
  await expect(failed).rejects.toThrow("refresh failed");
  expect(await (await waiting).text()).toBe("second");
  const later = await serializeRefreshGrant(
    refreshRequest("token"),
    async () => new Response("third"),
  );
  expect(await later.text()).toBe("third");
});

it("runs refreshes of different tokens at once", async () => {
  const { calls, finish, handler } = blockedHandler();
  const first = serializeRefreshGrant(refreshRequest("one"), handler("one"));
  const second = serializeRefreshGrant(refreshRequest("two"), handler("two"));
  await vi.waitFor(() => expect(calls).toEqual(["one", "two"]));
  finish();
  await Promise.all([first, second]);
});

it("stops waiting for a stuck request after five seconds", async () => {
  vi.useFakeTimers();
  const { calls, finish, handler } = blockedHandler();
  const first = serializeRefreshGrant(refreshRequest("token"), handler("first"));
  const second = serializeRefreshGrant(refreshRequest("token"), handler("second"));
  await vi.advanceTimersByTimeAsync(4_999);
  expect(calls).toEqual(["first"]);
  await vi.advanceTimersByTimeAsync(1);
  expect(calls).toEqual(["first", "second"]);
  finish();
  await Promise.all([first, second]);
});

it("runs requests past the eighth for one token without queueing them", async () => {
  const { calls, finish, handler } = blockedHandler();
  const requests = Array.from({ length: 9 }, (_, index) =>
    serializeRefreshGrant(refreshRequest("token"), handler(String(index))),
  );
  // The running request and the ninth; which one is ninth depends on read order.
  await vi.waitFor(() => expect(calls).toHaveLength(2));
  finish();
  await Promise.all(requests);
  expect(calls).toHaveLength(9);
});

it("does not read requests without a known, small length", async () => {
  const handle = vi.fn(async () => new Response("ok"));
  const request = new Request("https://auth.polinetwork.test/api/auth/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=refresh_token&refresh_token=token",
  });
  const clone = vi.spyOn(request, "clone");
  await serializeRefreshGrant(request, handle);
  expect(clone).not.toHaveBeenCalled();
  expect(handle).toHaveBeenCalledOnce();
});
