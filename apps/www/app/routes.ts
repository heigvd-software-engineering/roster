import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("classes", "routes/classes.tsx"),
  route("rules", "routes/rules.tsx"),
  route("connect-assistant", "routes/connect-assistant.tsx"),
  route("classes/connect-failed", "routes/connect-failed.tsx"),
  route("admin", "routes/admin.tsx"),
  route("classes/:classId/assignments/:assignmentId", "routes/assignment.tsx"),
  route(
    "classes/:classId/assignments/:assignmentId/manage",
    "routes/assignment-manage.tsx",
  ),
  route("onboarding/github", "routes/onboarding.tsx"),
  // Must equal `consentPage` in the API auth config (apps/api/src/lib/auth/config.ts).
  route("oauth/consent", "routes/oauth-consent.tsx"),
  route("classes/:id/confirm", "routes/class-confirm.tsx"),
  route("classes/:id/reconcile", "routes/reconcile.tsx"),
  route("join/:token", "routes/join.tsx"),
] satisfies RouteConfig;
