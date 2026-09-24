import type { MetadataRoute } from "next";
import { THEME_COLORS } from "@/lib/theme";

// Served at /manifest.webmanifest and linked automatically. iOS uses apple-icon.png + appleWebApp
// metadata from the root layout instead of the manifest icons.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app",
    name: "LCF Todos",
    short_name: "LCF Todos",
    description: "Tareas diarias y semanales para tu equipo.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: THEME_COLORS.light,
    theme_color: THEME_COLORS.light,
    categories: ["productivity"],
    icons: [
      { src: "/icons/lcf-todos-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/lcf-todos-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/lcf-todos-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/lcf-todos-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/lcf-todos.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    shortcuts: [
      { name: "Hoy", url: "/app", icons: [{ src: "/icons/lcf-todos-192.png", sizes: "192x192" }] },
      { name: "Proyectos", url: "/app/projects", icons: [{ src: "/icons/lcf-todos-192.png", sizes: "192x192" }] },
    ],
  };
}
