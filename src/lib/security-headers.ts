/**
 * Headers every response carries. No other site may frame these pages: the session cookie
 * is SameSite=Lax, so a page on another polinetwork.org subdomain could otherwise frame the
 * consent and sign-out pages with the person signed in and trick them into clicking.
 *
 * The policy stops at framing, base and plugins on purpose. `form-action` would block the
 * sign-out form, which is redirected to the application's own address, and `script-src`
 * would block the inline theme script and the hydration scripts.
 */
export function securityHeaders(publicOrigin: string, existing: Headers): [string, string][] {
  const headers: [string, string][] = [
    ["X-Frame-Options", "DENY"],
    ["Content-Security-Policy", "frame-ancestors 'none'; base-uri 'self'; object-src 'none'"],
    ["X-Content-Type-Options", "nosniff"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ];
  // Only on https: local development runs on http://localhost.
  if (new URL(publicOrigin).protocol === "https:") {
    headers.push(["Strict-Transport-Security", "max-age=31536000; includeSubDomains"]);
  }
  // A header the handler already chose, such as a stricter policy, stays as it is.
  return headers.filter(([name]) => !existing.has(name));
}

/** Adds the headers, copying the response when its headers cannot be changed. */
export function withSecurityHeaders(response: Response, publicOrigin: string): Response {
  const headers = securityHeaders(publicOrigin, response.headers);
  try {
    for (const [name, value] of headers) response.headers.set(name, value);
    return response;
  } catch {
    const copy = new Response(response.body, response);
    for (const [name, value] of headers) copy.headers.set(name, value);
    return copy;
  }
}
