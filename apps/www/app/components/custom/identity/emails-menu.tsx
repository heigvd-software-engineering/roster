import { ChevronDown } from "lucide-react";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";

/**
 * The email menu: a chevron that reveals a person's professional email —
 * `user.email`, the identity email (HES-SO audience). A SIBLING of
 * UserIdentity, never inside it — identity rows stay plain display (they
 * render inside buttons in pickers), and call sites cluster this with their
 * other per-row actions (remove ×). Renders nothing when there is no email
 * (the person never signed in to roster).
 */
export function EmailsMenu({
  name,
  email,
}: {
  /** Whose email — names the button for screen readers. */
  name: string;
  email: string | null;
}) {
  if (!email) return null;
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            type="button"
            aria-label={`Show ${name}'s emails`}
          />
        }
      >
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto min-w-52 p-2">
        <Text variant="caption" as="span">
          {email}
        </Text>
      </PopoverContent>
    </Popover>
  );
}
