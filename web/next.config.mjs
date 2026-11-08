import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const rootEnv = path.join(repoRoot, ".env");
if (fs.existsSync(rootEnv)) {
  const lines = fs.readFileSync(rootEnv, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equals = trimmed.indexOf("=");
    if (equals === -1) continue;

    const key = trimmed.slice(0, equals).trim();
    let value = trimmed.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] ??= value;
  }
}

const localBuild = process.env.APP_BUILD_TARGET === "local";
// Vercel builds and serves the app its own way; the standalone bundle is for
// the Docker image only, and asking for both is how a deploy gets confusing.
const onVercel = process.env.VERCEL === "1";
/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    // Only /embed/* may be framed by other sites (public/embed.js). Every
    // other page refuses, so it can't be used for clickjacking.
    const noFraming = [
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
    ];
    return [
      {
        source: "/((?!embed/|embed.js|sw.js).*)",
        headers: noFraming,
      },
      {
        source: "/embed.js",
        headers: [{ key: "Cache-Control", value: "public, max-age=300" }],
      },
      {
        source: "/i/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'",
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/dashboard/links",
        destination: "/links",
        permanent: true,
      },
    ];
  },
  // Emit a self-contained server bundle for the Docker runtime image. Combined
  // with outputFileTracingRoot (the monorepo root), the standalone output lands
  // at web/.next/standalone/web/server.js with node_modules traced from the
  // repo root — see the Dockerfile runner stage.
  output: localBuild || onVercel ? undefined : "standalone",
  distDir: localBuild ? ".next-local" : ".next",
  outputFileTracingRoot: repoRoot,
  reactStrictMode: true,
  // Bundling these breaks their dynamic requires: pg's optional native
  // bindings, the Bedrock SDK's AWS credential chain, and css-tree's
  // `require("../data/patch.json")`.
  //
  // css-tree is the cautionary one. Bundled, its *code* is inlined and the
  // build is green, but the JSON it reads at runtime is not a module the
  // tracer can see — so the package throws `Cannot find module` the first
  // time it is loaded, in the deployment only. Everything that imports the
  // storefront sanitiser goes with it, which is the whole tRPC router: the
  // API answered 500 to every call while every test passed and every local
  // build worked. Left external, the tracer copies the package whole.
  serverExternalPackages: ["pg", "@anthropic-ai/bedrock-sdk", "css-tree"],
  // Belt and braces for the same bug. `serverExternalPackages` is the fix,
  // but it was verified against the standalone output and Vercel does not
  // build that — it traces its own way. Naming the file outright costs
  // nothing and does not depend on which tracer runs.
  outputFileTracingIncludes: {
    "/api/**": [
      "../node_modules/.pnpm/css-tree@*/node_modules/css-tree/data/**",
    ],
    "/**": ["../node_modules/.pnpm/css-tree@*/node_modules/css-tree/data/**"],
  },
  // Turbopack runs `next dev` (see the dev script) and ignores the webpack
  // block below, so the one alias that matters is repeated here: Privy pulls
  // in a Solana package this app never uses.
  turbopack: {
    resolveAlias: {
      "@farcaster/mini-app-solana": { browser: "./src/lib/empty.ts" },
    },
  },
  // `next build` still uses webpack.
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...config.resolve.alias,
      "@farcaster/mini-app-solana": false,
    };
    config.resolve.fallback = {
      ...config.resolve.fallback,
      "@farcaster/mini-app-solana": false,
    };

    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      { module: /@farcaster\/mini-app-solana/ },
      { module: /@privy-io\/react-auth/ },
      /Critical dependency: the request of a dependency is an expression/,
    ];

    return config;
  },
};

export default nextConfig;
