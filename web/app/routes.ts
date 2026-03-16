import {
  type RouteConfig,
  index,
  layout,
  route,
} from "@react-router/dev/routes";

export default [
  // Public routes
  route("login", "routes/login.tsx"),
  route("setup", "routes/setup.tsx"),

  // Authenticated routes (wrapped in layout with sidebar)
  layout("routes/layout.tsx", [
    // Redirect root to dashboard
    index("routes/home.tsx"),
    route("dashboard", "routes/dashboard.tsx"),
    route("processes", "routes/processes.tsx"),
    route("docker", "routes/docker.tsx"),
    route("terminal", "routes/terminal.tsx"),
    route("files", "routes/files.tsx"),
  ]),
] satisfies RouteConfig;
