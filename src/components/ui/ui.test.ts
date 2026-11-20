import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { SignInIcons } from "@/components/users/traits";
import { ScrollArea } from "./scroll-area";
import { Hint } from "./tooltip";

describe("Hint", () => {
  it("makes a plain element focusable so keyboard users can open the hint", () => {
    const html = renderToStaticMarkup(
      createElement(Hint, { content: "Why", children: createElement("span", null, "mark") }),
    );
    expect(html).toMatch(/<span[^>]*tabindex="0"/);
  });

  it("leaves a mark out of the tab order when asked", () => {
    const html = renderToStaticMarkup(
      createElement(Hint, {
        content: "Why",
        focusable: false,
        children: createElement("span", null, "mark"),
      }),
    );
    expect(html).not.toContain("tabindex");
    expect(html).toContain('data-slot="tooltip-trigger"');
  });

  it("adds no tab stop for a row of sign-in icons, which already read out to screen readers", () => {
    const html = renderToStaticMarkup(createElement(SignInIcons, { held: () => true }));
    expect(html).not.toContain("tabindex");
    expect(html).toContain('<span class="sr-only">');
  });
});

describe("ScrollArea", () => {
  it("describes the focusable viewport, not the wrapper around it", () => {
    const html = renderToStaticMarkup(
      createElement(
        ScrollArea,
        { viewportLabel: "Roles", "aria-describedby": "roles-error" },
        createElement("p", null, "content"),
      ),
    );
    expect(html).toMatch(/<div[^>]*role="region"[^>]*aria-describedby="roles-error"/);
    expect(html.match(/aria-describedby/g)).toHaveLength(1);
  });
});
