import { authClient } from "@/auth/client";
import { UserAvatar } from "./user-avatar";

export default function BetterAuthHeader() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return <div className="h-8 w-8 animate-pulse bg-neutral-100 dark:bg-neutral-800" />;
  }

  if (!session?.user) return null;

  return (
    <div className="flex items-center gap-2">
      <UserAvatar
        name={session.user.name}
        image={session.user.image}
        className="size-8 rounded-md bg-muted text-xs font-medium text-muted-foreground"
      />
      <button
        onClick={() => {
          void authClient.signOut();
        }}
        className="h-9 flex-1 border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
      >
        Sign out
      </button>
    </div>
  );
}
