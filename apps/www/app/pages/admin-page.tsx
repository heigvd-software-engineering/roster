import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { UserIdentity } from "~/components/custom/identity/user-identity";
import { Page } from "~/components/custom/layout/page";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Loading } from "~/components/custom/loading";
import { Text } from "~/components/custom/typography/text";
import { Badge } from "~/components/ui/badge";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { useAuth } from "~/contexts/auth-context";
import { api, useAction, useApi } from "~/lib/api";

/**
 * /admin — the SUPER-ADMIN zone (config-listed emails only; the API guard
 * is the boundary, this page just bounces non-admins). One job: grant or
 * revoke "can create classes" per SWITCH user. The list is every user row;
 * filtering is client-side (school scale).
 */
export function AdminPage() {
  const { isLoading: authLoading, isSuperAdmin } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!authLoading && !isSuperAdmin) navigate("/classes", { replace: true });
  }, [authLoading, isSuperAdmin, navigate]);

  const { data, isLoading, mutate } = useApi(api.api.admin.users);
  const { busy, act } = useAction(mutate);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const users = (data?.users ?? []).filter(
    (u) => !q || `${u.name} ${u.email}`.toLowerCase().includes(q),
  );

  if (!isSuperAdmin) return null;
  return (
    <Page>
      <Stack gap="lg" className="w-full max-w-2xl">
        <Stack gap="none">
          <Text variant="heading">Super admin</Text>
          <Text variant="subtitle">
            Who may create classes. Everything else is unaffected.
          </Text>
        </Stack>
        <Input
          placeholder="Filter by name or email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Loading loading={isLoading && !data} label="Loading users…">
          <Stack gap="sm" className="w-full">
            {users.map((u) => (
              <Row key={u.id} justify="between" className="w-full">
                <Row gap="sm">
                  <UserIdentity name={u.name} subtitle={u.email} />
                  {/* Config status, display only — super admin is NEVER
                      granted from the app (SUPER_ADMIN_EMAILS). */}
                  {u.isSuperAdmin ? (
                    <Badge variant="outline">Super admin</Badge>
                  ) : null}
                </Row>
                <Row gap="sm">
                  <Text variant="caption">Can create classes</Text>
                  {/* The toggle IS the grant row — the one condition the
                      gate checks, identical for everyone; admins flip
                      their own like anyone else's. */}
                  <Switch
                    checked={u.canCreateClasses}
                    disabled={busy}
                    aria-label={`${u.name} can create classes`}
                    onCheckedChange={(enabled) =>
                      act(() =>
                        api.api.admin.users[":id"]["class-creator"].$put({
                          param: { id: u.id },
                          json: { enabled },
                        }),
                      )
                    }
                  />
                </Row>
              </Row>
            ))}
            {users.length === 0 ? (
              <Text variant="body2">No users match.</Text>
            ) : null}
          </Stack>
        </Loading>
      </Stack>
    </Page>
  );
}
