import {
  BookOpen,
  LogOut,
  Monitor,
  Moon,
  ShieldCheck,
  Sun,
  Unlink,
} from "lucide-react";
import { useNavigate } from "react-router";
import { UserIdentity } from "~/components/custom/identity/user-identity";
import { Text } from "~/components/custom/typography/text";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useAuth } from "~/contexts/auth-context";
import { useTheme } from "~/contexts/theme-context";
import type { Theme } from "~/lib/theme";

/**
 * THE account control, top-right: the app's one edu-ID (SWITCH) identity, and
 * the menu hanging off it, holding the linked GitHub account (with unlink),
 * theme, and sign out. All data and actions come from the auth context.
 *
 * It is chrome, not an identity component: `UserIdentity` is what it renders.
 * The trigger passes no avatarUrl because edu-ID has no picture, so the app's
 * own user is initials, exactly like every linked student on a roster.
 */
export function MainSwitchIdentity() {
  const { user, github, isSuperAdmin, signOut, unlinkGithub } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();

  if (!user) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        title="Account menu — GitHub link, theme, sign out"
        className="rounded-md px-2 py-1 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/* edu-ID identity: always initials (no avatarUrl passed). */}
        <UserIdentity name={user.name} subtitle={user.email} size="lg" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-64">
        {/* Every label lives inside its group: Base UI's GroupLabel reads the
            group context to label it, and throws without one. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Linked GitHub</DropdownMenuLabel>
          <div className="px-2 pb-1.5">
            {/* Named by GitHub → it keeps its photo, unlike the edu-ID above. */}
            {github ? (
              <UserIdentity
                name={github.name ?? github.login}
                handle={github.login}
                avatarUrl={github.avatarUrl}
              />
            ) : (
              <Text variant="body2">Not linked</Text>
            )}
          </div>
          {github && (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => unlinkGithub()}
            >
              <Unlink />
              Unlink GitHub
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => setTheme(value as Theme)}
        >
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
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
        <DropdownMenuItem onClick={() => navigate("/rules")}>
          <BookOpen />
          How roster works
        </DropdownMenuItem>
        {/* The link is convenience; /api/admin's guard is the security. */}
        {isSuperAdmin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/admin")}>
              <ShieldCheck />
              Super admin
            </DropdownMenuItem>
          </>
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
