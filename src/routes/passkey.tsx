import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The post-login page before `/setup` replaced it. A sign-in sent here just before a deploy is
 * forwarded with its signed query exactly as it came, so the signature still verifies.
 */
export const Route = createFileRoute("/passkey")({
  beforeLoad: ({ location }) => {
    throw redirect({ href: `/setup${location.searchStr}`, replace: true });
  },
});
