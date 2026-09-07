import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "./ui/button";

type Theme = "light" | "dark" | "system";
export const themeScript = `(function(){try{var t=localStorage.getItem('pn-theme');document.documentElement.classList.toggle('dark',t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches));}catch{document.documentElement.classList.toggle('dark',matchMedia('(prefers-color-scheme: dark)').matches);}})();`;

export function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => {
    try {
      const stored = localStorage.getItem("pn-theme");
      setTheme(stored === "dark" || stored === "light" ? stored : "system");
    } catch {
      setTheme("system");
    }
  }, []);
  useEffect(() => {
    if (theme === null) return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      document.documentElement.classList.toggle(
        "dark",
        theme === "dark" || (theme === "system" && media.matches),
      );
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  return (
    <div role="group" aria-label="Color theme" className="flex rounded-full border bg-card p-1">
      {(
        [
          { value: "light", icon: Sun },
          { value: "dark", icon: Moon },
          { value: "system", icon: Monitor },
        ] as const
      ).map(({ value, icon: Icon }) => (
        <Button
          key={value}
          variant={theme === value ? "secondary" : "ghost"}
          size="icon-sm"
          className="rounded-full"
          aria-label={`${value[0].toUpperCase()}${value.slice(1)} theme`}
          aria-pressed={theme === value}
          onClick={() => {
            setTheme(value);
            try {
              localStorage.setItem("pn-theme", value);
            } catch {
              /* Keep the in-memory preference. */
            }
          }}
        >
          <Icon className="size-4" />
        </Button>
      ))}
    </div>
  );
}
