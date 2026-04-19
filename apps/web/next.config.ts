import { config } from "dotenv";
import path from "node:path";
import type { NextConfig } from "next";

// Load the monorepo root .env so OAUTH_* and NEXT_PUBLIC_ACCOUNTS_URL are
// available without duplicating env files per app.
config({ path: path.resolve(__dirname, "../../.env") });

const nextConfig: NextConfig = {};

export default nextConfig;
