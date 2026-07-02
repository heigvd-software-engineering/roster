import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { BrandHeader } from "~/components/custom/brand-header";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { api, useApi } from "~/lib/api";

/** /classes/:id/confirm — sets the org's base repo permission to No access. */
export function ClassConfirmPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data } = useApi(api.api.classes);
  const cls = data?.classes.find((c) => c.id === id);
  const orgName = cls?.name ?? cls?.login ?? "this organization";

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.api.classes[":id"].confirm.$post({
        param: { id },
      });
      if (res.status === 200) {
        const body = await res.json();
        if (body.ok) {
          navigate("/");
          return;
        }
      }
      setError(
        "Couldn't set the permission — check the App has Administration access.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Stack gap="lg" align="start" justify="center" className="flex-1">
      <BrandHeader title={`Connect ${orgName}`} />
      <Text variant="subtitle" className="max-w-md">
        labs will set this organization's base repository permission to{" "}
        <strong>No access</strong>, so students only see repos they're granted.
      </Text>
      <Button size="lg" onClick={handleConfirm} disabled={submitting}>
        Set up & continue
      </Button>
      {error ? <Text variant="body2">{error}</Text> : null}
    </Stack>
  );
}
