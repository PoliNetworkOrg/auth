import { CircleQuestionMark, Crown, KeyRound, type LucideProps, Plus, Users } from "lucide-react";
import { cn } from "cn";

/*
 * The eRBACo designs draw lucide's glyphs with their own line widths, given in pixels at the size
 * each icon renders. `absoluteStrokeWidth` keeps them at those pixels, which is why every icon
 * here takes a fixed `size` rather than a size class.
 */

type IconProps = Omit<LucideProps, "size" | "strokeWidth" | "absoluteStrokeWidth">;

export function PermissionsIcon({ className, ...props }: IconProps) {
  // The design's key hole is a heavier dot than the outline around it.
  return (
    <KeyRound
      size={18}
      strokeWidth={1}
      absoluteStrokeWidth
      aria-hidden="true"
      className={cn("[&_circle]:[stroke-width:2.667]", className)}
      {...props}
    />
  );
}

export function MembersIcon(props: IconProps) {
  return <Users size={18} strokeWidth={1} absoluteStrokeWidth aria-hidden="true" {...props} />;
}

export function MasterAdminIcon(props: IconProps) {
  return <Crown size={42} strokeWidth={2} absoluteStrokeWidth aria-hidden="true" {...props} />;
}

export function HelpIcon(props: IconProps) {
  return (
    <CircleQuestionMark
      size={20}
      strokeWidth={1.5}
      absoluteStrokeWidth
      aria-hidden="true"
      {...props}
    />
  );
}

export function NewIcon(props: IconProps) {
  return <Plus size={16} strokeWidth={2} absoluteStrokeWidth aria-hidden="true" {...props} />;
}
