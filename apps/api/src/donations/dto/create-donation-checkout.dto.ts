import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { DonationCadence } from '@organizer-hub/db/api';

export class CreateDonationCheckoutDto {
  @IsString()
  campaignId!: string;

  @IsEnum(DonationCadence)
  cadence!: DonationCadence;

  @IsInt()
  @Min(100)
  @Max(1_000_000)
  amountCents!: number;

  @IsOptional()
  @IsString()
  currency?: string;
}
