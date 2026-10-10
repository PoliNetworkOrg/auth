// PROTOTYPE (proto/app-form): throwaway harness for the application form. Delete after deciding.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useLayoutEffect, useEffect, useRef, useState } from "react";
import { ArrowLeft, CircleCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OidcClientDraft } from "@/auth/oidc-clients";
import { Current } from "@/proto/app-form/current";
import { Guided } from "@/proto/app-form/guided";
import { Intent } from "@/proto/app-form/intent";
import { Settings } from "@/proto/app-form/settings";
import { describeSave, scenarios, type ScenarioKey } from "@/proto/app-form/shared";

export const Route = createFileRoute("/applications/proto")({
  head: () => ({ meta: [{ title: "Prototype · Application form" }] }),
  component: Harness,
});

const variants = [
  { name: "Current", Component: Current },
  { name: "Guided", Component: Guided },
  { name: "Intent", Component: Intent },
  { name: "Settings", Component: Settings },
];

const pickerCss = `
.proto-picker{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;align-items:center;gap:2px;padding:4px;border-radius:999px;background:rgba(10,10,10,0.82);-webkit-backdrop-filter:blur(12px) saturate(1.4);backdrop-filter:blur(12px) saturate(1.4);box-shadow:0 0 0 1px rgba(255,255,255,0.08) inset,0 8px 24px rgba(0,0,0,0.24),0 2px 6px rgba(0,0,0,0.12);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px;line-height:1;-webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none}
.proto-picker-highlight{position:absolute;top:4px;left:0;height:28px;border-radius:999px;background:rgba(255,255,255,0.12);will-change:transform}
.proto-picker[data-ready] .proto-picker-highlight{transition:transform 250ms cubic-bezier(0.23,1,0.32,1),width 250ms cubic-bezier(0.23,1,0.32,1)}
@media (prefers-reduced-motion: reduce){.proto-picker[data-ready] .proto-picker-highlight{transition:none}}
.proto-picker-item{position:relative;display:flex;align-items:center;height:28px;padding:0 12px;border:0;border-radius:999px;background:transparent;color:rgba(255,255,255,0.55);font:inherit;cursor:pointer;transition:color 150ms ease-out}
.proto-picker-item:hover{color:rgba(255,255,255,0.85)}
.proto-picker-item:active{transform:scale(0.97)}
.proto-picker-item:focus-visible{outline:2px solid rgba(255,255,255,0.4);outline-offset:2px}
.proto-picker-item[data-active]{color:#fff}
.proto-picker-divider{width:1px;height:16px;margin:0 4px;background:rgba(255,255,255,0.12)}
.proto-picker-replay{padding:0 10px;font-size:14px}
.proto-picker[data-position="top"]{bottom:auto;top:24px}
`;

function initialVariant() {
  if (typeof window === "undefined") return 0;
  const v = parseInt(new URLSearchParams(window.location.search).get("v") ?? "", 10);
  return v >= 1 && v <= variants.length ? v - 1 : 0;
}

