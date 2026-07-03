import { useEffect, useRef, useState } from "react";
import { LabRow } from "~/components/custom/classes/lab-row";
import { UserAvatar } from "~/components/custom/identity/user-avatar";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import type { DummyLab } from "~/lib/dummy";

type ClassCardProps = {
  login: string;
  name: string | null;
  avatarUrl: string;
  joinToken: string;
  students: number;
  teachers: number;
  labs: DummyLab[];
};

/**
 * One connected class (GitHub org): identity + state + its labs. The card is a
 * solid, slightly-darker-than-white surface so the white inset labs list reads
 * as its own level. Member counts / labs are dummy for now (F5/F6), fed in by
 * the caller — see the `dummyClassMeta` spread in `pages/classes-page.tsx`.
 * The copy join link button is now live (F4), using the `joinToken` from the API.
 */
export function ClassCard({
  login,
  name,
  avatarUrl,
  joinToken,
  students,
  teachers,
  labs,
}: ClassCardProps) {
  const [copied, setCopied] = useState(false);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(copyResetTimer.current), []);

  async function copyJoinLink() {
    await navigator.clipboard.writeText(
      `${window.location.origin}/join/${joinToken}`,
    );
    setCopied(true);
    clearTimeout(copyResetTimer.current);
    copyResetTimer.current = setTimeout(() => setCopied(false), 2000);
  }
  return (
    <Card className="w-full gap-4 bg-muted p-5">
      <Row justify="between" wrap>
        <Row gap="sm">
          <UserAvatar name={name ?? login} src={avatarUrl} size="lg" />
          <Stack gap="none">
            <Text variant="body1" className="font-semibold">
              {name ?? login}
            </Text>
            <Text variant="body2">@{login}</Text>
          </Stack>
        </Row>
        <Row gap="sm" wrap>
          <Badge variant="secondary" className="font-normal">
            {students} students
          </Badge>
          <Badge variant="secondary" className="font-normal">
            {teachers} teachers
          </Badge>
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={copyJoinLink}
          >
            {copied ? "Copied ✓" : "Copy join link"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            disabled
            title="Coming soon"
          >
            Open ›
          </Button>
        </Row>
      </Row>

      {/* The labs list — a white inset panel against the muted card. */}
      <Stack
        gap="none"
        className="w-full rounded-lg border border-border bg-background px-4 py-1"
      >
        {labs.map((lab) => (
          <LabRow key={lab.id} lab={lab} />
        ))}
      </Stack>

      <Row>
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled
          title="Coming soon"
        >
          + Add a lab
        </Button>
      </Row>
    </Card>
  );
}
