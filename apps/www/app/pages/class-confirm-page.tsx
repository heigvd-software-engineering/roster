import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Stack } from "~/components/custom/layout/stack";
import { Loading } from "~/components/custom/loading";
import { BrandHeader } from "~/components/custom/typography/brand-header";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { api, useApi } from "~/lib/api";

/** /classes/:id/confirm — locks the org to roster's policy: base repo
 *  permission No access + no member repository creation. */
export function ClassConfirmPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, error } = useApi(api.api.classes);
  const cls = data?.classes.find((c) => c.id === id);
  const orgName = cls?.name ?? cls?.login ?? "this organization";

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleConfirm() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await api.api.classes[":id"].confirm.$post({
        param: { id },
      });
      if (res.status === 200) {
        const body = await res.json();
        if (body.ok) {
          navigate("/classes");
          return;
        }
      }
      setSubmitError(
        "Couldn't apply the organization settings — check the App has Administration access.",
      );
    } catch {
      setSubmitError(
        "Something went wrong — check your connection and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Loading loading={isLoading} className="flex-1">
      {error ? (
        <Stack gap="lg" align="start" justify="center" className="flex-1">
          <Text variant="error">
            Couldn't load this class — refresh to retry.
          </Text>
        </Stack>
      ) : (
        <Stack gap="lg" align="start" justify="center" className="flex-1">
          <BrandHeader title={`Connect ${orgName}`} />
          <Text variant="subtitle" className="max-w-md">
            roster will apply two settings to this organization: the base
            repository permission becomes <strong>No access</strong>, so
            students only see repos they're granted — their own lab repos, never
            other students' work or the organization's private repos — and{" "}
            <strong>member repository creation is turned off</strong>, so every
            student repository is born through labs, never directly on GitHub.
          </Text>
          <Button
            size="lg"
            title="Lock the organization's settings and finish the class setup"
            onClick={handleConfirm}
            disabled={submitting}
          >
            Set up & continue
          </Button>
          {submitError ? <Text variant="error">{submitError}</Text> : null}
        </Stack>
      )}
    </Loading>
  );
}
