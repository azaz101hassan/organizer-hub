import { config } from 'dotenv';
import path from 'node:path';

// Root .env first (e.g. API_DATABASE_URL), then apps/api/.env.local layered
// on top without overriding. Matches the load order in apps/api/src/main.ts so
// the seed sees the same env the running api would.
config({ path: path.resolve(__dirname, '../../../.env') });
config({ path: path.resolve(__dirname, '../.env.local'), override: false });

import { PrismaClient, CoalitionStatus, CampaignStatus } from '@organizer-hub/db/api';

// Deterministic id so apps/admin/.env.local can reference this row directly
// once Phase E lands. Prisma accepts explicit values for @id @default(cuid())
// columns — the default only fires when the field is unset.
const HOUSE_ORG_ID = 'org_house_000000000000000001';
const HOUSE_ORG_NAME = 'House Organization';
const HOUSE_ORG_SLUG = 'house';
const HOUSE_ORG_CREATED_BY = 'system';

const DEFAULT_LABELS = [
  { slug: 'concerts', name: 'Concerts', sortOrder: 0 },
  { slug: 'workshops', name: 'Workshops', sortOrder: 1 },
  { slug: 'community', name: 'Community', sortOrder: 2 },
];

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.upsert({
      where: { id: HOUSE_ORG_ID },
      update: { name: HOUSE_ORG_NAME },
      create: {
        id: HOUSE_ORG_ID,
        name: HOUSE_ORG_NAME,
        slug: HOUSE_ORG_SLUG,
        createdBy: HOUSE_ORG_CREATED_BY,
      },
    });
    console.log(`seeded house organization: ${org.id} (${org.name})`);

    for (const d of DEFAULT_LABELS) {
      const label = await prisma.eventLabel.upsert({
        where: {
          organizationId_slug: {
            organizationId: HOUSE_ORG_ID,
            slug: d.slug,
          },
        },
        update: { name: d.name, sortOrder: d.sortOrder },
        create: { ...d, organizationId: HOUSE_ORG_ID },
      });
      console.log(`  - label: ${label.slug} (${label.name})`);
    }

    const generalCoalition = await prisma.coalition.upsert({
      where: { organizationId_slug: { organizationId: HOUSE_ORG_ID, slug: 'general' } },
      update: { name: 'General', status: CoalitionStatus.ACTIVE },
      create: {
        organizationId: HOUSE_ORG_ID,
        slug: 'general',
        name: 'General',
        description: 'Year-round support for our work.',
        status: CoalitionStatus.ACTIVE,
        displayOrder: 0,
      },
    });
    console.log(`  - coalition: ${generalCoalition.slug} (${generalCoalition.name})`);

    const generalFund = await prisma.campaign.upsert({
      where: { organizationId_slug: { organizationId: HOUSE_ORG_ID, slug: 'general-fund' } },
      update: {
        name: 'General fund',
        status: CampaignStatus.ACTIVE,
        coalitionId: generalCoalition.id,
      },
      create: {
        organizationId: HOUSE_ORG_ID,
        coalitionId: generalCoalition.id,
        slug: 'general-fund',
        name: 'General fund',
        description: 'Support everything we do.',
        targetAmountCents: 1_000_000,
        currency: 'usd',
        status: CampaignStatus.ACTIVE,
        displayOrder: 0,
      },
    });
    console.log(`  - campaign: ${generalFund.slug} (${generalFund.name})`);

    console.log(`\nHOUSE_ORG_ID=${HOUSE_ORG_ID}`);
    console.log('Add this to apps/admin/.env.local in Phase E.');
  } finally {
    await prisma.$disconnect();
  }
}

void main();
