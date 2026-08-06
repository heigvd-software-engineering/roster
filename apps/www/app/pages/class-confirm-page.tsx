import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Stack } from "~/components/custom/layout/stack";
import { Loading } from "~/components/custom/loading";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { api, useApi } from "~/lib/api";
import { useDocumentTitle } from "~/lib/title";

/** /classes/:id/confirm: locks the org to roster's policy, base repo
 *  permission No access and no member repository creation. */
export function ClassConfirmPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, error } = useApi(api.api.classes);
  const cls = data?.classes.find((c) => c.id === id);
  const orgName = cls?.name ?? cls?.login ?? "this organization";
  // One sentence for the heading and the tab: which organization is being
  // connected.
  const heading = `Connect ${orgName}`;
  useDocumentTitle(heading);

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
        "Couldn't apply the organization settings. Check that the App has Administration access.",
      );
    } catch {
      setSubmitError(
        "Something went wrong. Check your connection and try again.",
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
            Couldn't load this class. Refresh to retry.
          </Text>
        </Stack>
      ) : (
        <Stack gap="lg" align="start" justify="center" className="flex-1">
          <Text variant="title">{heading}</Text>
          <Text variant="subtitle" className="max-w-md">
            roster applies two settings to this organization. The base
            repository permission becomes <strong>No access</strong>, so
            students see only the repositories they're granted: their own
            assignment repositories, never other students' work and never the
            organization's private repositories. And{" "}
            <strong>member repository creation is turned off</strong>, so every
            student repository is created through roster, never directly on
            GitHub.
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
