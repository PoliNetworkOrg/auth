import type { ComponentType } from "react";
import { BadgeCheck, Building2, Crown, Fingerprint, GraduationCap, Send } from "lucide-react";
import { cn } from "cn";
import { type UserTrait, USER_TRAITS } from "@/auth/users";
import { GoogleIcon } from "@/components/google-icon";
import { Badge } from "@/components/ui/badge";

export const TRAIT_ICONS: Record<UserTrait, ComponentType<{ className?: string }>> = {
  socio: BadgeCheck,
  direttivo: Crown,
  student: GraduationCap,
  telegram: Send,
  google: GoogleIcon,
  polinetwork: Building2,
  passkey: Fingerprint,
};

export const STATUS_TRAITS = USER_TRAITS.filter(
  (trait) => trait.key === "socio" || trait.key === "direttivo" || trait.key === "student",
);

export const SIGN_IN_TRAITS = USER_TRAITS.filter(
  (trait) => trait.key === "google" || trait.key === "polinetwork" || trait.key === "passkey",
);

/** Socio, Direttivo, and Student, for whichever of them the person holds. */
export function StatusBadges({
  held,
  className,
}: {
  held: (trait: UserTrait) => boolean;
  className?: string;
}) {
  const shown = STATUS_TRAITS.filter((trait) => held(trait.key));
  if (!shown.length) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {shown.map((trait) => {
        const Icon = TRAIT_ICONS[trait.key];
        return (
          <Badge
            key={trait.key}
            title={trait.description}
            className={cn(
              "py-0.5",
              trait.key === "student"
                ? "border-transparent bg-secondary text-secondary-foreground"
                : "border-primary/30 bg-primary/10 text-primary",
            )}
          >
            <Icon className="size-3" aria-hidden="true" />
            {trait.label}
          </Badge>
        );
      })}
    </div>
  );
}

/** One icon per way the person can sign in, dimmed when they cannot use it. */
export function SignInIcons({ held }: { held: (trait: UserTrait) => boolean }) {
  return (
    <ul className="flex items-center gap-2">
      {SIGN_IN_TRAITS.map((trait) => {
        const Icon = TRAIT_ICONS[trait.key];
        const has = held(trait.key);
        return (
          <li
            key={trait.key}
            title={has ? trait.description : `No ${trait.label.toLowerCase()}`}
            className={cn("flex", has ? "text-foreground" : "text-muted-foreground/30 grayscale")}
          >
            <Icon className="size-4" aria-hidden="true" />
            <span className="sr-only">
              {trait.label}: {has ? "yes" : "no"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
