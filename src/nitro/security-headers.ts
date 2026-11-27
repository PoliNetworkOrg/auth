import { definePlugin } from "nitro";

import { env } from "../env";
import { securityHeaders } from "../lib/security-headers";

/**
 * Files from `public/` and Nitro's own error pages never reach the request middleware in
 * `src/start.ts`, so they get the same headers here. Responses from the app already have
 * them, and a header that is already set is left alone.
 */
export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook("response", (response) => {
    try {
      for (const [name, value] of securityHeaders(env.BETTER_AUTH_URL, response.headers)) {
        response.headers.set(name, value);
      }
    } catch {
      // Headers that cannot change only come from the app, which set them already.
    }
  });
});
