import {
  BadRequestException,
  ConflictException,
  Injectable,
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
      throw new BadRequestException('amount must be between $1.00 and $10,000.00');
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

  private deriveMode(cadence: DonationCadence): DonationMode {
    return cadence === DonationCadence.ONCE
      ? DonationMode.ONE_TIME
      : DonationMode.RECURRING;
  }

  private recurringFor(cadence: DonationCadence):
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
