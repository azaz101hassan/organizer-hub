import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DonationCadence,
  DonationMode,
  DonationStatus,
} from '@organizer-hub/db/api';
import { PrismaService } from '../prisma/prisma.service';
import { StripeClient } from '../billing/stripe.client';
import { BillingService } from '../billing/billing.service';
import { paginateById } from '../common/paginate';
import type { ListDonationsAdminDto } from './dto/list-donations-admin.dto';

interface CreateCheckoutInput {
  userSub: string;
  userEmail?: string;
  campaignId: string;
  cadence: DonationCadence;
  amountCents: number;
  currency?: string;
}

@Injectable()
export class DonationsService {
  private readonly logger = new Logger(DonationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeClient: StripeClient,
    private readonly billing: BillingService,
    private readonly config: ConfigService,
  ) {}

  async createCheckoutSession(
    input: CreateCheckoutInput,
  ): Promise<{ url: string; donationId: string }> {
    if (input.amountCents < 100 || input.amountCents > 1_000_000) {
      throw new BadRequestException(
        'amount must be between $1.00 and $10,000.00',
      );
    }
    const mode = this.deriveMode(input.cadence);

    const campaign = await this.prisma.campaign.findUnique({
      where: { id: input.campaignId },
      include: { coalition: true },
    });
    if (!campaign) {
      throw new NotFoundException('campaign not found');
    }
    if (campaign.status !== 'ACTIVE') {
      throw new ConflictException('campaign is not accepting donations');
    }
    if (campaign.deadline && campaign.deadline.getTime() < Date.now()) {
      throw new ConflictException('campaign deadline has passed');
    }

    const customer = await this.billing.getOrCreateStripeCustomer(
      input.userSub,
      input.userEmail,
    );

    const webOrigin =
      this.config.get<string>('WEB_ORIGIN') ?? 'http://localhost:3000';
    const currency = input.currency ?? campaign.currency ?? 'usd';

    const donation = await this.prisma.donation.create({
      data: {
        organizationId: campaign.organizationId,
        userId: input.userSub,
        campaignId: campaign.id,
        mode,
        cadence: input.cadence,
        amountCents: input.amountCents,
        currency,
        status: DonationStatus.PENDING,
        stripeCustomerId: customer.stripeCustomerId,
      },
    });

    const metadata = {
      source: 'donation',
      userId: input.userSub,
      donationId: donation.id,
      campaignId: campaign.id,
    };

    const recurring = this.recurringFor(input.cadence);
    const isRecurring = recurring !== null;

    const session = await this.stripeClient.stripe.checkout.sessions.create({
      mode: isRecurring ? 'subscription' : 'payment',
      customer: customer.stripeCustomerId,
      client_reference_id: input.userSub,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: input.amountCents,
            ...(recurring ? { recurring } : {}),
            product_data: {
              name: isRecurring
                ? `Recurring donation: ${campaign.name}`
                : `Donation: ${campaign.name}`,
              metadata: {
                campaignId: campaign.id,
                coalitionId: campaign.coalitionId,
              },
            },
          },
        },
      ],
      metadata,
      ...(isRecurring ? { subscription_data: { metadata } } : {}),
      success_url: `${webOrigin}/donate/thanks?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${webOrigin}/campaigns/${campaign.slug}?checkout=canceled`,
    });

    // If this update fails after Stripe has minted the session, the Donation row
    // stays PENDING with no stripeCheckoutSessionId. The webhook handler (U10)
    // recovers via metadata.donationId rather than stripeCheckoutSessionId, so
    // PENDING rows without a session ID are not permanently stranded.
    await this.prisma.donation.update({
      where: { id: donation.id },
      data: { stripeCheckoutSessionId: session.id },
    });

    return { url: session.url ?? '', donationId: donation.id };
  }

  async listForUser(input: {
    userSub: string;
    mode?: DonationMode;
    status?: DonationStatus;
  }) {
    return this.prisma.donation.findMany({
      where: {
        userId: input.userSub,
        ...(input.mode ? { mode: input.mode } : {}),
        ...(input.status ? { status: input.status } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        campaign: {
          select: {
            id: true,
            slug: true,
            name: true,
            coalition: { select: { id: true, slug: true, name: true } },
          },
        },
      },
    });
  }

  async cancel(input: {
    userSub: string;
    donationId: string;
  }): Promise<{ status: 'canceled' }> {
    const donation = await this.prisma.donation.findUnique({
      where: { id: input.donationId },
    });
    if (!donation || donation.userId !== input.userSub) {
      // 404 not 403: do not leak existence of other users' donations.
      throw new NotFoundException();
    }
    if (donation.status !== DonationStatus.ACTIVE) {
      throw new ConflictException('donation is not active');
    }
    if (
      donation.mode !== DonationMode.RECURRING ||
      !donation.stripeSubscriptionId
    ) {
      throw new ConflictException('donation is not recurring');
    }

    // Cancel-at-period-end: the current paid period stays paid, no new invoice
    // generated. Mirrors BillingService.cancelMembership.
    await this.stripeClient.stripe.subscriptions.update(
      donation.stripeSubscriptionId,
      {
        cancel_at_period_end: true,
      },
    );

    await this.prisma.donation.update({
      where: { id: donation.id },
      data: { status: DonationStatus.CANCELED, canceledAt: new Date() },
    });

    return { status: 'canceled' };
  }

  async findBySession(input: { userSub: string; sessionId: string }) {
    const donation = await this.prisma.donation.findFirst({
      where: {
        stripeCheckoutSessionId: input.sessionId,
        userId: input.userSub,
      },
      include: { campaign: { select: { slug: true } } },
    });
    if (!donation) throw new NotFoundException();
    return {
      donationId: donation.id,
      mode: donation.mode,
      campaignSlug: donation.campaign.slug,
    };
  }

  // ── Admin methods ────────────────────────────────────────────────────────────

  async listForAdmin(
    organizationId: string,
    filters: ListDonationsAdminDto = {},
  ) {
    if (filters.cursor) {
      const cursorRow = await this.prisma.donation.findUnique({
        where: { id: filters.cursor },
        select: { organizationId: true },
      });
      if (!cursorRow || cursorRow.organizationId !== organizationId) {
        throw new BadRequestException('invalid cursor');
      }
    }

    return paginateById(
      (args) =>
        this.prisma.donation.findMany(
          args as Parameters<typeof this.prisma.donation.findMany>[0],
        ),
      {
        where: {
          organizationId,
          ...(filters.campaignId ? { campaignId: filters.campaignId } : {}),
          ...(filters.mode ? { mode: filters.mode } : {}),
          ...(filters.status ? { status: filters.status } : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: {
          campaign: {
            select: {
              id: true,
              slug: true,
              name: true,
              coalition: { select: { id: true, slug: true, name: true } },
            },
          },
        },
        cursor: filters.cursor,
        limit: filters.limit,
      },
    );
  }

  async forceCancelForAdmin(
    organizationId: string,
    id: string,
  ): Promise<{ status: 'canceled' }> {
    const donation = await this.prisma.donation.findUnique({ where: { id } });
    if (!donation || donation.organizationId !== organizationId) {
      throw new NotFoundException();
    }
    if (donation.status !== DonationStatus.ACTIVE) {
      throw new ConflictException('donation is not active');
    }
    if (donation.mode !== DonationMode.RECURRING) {
      throw new ConflictException('donation is not recurring');
    }
    // A RECURRING donation that reaches ACTIVE should always carry a
    // subscription id; if it doesn't, the Stripe handoff never completed
    // and there is nothing to cancel. Distinguish from "not recurring" so
    // the admin sees the precise cause.
    if (!donation.stripeSubscriptionId) {
      throw new ConflictException('donation has no stripe subscription');
    }

    // Cancel-at-period-end: the current paid period stays paid, no new
    // invoice generated. Mirrors the donor self-serve cancel.
    await this.stripeClient.stripe.subscriptions.update(
      donation.stripeSubscriptionId,
      {
        cancel_at_period_end: true,
      },
    );

    // Non-transactional Stripe→DB write: if the DB update fails after
    // Stripe succeeds, the customer.subscription.deleted webhook reconciles
    // once the period ends. Same window as the donor cancel path.
    await this.prisma.donation.update({
      where: { id: donation.id },
      data: { status: DonationStatus.CANCELED, canceledAt: new Date() },
    });

    return { status: 'canceled' };
  }

  async cancelAllRecurringForCampaign(
    organizationId: string,
    campaignId: string,
  ): Promise<{ canceled: number; failed: number }> {
    // stripeSubscriptionId: { not: null } is defense-in-depth against partial data — not an expected case for ACTIVE RECURRING donations.
    // The per-donation DB write below uses updateMany guarded on status=ACTIVE,
    // so a donor self-serve cancel that races this batch keeps its own canceledAt.
    const donations = await this.prisma.donation.findMany({
      where: {
        organizationId,
        campaignId,
        mode: DonationMode.RECURRING,
        status: DonationStatus.ACTIVE,
        stripeSubscriptionId: { not: null },
      },
    });

    let canceled = 0;
    let failed = 0;

    // Per-donation try/catch keeps a single Stripe blip from stranding the rest
    // of the batch. Best-effort: the admin banner ("N recurring donations are
    // still active") surfaces any residuals, and the customer.subscription.deleted
    // webhook reconciles successful Stripe cancels that failed on the DB write.
    for (const donation of donations) {
      try {
        await this.stripeClient.stripe.subscriptions.update(
          donation.stripeSubscriptionId!,
          { cancel_at_period_end: true },
        );

        // Non-transactional Stripe→DB write: if the DB update fails after
        // Stripe succeeds, the webhook reconciles once the period ends.
        //
        // Guard on status=ACTIVE so a concurrent donor self-serve cancel that
        // lands between this batch's findMany snapshot and this loop iteration
        // keeps its original canceledAt timestamp. count===0 means the donation
        // was already canceled by another path (donor cancel, prior cascade
        // attempt, webhook); the Stripe call above was idempotent — skip both
        // counters, there is nothing new to record.
        const result = await this.prisma.donation.updateMany({
          where: { id: donation.id, status: DonationStatus.ACTIVE },
          data: { status: DonationStatus.CANCELED, canceledAt: new Date() },
        });
        if (result.count === 0) {
          continue;
        }

        canceled++;
      } catch (err) {
        this.logger.error(
          `Failed to cancel recurring donation ${donation.id} (sub ${donation.stripeSubscriptionId ?? 'none'}) during campaign archive org=${organizationId} campaign=${campaignId}`,
          err instanceof Error ? err.stack : String(err),
        );
        failed++;
      }
    }

    if (canceled > 0 || failed > 0) {
      this.logger.log(
        `cascade cancel summary: org=${organizationId} campaign=${campaignId} canceled=${canceled} failed=${failed}`,
      );
    }

    return { canceled, failed };
  }

  private deriveMode(cadence: DonationCadence): DonationMode {
    return this.recurringFor(cadence) === null
      ? DonationMode.ONE_TIME
      : DonationMode.RECURRING;
  }

  private recurringFor(
    cadence: DonationCadence,
  ):
    | { interval: 'month'; interval_count: 1 | 3 }
    | { interval: 'year'; interval_count: 1 }
    | null {
    switch (cadence) {
      case DonationCadence.MONTHLY:
        return { interval: 'month', interval_count: 1 };
      case DonationCadence.QUARTERLY:
        return { interval: 'month', interval_count: 3 };
      case DonationCadence.YEARLY:
        return { interval: 'year', interval_count: 1 };
      case DonationCadence.ONCE:
        return null;
    }
  }
}
