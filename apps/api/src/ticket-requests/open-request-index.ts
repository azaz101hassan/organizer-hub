import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Name of the hand-written partial unique index that enforces one open
// (PENDING/APPROVED) request per (user, tier). Referenced by the migration,
// the drift guard below, and the tests so they can never disagree.
export const ONE_OPEN_REQUEST_INDEX = 'ticket_requests_one_open_per_user_type';

// Pure drift assertion: throws if the required partial index is absent from the
// supplied list of index names. Split from the DB query so it is unit-testable
// without a database.
export function assertOpenRequestIndexPresent(indexNames: string[]): void {
  if (!indexNames.includes(ONE_OPEN_REQUEST_INDEX)) {
    throw new Error(
      `Required partial unique index "${ONE_OPEN_REQUEST_INDEX}" is missing. ` +
        `Prisma 6.x cannot represent it in schema.prisma, so a migrate dev / db ` +
        `push may have dropped it — re-apply migration ` +
        `add_ticket_request_partial_unique. The one-open-request-per-tier ` +
        `invariant (R25 / AE17) is unprotected until it is restored.`,
    );
  }
}

// Boot-time guard: fails app startup (and every CI e2e boot) if the partial
// index has drifted away. A comment header in the migration alone does not
// prevent a silent DROP on a later `migrate dev`; this does.
@Injectable()
export class OpenRequestIndexCheck implements OnModuleInit {
  private readonly logger = new Logger(OpenRequestIndexCheck.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    const rows = await this.prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'ticket_requests'
    `;
    assertOpenRequestIndexPresent(rows.map((r) => r.indexname));
    this.logger.log(`Verified partial unique index ${ONE_OPEN_REQUEST_INDEX}`);
  }
}
