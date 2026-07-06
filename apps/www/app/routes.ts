import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("classes", "routes/classes.tsx"),
  route("classes/:classId/labs/:labId", "routes/lab.tsx"),
  route("classes/:classId/labs/:labId/manage", "routes/lab-manage.tsx"),
  route("onboarding/github", "routes/onboarding.tsx"),
  route("classes/:id/confirm", "routes/class-confirm.tsx"),
  route("join/:token", "routes/join.tsx"),
] satisfies RouteConfig;
