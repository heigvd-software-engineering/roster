import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("onboarding/github", "routes/onboarding.tsx"),
] satisfies RouteConfig;
