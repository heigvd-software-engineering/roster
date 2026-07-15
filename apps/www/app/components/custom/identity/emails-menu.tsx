import { ChevronDown } from "lucide-react";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";

/**
 * The affiliation-emails menu: a chevron that opens a floating list of a
 * person's professional emails. A SIBLING of UserIdentity, never inside it —
 * identity rows stay plain display (they render inside buttons in pickers),
 * and call sites cluster this with their other per-row actions (remove ×).
 * Renders nothing when there are no emails.
 */
export function EmailsMenu({
  name,
  emails,
}: {
  /** Whose emails — names the button for screen readers. */
  name: string;
  emails: string[];
}) {
  if (emails.length === 0) return null;
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
        <Stack gap="xs">
          {emails.map((email) => (
            <Text key={email} variant="caption" as="span">
              {email}
            </Text>
          ))}
        </Stack>
      </PopoverContent>
    </Popover>
  );
}
