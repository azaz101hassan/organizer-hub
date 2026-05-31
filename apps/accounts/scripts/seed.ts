import { config } from 'dotenv';
import path from 'node:path';

config({ path: path.resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@organizer-hub/db/accounts';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const client = await prisma.oAuthClient.upsert({
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
    console.log(`seeded OAuth client: ${client.clientId} (${client.name})`);
    console.log(`  redirect_uris: ${client.redirectUris.join(', ')}`);
    console.log(`  scopes:        ${client.scopes.join(' ')}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
