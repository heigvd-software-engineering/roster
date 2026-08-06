import type { ReactNode } from "react";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

/** The principles band, the overview the phases below spell out in detail. */
export function Axioms({ children }: { children: ReactNode }) {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>The principles</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">{children}</div>
      </CardContent>
    </Card>
  );
}

type AxiomProps = {
  /** "A1" …, the principle's index. */
  marker: string;
  name: string;
  children: ReactNode;
};

/** One principle: its index, its name, one-line body. */
export function Axiom({ marker, name, children }: AxiomProps) {
  return (
    <Stack gap="xs">
      <Text variant="label" className="font-semibold">
        {marker} — {name}
      </Text>
      <Text variant="body2">{children}</Text>
    </Stack>
  );
}
