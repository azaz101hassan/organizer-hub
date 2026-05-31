import {
  BadRequestException,
  Controller,
  Get,
  Query,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface PublicEventLabelView {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
}

@Controller('public/event-labels')
export class PublicEventLabelsController {
  constructor(private readonly prisma: PrismaService) {}

  // Anonymous read so the member /events filter strip can render without a
  // sign-in. Returns the same fields the admin app sees plus sortOrder for
  // deterministic chip ordering; the full timestamps stay internal.
  @Get()
  async list(
    @Query('organizationId') organizationId?: string,
  ): Promise<PublicEventLabelView[]> {
    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }
    const rows = await this.prisma.eventLabel.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, slug: true, sortOrder: true },
    });
    return rows;
  }
}
