import type { ReactNode } from "react";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

/** The overview band the phases below spell out in detail. `title` names what
 *  the band holds, since the entries read as definitions on one page and as
 *  principles on another. */
export function Axioms({
  title = "The principles",
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">{children}</div>
      </CardContent>
    </Card>
  );
}

type AxiomProps = {
  /** "A1" …, an index for entries that are referred to by number. Omitted when
   *  the name is the handle, as a defined word is. */
  marker?: string | undefined;
  name: string;
  children: ReactNode;
};

/** One entry: its name, optionally numbered, and a short body. */
export function Axiom({ marker, name, children }: AxiomProps) {
  return (
    <Stack gap="xs">
      <Text variant="label" className="font-semibold">
        {marker ? `${marker} · ${name}` : name}
      </Text>
      <Text variant="body2">{children}</Text>
    </Stack>
  );
}
