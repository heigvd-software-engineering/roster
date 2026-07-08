import { UserAvatar } from "~/components/custom/identity/user-avatar";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";

type OrgIdentityProps = {
  name: string;
  login: string;
  avatarUrl?: string | null;
  /** "lg" = class-card masthead (larger semibold name); "default" matches
   *  UserIdentity's scale for side-by-side contexts (e.g. the join page). */
  size?: "default" | "lg";
};

/**
 * A GitHub organization's identity: square avatar (orgs are rounded squares,
 * people are circles — GitHub's own convention) + name over the mono @login.
 * The org-flavored sibling of UserIdentity.
 */
export function OrgIdentity({
  name,
  login,
  avatarUrl,
  size = "default",
}: OrgIdentityProps) {
  return (
    <Row gap="sm" align="center">
      <UserAvatar name={name} src={avatarUrl} size="lg" shape="square" />
      <Stack gap="none">
        <Text
          variant={size === "lg" ? "body1" : "label"}
          as="span"
          className="font-semibold"
        >
          {name}
        </Text>
        <Text variant="caption" as="span" className="font-mono">
          @{login}
        </Text>
      </Stack>
    </Row>
  );
}
