import { config } from "dotenv";
import path from "node:path";
import type { NextConfig } from "next";

// Load the monorepo root .env first (shared infra: DB URLs, Resend, etc.),
// then layer apps/admin/.env.local on top with override:true. The admin app
// reads HOUSE_ORG_ID at runtime via getHouseOrgId(); per-app .env.local is
// where that value lives.
config({ path: path.resolve(__dirname, "../../.env") });
config({ path: path.resolve(__dirname, ".env.local"), override: true });

const nextConfig: NextConfig = {};

export default nextConfig;
