import { useEffect, useState, type RefObject } from "react";
import { cn } from "cn";

type NavSection = { id: string; title: string };

/**
 * Links to every `[data-nav-section]` inside `container`, highlighting the one being read.
 * Sections come and go with the settings (Sign-in only exists for apps that sign people
 * in), so the list follows the DOM instead of being declared twice.
 */
export function SectionNav({ container }: { container: RefObject<HTMLElement | null> }) {
  const [sections, setSections] = useState<NavSection[]>([]);
  const [active, setActive] = useState<string>();

  useEffect(() => {
    const root = container.current;
    if (!root) return;
    let last = "";
    const scan = () => {
      const found = [...root.querySelectorAll<HTMLElement>("[data-nav-section]")].map(
        (element) => ({ id: element.id, title: element.dataset.navSection ?? element.id }),
      );
      const key = found.map((section) => section.id).join(" ");
      if (key === last) return;
      last = key;
      setSections(found);
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [container]);

  useEffect(() => {
    if (!sections.length) return;
    let frame = 0;
    // The section being read is the last one whose heading has passed the top third of the
    // viewport, or the last one once the page can't scroll further.
    const update = () => {
      frame = 0;
      const line = window.innerHeight / 3;
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      let reading = sections[0]?.id;
      for (const section of sections) {
        const element = document.getElementById(section.id);
        if (element && element.getBoundingClientRect().top <= line) reading = section.id;
      }
      setActive(atBottom ? sections.at(-1)?.id : reading);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [sections]);

  const current = active ?? sections[0]?.id;
  return (
    <nav aria-label="Application sections" className="sticky top-24 hidden lg:block">
      <ul className="space-y-1">
        {sections.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              aria-current={current === section.id ? "location" : undefined}
              onClick={() => setActive(section.id)}
              className={cn(
                "block rounded-md px-3 py-2 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                current === section.id
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {section.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
