import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
  webOrigin: string;
}

@Injectable()
export class DonationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeClient: StripeClient,
    private readonly billing: BillingService,
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

    const session = await this.stripeClient.stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customer.stripeCustomerId,
      client_reference_id: input.userSub,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: input.amountCents,
            product_data: {
              name: `Donation: ${campaign.name}`,
              metadata: {
                campaignId: campaign.id,
                coalitionId: campaign.coalitionId,
              },
            },
          },
        },
      ],
      metadata,
      success_url: `${input.webOrigin}/donate/thanks?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${input.webOrigin}/campaigns/${campaign.slug}?checkout=canceled`,
    });

    await this.prisma.donation.update({
      where: { id: donation.id },
      data: { stripeCheckoutSessionId: session.id },
    });

    return { url: session.url ?? '', donationId: donation.id };
  }

  private deriveMode(cadence: DonationCadence): DonationMode {
    if (cadence === DonationCadence.ONCE) return DonationMode.ONE_TIME;
    throw new BadRequestException(
      `cadence ${cadence} requires recurring mode; recurring lands in a follow-up unit`,
    );
  }
}
