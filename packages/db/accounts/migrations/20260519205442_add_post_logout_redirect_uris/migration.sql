-- AlterTable
ALTER TABLE "oauth_clients" ADD COLUMN     "post_logout_redirect_uris" TEXT[] DEFAULT ARRAY[]::TEXT[];
