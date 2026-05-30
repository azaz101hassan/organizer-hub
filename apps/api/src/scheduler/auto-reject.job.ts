import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TicketRequestStatus } from '@organizer-hub/db/api';
import { Mailer } from '../mail/mailer';
import { PrismaService } from '../prisma/prisma.service';
import { WaitlistStream } from '../realtime/waitlist-stream';
import { CLOCK, type Clock } from './clock';

// Injectable so the batch size can be overridden in e2e (a tiny limit lets a
// 3-row fixture exercise the multi-loop path without seeding 100+ rows).
export const AUTO_REJECT_BATCH_LIMIT = Symbol('AUTO_REJECT_BATCH_LIMIT');

// Internal reason carried into the log line; not persisted (TicketRequest has
// no reason column) and not surfaced to the requester's rejection email.
const REASON = 'expired_at_event_start';

// One locked PENDING request plus the context needed to email + emit after the
// sweep transaction commits. snake_case mirrors the raw SQL column names.
interface SweptRow {
  id: string;
  user_email: string | null;
  user_name: string | null;
  organization_id: string;
  event_title: string;
  tier_name: string;
}

@Injectable()
export class AutoRejectJob {
  private readonly logger = new Logger(AutoRejectJob.name);
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: Mailer,
    private readonly stream: WaitlistStream,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUTO_REJECT_BATCH_LIMIT) private readonly batchLimit: number,
  ) {}

  // waitForCompletion stops the scheduler firing an overlapping tick; the
  // isRunning flag additionally guards a manual run() (the e2e entrypoint)
  // racing a scheduled tick. UTC so the sweep boundary matches the UTC
  // startsAt column regardless of host timezone.
  @Cron(CronExpression.EVERY_5_MINUTES, {
    name: 'waitlist-auto-reject',
    timeZone: 'UTC',
    waitForCompletion: true,
  })
  async handleCron(): Promise<void> {
    await this.run();
  }

  // Directly invocable (app.get(AutoRejectJob).run()) so e2e drives the sweep
  // deterministically. Loops fixed-size batches until a sub-batch comes back
  // short, so a backlog past one batch is fully drained. Returns the number of
  // requests rejected this pass.
  async run(): Promise<{ rejectedCount: number }> {
    // Re-entrancy guard: @Cron(waitForCompletion) stops overlapping scheduled
    // ticks, and this flag additionally stops a manual run() racing a tick.
    if (this.isRunning) {
      this.logger.warn('Auto-reject sweep already running; skipping this tick');
      return { rejectedCount: 0 };
    }
    this.isRunning = true;
    try {
      let total = 0;
      for (;;) {
        const swept = await this.sweepBatch();
        // commit-then-send (deepening M2): the locks are released by the time
        // sweepBatch() resolves, so neither the Resend call nor the SSE emit
        // ever runs inside the FOR UPDATE window.
        for (const row of swept) {
          await this.notify(row);
        }
        total += swept.length;
        if (swept.length < this.batchLimit) break;
      }
      if (total > 0) {
        this.logger.log(`Auto-rejected ${total} request(s) (${REASON})`);
      }
      return { rejectedCount: total };
    } finally {
      this.isRunning = false;
    }
  }

  // One short transaction: lock a batch of PENDING requests whose event has
  // started (SKIP LOCKED so a request an admin or the webhook re-check is
  // currently holding is left for them — AE15), then CAS them PENDING→REJECTED
  // guarded on status. We hold FOR UPDATE on exactly these rows and selected
  // them as PENDING, so the guarded updateMany flips all of them; the status
  // guard is belt-and-suspenders. No audit row — the scheduler is not an admin.
  private async sweepBatch(): Promise<SweptRow[]> {
    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<SweptRow[]>`
        SELECT tr.id, tr.user_email, tr.user_name,
               e.organization_id, e.title AS event_title,
               tt.name AS tier_name
        FROM ticket_requests tr
        JOIN events e ON e.id = tr.event_id
        JOIN ticket_types tt ON tt.id = tr.ticket_type_id
        WHERE tr.status = 'PENDING' AND e.starts_at <= ${now}
        ORDER BY tr.created_at ASC
        FOR UPDATE OF tr SKIP LOCKED
        LIMIT ${this.batchLimit}
      `;
      if (locked.length === 0) return [];
      await tx.ticketRequest.updateMany({
        where: {
          id: { in: locked.map((r) => r.id) },
          status: TicketRequestStatus.PENDING,
        },
        data: { status: TicketRequestStatus.REJECTED },
      });
      return locked;
    });
  }

  // Post-commit, best-effort fan-out for one rejected request: the rejection
  // email (no admin reason for an auto-reject) and the SSE update so a watching
  // admin's queue drops the row live. Mailer.send never throws; the emit is a
  // no-op if no admin is streaming the org.
  private async notify(row: SweptRow): Promise<void> {
    if (row.user_email) {
      await this.mailer.send({
        template: 'rejected',
        to: row.user_email,
        props: {
          requesterName: row.user_name ?? 'there',
          eventTitle: row.event_title,
          tierName: row.tier_name,
        },
      });
    }
    this.stream.emit(row.organization_id, {
      type: 'request.updated',
      id: row.id,
      data: { id: row.id, status: TicketRequestStatus.REJECTED },
    });
  }
}
