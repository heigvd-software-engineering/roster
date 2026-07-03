import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router";
import { UserAvatar } from "~/components/custom/identity/user-avatar";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Loading } from "~/components/custom/loading";
import { BrandHeader } from "~/components/custom/typography/brand-header";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { api } from "~/lib/api";

type Membership = "none" | "pending" | "active";
type ClassIdentity = { login: string; name: string | null; avatarUrl: string };

type JoinState =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "error" }
  | { kind: "ready"; cls: ClassIdentity; membership: Membership };

/**
 * /join/:token — the student side of the class join link (spec: F4 design).
 * A small explicit state machine (useApi is param-less GET only, and the
 * transitions here are bespoke): loading → ready(none|pending|active) with
 * invalid (404) and error (retry) terminals. Joining creates a PENDING GitHub
 * org invite; acceptance is native on GitHub, so the page offers the
 * invitation link in a new tab plus a live "Check my enrollment" re-read.
 */
export function JoinPage() {
  const { token = "" } = useParams();
  const [state, setState] = useState<JoinState>({ kind: "loading" });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const res = await api.api.join[":token"].$get({ param: { token } });
      if (res.status === 404) {
        setState({ kind: "invalid" });
        return;
      }
      if (!res.ok) {
        setState({ kind: "error" });
        return;
      }
      const body = await res.json();
      setState({ kind: "ready", cls: body.class, membership: body.membership });
    } catch {
      setState({ kind: "error" });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function join(cls: ClassIdentity) {
    setSubmitting(true);
    try {
      const res = await api.api.join[":token"].$post({ param: { token } });
      if (!res.ok) {
        setState(res.status === 404 ? { kind: "invalid" } : { kind: "error" });
        return;
      }
      const body = await res.json();
      setState({ kind: "ready", cls, membership: body.membership });
    } catch {
      setState({ kind: "error" });
    } finally {
      setSubmitting(false);
    }
  }

  if (state.kind === "loading") {
    return <Loading loading className="flex-1" />;
  }

  if (state.kind === "invalid") {
    return (
      <Shell title="Invalid link">
        <Text variant="subtitle" className="max-w-md">
          This join link isn't valid — ask your teacher for a fresh one.
        </Text>
      </Shell>
    );
  }

  if (state.kind === "error") {
    return (
      <Shell title="Something went wrong">
        <Text variant="error">Couldn't load this join link.</Text>
        <Button size="lg" onClick={() => void load()}>
          Retry
        </Button>
      </Shell>
    );
  }

  const { cls, membership } = state;
  const className = cls.name ?? cls.login;

  return (
    <Shell title={membership === "active" ? "Enrolled" : `Join ${className}`}>
      <a
        href={`https://github.com/${cls.login}`}
        target="_blank"
        rel="noreferrer"
        className="-m-2 rounded-md p-2 transition-colors hover:bg-muted"
      >
        <Row gap="sm">
          <UserAvatar name={className} src={cls.avatarUrl} size="lg" />
          <Stack gap="none">
            <Text variant="body1" className="font-semibold">
              {className}
            </Text>
            <Text variant="body2">@{cls.login}</Text>
          </Stack>
        </Row>
      </a>

      {membership === "none" ? (
        <>
          <Text variant="subtitle" className="max-w-md">
            You've been invited to join this class. Joining makes you a member
            of its GitHub organization.
          </Text>
          <Button size="lg" disabled={submitting} onClick={() => join(cls)}>
            Join class
          </Button>
        </>
      ) : membership === "pending" ? (
        <>
          <Text variant="subtitle" className="max-w-md">
            Almost there — accept your invitation on GitHub, then come back and
            check your enrollment.
          </Text>
          <Row gap="sm" wrap>
            <Button
              size="lg"
              render={
                <a
                  href={`https://github.com/orgs/${cls.login}/invitation`}
                  target="_blank"
                  rel="noreferrer"
                />
              }
            >
              Open the invitation on GitHub
            </Button>
            <Button size="lg" variant="outline" onClick={() => void load()}>
              Check my enrollment
            </Button>
          </Row>
        </>
      ) : (
        <Text variant="subtitle" className="max-w-md">
          You're enrolled in {className}.
        </Text>
      )}
    </Shell>
  );
}

/** The hero layout shared by all join-page states (login/confirm family). */
function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack gap="lg" align="start" justify="center" className="flex-1">
      <BrandHeader title={title} />
      {children}
    </Stack>
  );
}
