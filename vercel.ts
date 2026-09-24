import type { VercelConfig } from "@vercel/config/v1";

// Deploys run through Vercel's Git integration: every push to `main` is a production deploy
// (Convex + Next.js), every PR gets a preview. CI (.github/workflows/ci.yml) gates merges.
const config: VercelConfig = {
  framework: "nextjs",
  buildCommand: "bash scripts/vercel-build.sh",
};

export default config;
