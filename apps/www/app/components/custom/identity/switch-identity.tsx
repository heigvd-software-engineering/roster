import { LogOut, Unlink } from "lucide-react";
import { useRef, useState } from "react";
import { GithubIdentity } from "~/components/custom/identity/github-identity";
import { UserIdentity } from "~/components/custom/identity/user-identity";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useAuth } from "~/lib/auth-context";

/**
 * The top-right account control, keyed on the edu-ID (SWITCH) identity. Wraps
 * UserIdentity (always initials) as the trigger; the dropdown lists all edu-ID
 * affiliation emails and incorporates the linked GitHub account (GithubIdentity
 * + unlink) and Sign out. All data/actions come from the auth context.
 *
 * Opens on hover — Base UI's Menu has no hover-open prop, so we drive `open`
 * ourselves (short close delay to bridge the trigger→popup gap) while keeping
 * click/keyboard/Escape working.
 */
export function SwitchIdentity() {
  const { account, github, signOut, unlinkGithub } = useAuth();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openNow = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(true);
  };
  const closeSoon = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  if (!account) {
    return null;
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="rounded-md px-2 py-1 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        onMouseEnter={openNow}
        onMouseLeave={closeSoon}
      >
        {/* edu-ID identity: always initials (no avatarUrl passed). */}
        <UserIdentity name={account.name} subtitle={account.email} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-64"
        onMouseEnter={openNow}
        onMouseLeave={closeSoon}
      >
        <Stack gap="sm" className="px-1.5 py-1.5">
          <Text variant="overline">Emails</Text>
          <Stack gap="none">
            {account.affiliations.length > 0 ? (
              account.affiliations.map((email) => (
                <Text key={email} variant="body2">
                  {email}
                </Text>
              ))
            ) : (
              <Text variant="body2">{account.email}</Text>
            )}
          </Stack>
        </Stack>
        <DropdownMenuSeparator />
        <Stack gap="sm" className="px-1.5 py-1.5">
          <Text variant="overline">Linked GitHub</Text>
          <GithubIdentity />
        </Stack>
        {github && (
          <DropdownMenuItem
            variant="destructive"
            onClick={() => unlinkGithub()}
          >
            <Unlink />
            Unlink GitHub
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut()}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
