import type { Adapter, AdapterPayload } from 'oidc-provider';
import type { PrismaClient } from '@organizer-hub/db/accounts';

/**
 * Builds an Adapter class bound to a Prisma client. oidc-provider constructs one
 * Adapter instance per model name (Session, AccessToken, AuthorizationCode, etc.).
 * We store every model in a single OidcPayload table, keyed by "${name}:${id}".
 */
export function createPrismaAdapter(prisma: PrismaClient): { new (name: string): Adapter } {
  return class PrismaAdapter implements Adapter {
    constructor(private readonly name: string) {}

    private rowId(id: string): string {
      return `${this.name}:${id}`;
    }

    async upsert(id: string, payload: AdapterPayload, expiresIn?: number): Promise<void> {
      const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;
      const row = {
        type: this.name,
        payload: payload as unknown as object,
        grantId: payload.grantId ?? null,
        userCode: payload.userCode ?? null,
        uid: payload.uid ?? null,
        expiresAt,
      };
      await prisma.oidcPayload.upsert({
        where: { id: this.rowId(id) },
        create: { id: this.rowId(id), ...row },
        update: { ...row, consumedAt: null },
      });
    }

    async find(id: string): Promise<AdapterPayload | undefined> {
      const row = await prisma.oidcPayload.findUnique({ where: { id: this.rowId(id) } });
      if (!row) return undefined;
      if (row.expiresAt && row.expiresAt < new Date()) return undefined;
      const payload = row.payload as AdapterPayload;
      if (row.consumedAt) {
        (payload as AdapterPayload & { consumed: number }).consumed = Math.floor(
          row.consumedAt.getTime() / 1000,
        );
      }
      return payload;
    }

    async findByUserCode(userCode: string): Promise<AdapterPayload | undefined> {
      const row = await prisma.oidcPayload.findUnique({ where: { userCode } });
      if (!row) return undefined;
      if (row.expiresAt && row.expiresAt < new Date()) return undefined;
      return row.payload as AdapterPayload;
    }

    async findByUid(uid: string): Promise<AdapterPayload | undefined> {
      const row = await prisma.oidcPayload.findUnique({ where: { uid } });
      if (!row) return undefined;
      if (row.expiresAt && row.expiresAt < new Date()) return undefined;
      return row.payload as AdapterPayload;
    }

    async consume(id: string): Promise<void> {
      await prisma.oidcPayload.update({
        where: { id: this.rowId(id) },
        data: { consumedAt: new Date() },
      });
    }

    async destroy(id: string): Promise<void> {
      await prisma.oidcPayload.delete({ where: { id: this.rowId(id) } }).catch(() => {
        // already gone — oidc-provider tolerates this
      });
    }

    async revokeByGrantId(grantId: string): Promise<void> {
      await prisma.oidcPayload.deleteMany({ where: { grantId } });
    }
  };
}
