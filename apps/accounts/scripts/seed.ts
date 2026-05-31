import { config } from 'dotenv';
import path from 'node:path';

config({ path: path.resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@organizer-hub/db/accounts';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    // organizer-member — consumer surface on port 3000.
    const member = await prisma.oAuthClient.upsert({
      where: { clientId: 'organizer-member' },
      update: {
        redirectUris: ['http://localhost:3000/auth/callback'],
        postLogoutRedirectUris: ['http://localhost:3000/'],
        scopes: ['openid', 'profile', 'email', 'offline_access'],
        grantTypes: ['authorization_code', 'refresh_token'],
        responseTypes: ['code'],
        isPublic: true,
        pkceRequired: true,
      },
      create: {
        clientId: 'organizer-member',
        name: 'OrganizerHub Member',
        clientSecret: null,
        redirectUris: ['http://localhost:3000/auth/callback'],
        postLogoutRedirectUris: ['http://localhost:3000/'],
        grantTypes: ['authorization_code', 'refresh_token'],
        responseTypes: ['code'],
        scopes: ['openid', 'profile', 'email', 'offline_access'],
        isPublic: true,
        pkceRequired: true,
      },
    });
    console.log(`seeded OAuth client: ${member.clientId} (${member.name})`);

    // organizer-admin — organizer surface on port 3003. Separate client so
    // member and admin sessions stay isolated in the same browser.
    const admin = await prisma.oAuthClient.upsert({
      where: { clientId: 'organizer-admin' },
      update: {
        redirectUris: ['http://localhost:3003/auth/callback'],
        postLogoutRedirectUris: ['http://localhost:3003/'],
        scopes: ['openid', 'profile', 'email', 'offline_access'],
        grantTypes: ['authorization_code', 'refresh_token'],
        responseTypes: ['code'],
        isPublic: true,
        pkceRequired: true,
      },
      create: {
        clientId: 'organizer-admin',
        name: 'OrganizerHub Admin',
        clientSecret: null,
        redirectUris: ['http://localhost:3003/auth/callback'],
        postLogoutRedirectUris: ['http://localhost:3003/'],
        grantTypes: ['authorization_code', 'refresh_token'],
        responseTypes: ['code'],
        scopes: ['openid', 'profile', 'email', 'offline_access'],
        isPublic: true,
        pkceRequired: true,
      },
    });
    console.log(`seeded OAuth client: ${admin.clientId} (${admin.name})`);

    // Idempotent cleanup of the old single-app client from before the split.
    const deleted = await prisma.oAuthClient.deleteMany({
      where: { clientId: 'organizer-web' },
    });
    if (deleted.count > 0) {
      console.log('deleted obsolete OAuth client: organizer-web');
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
