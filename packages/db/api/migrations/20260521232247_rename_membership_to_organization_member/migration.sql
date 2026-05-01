-- Rename the Phase 2 user↔org role table (and its enum, indexes, FK) so the
-- term "Membership" can be reused later in its new platform-subscription
-- sense without collision. Data-preserving renames only — no DROP/CREATE.

ALTER TABLE "memberships" RENAME TO "organization_members";

ALTER TYPE "MembershipRole" RENAME TO "OrganizationRole";

ALTER INDEX "memberships_pkey" RENAME TO "organization_members_pkey";
ALTER INDEX "memberships_user_id_idx" RENAME TO "organization_members_user_id_idx";
ALTER INDEX "memberships_organization_id_user_id_key" RENAME TO "organization_members_organization_id_user_id_key";

ALTER TABLE "organization_members"
  RENAME CONSTRAINT "memberships_organization_id_fkey" TO "organization_members_organization_id_fkey";
