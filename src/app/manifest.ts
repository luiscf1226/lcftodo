import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LCF Todos",
    short_name: "LCF Todos",
    description: "Daily and weekly todos for your team.",
    start_url: "/app",
    display: "standalone",
    background_color: "#f7f7f8",
    theme_color: "#4f46e5",
    icons: [
      { src: "/icons/lcf-todos-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/lcf-todos-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/lcf-todos-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/lcf-todos-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
