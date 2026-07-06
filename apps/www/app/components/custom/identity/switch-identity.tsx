import { LogOut, Monitor, Moon, Sun, Unlink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { GithubIdentity } from "~/components/custom/identity/github-identity";
import { UserIdentity } from "~/components/custom/identity/user-identity";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useAuth } from "~/contexts/auth-context";
import { useTheme } from "~/contexts/theme-context";
import type { Theme } from "~/lib/theme";

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
  const { user, affiliations, github, signOut, unlinkGithub } = useAuth();
  const { theme, setTheme } = useTheme();
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

  // Clear a pending close on unmount — otherwise it fires setOpen after the
  // component (and its state) is gone.
  useEffect(
    () => () => {
      if (closeTimer.current) {
        clearTimeout(closeTimer.current);
      }
    },
    [],
  );

  if (!user) {
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
        <UserIdentity name={user.name} subtitle={user.email} />
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
            {affiliations.length > 0 ? (
              affiliations.map((email) => (
                <Text key={email} variant="body2">
                  {email}
                </Text>
              ))
            ) : (
              <Text variant="body2">{user.email}</Text>
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
        <Stack gap="none" className="px-1.5 pt-1.5">
          <Text variant="overline">Theme</Text>
        </Stack>
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => setTheme(value as Theme)}
        >
          <DropdownMenuRadioItem value="light" closeOnClick={false}>
            <Sun />
            Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark" closeOnClick={false}>
            <Moon />
            Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system" closeOnClick={false}>
            <Monitor />
            System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut()}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
