import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";

/**
 * BrandHeader — the roster identity block: a monospace eyebrow, a bold title, and
 * the Swiss-red rule. Shared by the login and authed-home views.
 *   - size="hero" for the landing wordmark ("roster")
 *   - size="page" for in-app page titles (e.g. the user's name)
 */
type BrandHeaderProps = {
  title: string;
  size?: "hero" | "page";
};

export function BrandHeader({ title, size = "page" }: BrandHeaderProps) {
  return (
    <Stack gap="md">
      <Text variant="overline">HEIG-VD — Software Engineering</Text>
      <Text variant={size === "hero" ? "hero" : "title"}>{title}</Text>
      <div className="h-1 w-16 bg-brand" />
    </Stack>
  );
}