function Harness() {
  const [current, setCurrent] = useState(0);
  const [mountKey, setMountKey] = useState(0);
  const [scenario, setScenario] = useState<ScenarioKey>("new");
  const [masterAdmin, setMasterAdmin] = useState(true);
  const [saved, setSaved] = useState<ReturnType<typeof describeSave> | null>(null);
  const pickerRef = useRef<HTMLElement>(null);
  const highlightRef = useRef<HTMLSpanElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Selection persists in ?v= and the scenario in ?s=, read after hydration.
  useEffect(() => {
    setCurrent(initialVariant());
    const s = new URLSearchParams(window.location.search).get("s");
    if (s && s in scenarios) setScenario(s as ScenarioKey);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => pickerRef.current?.setAttribute("data-ready", "")),
    );
  }, []);

  useLayoutEffect(() => {
    const move = () => {
      const el = itemRefs.current[current];
      if (!el || !highlightRef.current) return;
      highlightRef.current.style.width = `${el.offsetWidth}px`;
      highlightRef.current.style.transform = `translateX(${el.offsetLeft}px)`;
    };
    move();
    window.addEventListener("resize", move);
    return () => window.removeEventListener("resize", move);
  }, [current]);

  function setActive(i: number) {
    if (i < 0 || i >= variants.length) return;
    setCurrent(i);
    setMountKey((k) => k + 1);
    setSaved(null);
    const url = new URL(window.location.href);
    url.searchParams.set("v", String(i + 1));
    history.replaceState(null, "", url);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= variants.length) setActive(num - 1);
      else if (e.key === "ArrowRight") setActive((current + 1) % variants.length);
      else if (e.key === "ArrowLeft") setActive((current - 1 + variants.length) % variants.length);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [current]);

  function chooseScenario(next: ScenarioKey) {
    setScenario(next);
    setMountKey((k) => k + 1);
    setSaved(null);
    const url = new URL(window.location.href);
    url.searchParams.set("s", next);
    history.replaceState(null, "", url);
  }

  const s = scenarios[scenario];
  const Variant = variants[current]!.Component;
  const editing = s.mode === "edit";

  return (
    <div
      className={`mx-auto space-y-8 pb-24 ${variants[current]!.name === "Settings" ? "max-w-5xl" : "max-w-4xl"}`}
    >
      <style>{pickerCss}</style>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium">Prototype scenario</span>
        {(Object.keys(scenarios) as ScenarioKey[]).map((key) => (
          <Button
            key={key}
            type="button"
            size="xs"
            variant={scenario === key ? "secondary" : "ghost"}
            aria-pressed={scenario === key}
            onClick={() => chooseScenario(key)}
          >
            {scenarios[key].label}
          </Button>
        ))}
        <label className="ml-auto flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={masterAdmin}
            onChange={(e) => {
              setMasterAdmin(e.target.checked);
              setMountKey((k) => k + 1);
            }}
          />
          Signed in as Master Admin
        </label>
      </div>

      <div>
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" asChild>
          <Link to="/applications">
            <ArrowLeft aria-hidden="true" />
            Applications
          </Link>
        </Button>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight break-words sm:text-4xl">
          {editing ? s.draft.name : "New application"}
        </h1>
        {!editing && (
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            Register an app that signs people in with PoliNetwork, or a service that calls
            PoliNetwork APIs. Credentials appear once you save.
          </p>
        )}
      </div>

      {saved && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4 text-sm"
        >
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-medium">
              Prototype: {editing ? "would save" : "would create"} “{saved.name}”
            </p>
            <p className="font-mono text-xs break-words text-muted-foreground">
              credential={saved.credential} · grants={saved.grants || "none"} · scopes=
              {saved.scopes || "none"}
              {saved.serviceScopes && ` · client_credentials=${saved.serviceScopes}`} · resources=
              {saved.resources}
            </p>
          </div>
          <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={() => setSaved(null)}>
            <X aria-hidden="true" />
          </Button>
        </div>
      )}

      <Variant
        key={`${current}-${scenario}-${mountKey}`}
        mode={s.mode}
        initial={s.draft as OidcClientDraft}
        savedCredential={"saved" in s ? s.saved : undefined}
        apiAccess
        canGrantApiAccess={masterAdmin}
        onSubmit={(draft) => {
          setSaved(describeSave(draft));
          window.scrollTo({ top: 0 });
        }}
      />

      <nav
        ref={pickerRef}
        className="proto-picker"
        aria-label="Prototype variants"
        data-position={variants[current]!.name === "Settings" ? "top" : undefined}
      >
        <span ref={highlightRef} className="proto-picker-highlight" aria-hidden="true" />
        {variants.map((variant, i) => (
          <button
            key={variant.name}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            type="button"
            className="proto-picker-item"
            data-active={i === current ? "" : undefined}
            aria-current={i === current ? "true" : undefined}
            onClick={() => setActive(i)}
          >
            {variant.name}
          </button>
        ))}
      </nav>
    </div>
  );
}
