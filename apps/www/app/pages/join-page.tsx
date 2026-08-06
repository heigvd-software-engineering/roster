import type { InferResponseType } from "hono/client";
import { ArrowRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { EmailsMenu } from "~/components/custom/identity/emails-menu";
import { OrgIdentity } from "~/components/custom/identity/org-identity";
import { UserIdentity } from "~/components/custom/identity/user-identity";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Loading } from "~/components/custom/loading";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { useAuth } from "~/contexts/auth-context";
import { api } from "~/lib/api";

const MEMBERSHIPS = ["none", "pending", "active"] as const;
type Membership = (typeof MEMBERSHIPS)[number];
/** The preview's `class` field, inferred from the join endpoint, never
 *  hand-modeled (type-spine rule). */
type ClassIdentity = InferResponseType<
  (typeof api.api.join)[":token"]["$get"],
  200
>["class"];

type JoinState =
  | { kind: "loading" }
  | { kind: "invalid" }
  /** The link is fine; the class can't be reached from GitHub. Only a teacher
   *  can fix it, so tell the student that rather than blaming their link. */
  | { kind: "needs_reconcile" }
  | { kind: "error" }
  | {
      kind: "ready";
      cls: ClassIdentity;
      membership: Membership;
      /** GitHub org role when membership exists; "admin" = owner (teacher). */
      role: string | null;
    };

/** Narrow an API value to a known membership. Anything else is an error
 *  state, never silently rendered as "enrolled". */
function asMembership(value: unknown): Membership | null {
  return MEMBERSHIPS.includes(value as Membership)
    ? (value as Membership)
    : null;
}

/**
 * /join/:token: the student side of the class join link (spec: F4 design).
 * A small explicit state machine (useApi is param-less GET only, and the
 * transitions here are bespoke): loading → ready(none|pending|active) with
 * invalid (404) and error (retry) terminals. Joining creates a pending GitHub
 * org invite; acceptance is native on GitHub, so the page offers the
 * invitation link in a new tab plus a live "Check my enrollment" re-read.
 */
export function JoinPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const { github, user } = useAuth();
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
      if (res.status === 409) {
        setState({ kind: "needs_reconcile" });
        return;
      }
      if (!res.ok) {
        setState({ kind: "error" });
        return;
      }
      const body = await res.json();
      const membership = asMembership(body.membership);
      if (!membership) {
        setState({ kind: "error" });
        return;
      }
      setState({
        kind: "ready",
        cls: body.class,
        membership,
        role: body.role ?? null,
      });
    } catch {
      setState({ kind: "error" });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  /** The preview is a pure read, so accepting the GitHub invite records
   *  nothing by itself. This is the student saying "I've accepted": an explicit
   *  action, not a page-load effect, so a failure is visible and retryable. */
  async function finishJoining(then?: () => void) {
    setSubmitting(true);
    try {
      const res = await api.api.join[":token"].confirm.$post({
        param: { token },
      });
      if (!res.ok) {
        if (res.status === 409) setState({ kind: "needs_reconcile" });
        else setState({ kind: "error" });
        return;
      }
      then ? then() : await load();
    } catch {
      setState({ kind: "error" });
    } finally {
      setSubmitting(false);
    }
  }

  async function join(cls: ClassIdentity) {
    setSubmitting(true);
    try {
      const res = await api.api.join[":token"].$post({ param: { token } });
      if (!res.ok) {
        if (res.status === 404) setState({ kind: "invalid" });
        else if (res.status === 409) setState({ kind: "needs_reconcile" });
        else setState({ kind: "error" });
        return;
      }
      const body = await res.json();
      const membership = asMembership(body.membership);
      if (!membership) {
        setState({ kind: "error" });
        return;
      }
      setState({ kind: "ready", cls, membership, role: body.role ?? null });
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

  if (state.kind === "needs_reconcile") {
    return (
      <Shell title="This class needs attention">
        <Text variant="subtitle" className="max-w-md">
          Your link is fine, but roster can't reach this class on GitHub right
          now. Ask your teacher to open the class and reconcile it — then try
          again.
        </Text>
        <Button
          size="lg"
          title="Try this join link again"
          onClick={() => void load()}
        >
          Try again
        </Button>
      </Shell>
    );
  }

  if (state.kind === "error") {
    return (
      <Shell title="Something went wrong">
        <Text variant="error">Couldn't load this join link.</Text>
        <Button
          size="lg"
          title="Try loading this join link again"
          onClick={() => void load()}
        >
          Retry
        </Button>
      </Shell>
    );
  }

  const { cls, membership, role } = state;
  const className = cls.name ?? cls.login;
  const isOwner = membership === "active" && role === "admin";

  return (
    <Shell
      title={
        isOwner
          ? "This is your class"
          : membership === "active"
            ? "Enrolled"
            : `Join ${className}`
      }
    >
      {/* You → the class: the acting GitHub identity on the left. With
          account switching (e.g. teacher vs student test accounts), the
          membership shown below is meaningless without it. */}
      <Row gap="md" align="center" wrap>
        {github ? (
          <>
            {/* Named by GitHub, so it wears the GitHub photo: the point is to
                catch an account swap before you join as the wrong user. */}
            <UserIdentity
              name={github.name ?? github.login}
              handle={github.login}
              avatarUrl={github.avatarUrl}
              size="lg"
            />
            <EmailsMenu
              name={github.name ?? github.login}
              email={user?.email ?? null}
            />
            <ArrowRightIcon
              aria-label="joins"
              className="size-5 text-muted-foreground"
            />
          </>
        ) : null}
        {/* This link sits straight on the muted page, so hovering lifts it to
            the card surface; the usual muted hover would be invisible. */}
        <a
          href={`https://github.com/${cls.login}`}
          target="_blank"
          rel="noreferrer"
          className="-m-2 rounded-md p-2 hover:bg-card"
        >
          <OrgIdentity
            name={className}
            login={cls.login}
            avatarUrl={cls.avatarUrl}
          />
        </a>
      </Row>

      {membership === "none" ? (
        <>
          <Text variant="subtitle" className="max-w-md">
            You've been invited to join this class. Joining makes you a member
            of its GitHub organization.
          </Text>
          <Button
            size="lg"
            disabled={submitting}
            title="Request to join — you'll get a GitHub organization invitation"
            onClick={() => join(cls)}
          >
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
              title="Opens your invitation on GitHub in a new tab"
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
            <Button
              size="lg"
              variant="outline"
              disabled={submitting}
              title="Check GitHub for your accepted invitation"
              onClick={() => void finishJoining()}
            >
              {submitting ? "Checking…" : "Check my enrollment"}
            </Button>
          </Row>
        </>
      ) : isOwner ? (
        <>
          <Text variant="subtitle" className="max-w-md">
            You're an owner of this organization — this join link is for
            students.
          </Text>
          <Button
            size="lg"
            title="Open your class list"
            render={<Link to="/classes" />}
          >
            Go to your classes
          </Button>
        </>
      ) : (
        <>
          <Text variant="subtitle" className="max-w-md">
            You're enrolled in {className}.
          </Text>
          <Button
            size="lg"
            disabled={submitting}
            title="Record your enrolment and open your class list"
            onClick={() => void finishJoining(() => navigate("/classes"))}
          >
            {submitting ? "Finishing…" : "Go to your classes"}
          </Button>
        </>
      )}
    </Shell>
  );
}

/** The hero layout shared by all join-page states (login/confirm family). */
function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack gap="lg" align="start" justify="center" className="flex-1">
      <Text variant="title">{title}</Text>
      {children}
    </Stack>
  );
}
