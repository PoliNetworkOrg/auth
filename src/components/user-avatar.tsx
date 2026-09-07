import { Avatar } from "radix-ui";
import { cn } from "cn";

export function UserAvatar({
  name,
  image,
  className,
}: {
  name: string;
  image?: string | null;
  className?: string;
}) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join("")
      .toUpperCase() || "U";
  return (
    <Avatar.Root
      className={cn(
        "relative flex size-full shrink-0 items-center justify-center overflow-hidden rounded-[inherit]",
        className,
      )}
    >
      {image && (
        <Avatar.Image
          key={image}
          src={image}
          alt=""
          referrerPolicy="no-referrer"
          className="size-full object-cover"
        />
      )}
      <Avatar.Fallback
        className="flex size-full items-center justify-center"
        aria-label={`${name}'s avatar`}
      >
        {initials}
      </Avatar.Fallback>
    </Avatar.Root>
  );
}
