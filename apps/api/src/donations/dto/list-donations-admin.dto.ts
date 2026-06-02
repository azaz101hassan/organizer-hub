import { DonationMode, DonationStatus } from '@organizer-hub/db/api';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';

export class ListDonationsAdminDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  campaignId?: string;

  @IsOptional()
  @IsEnum(DonationMode)
  mode?: DonationMode;

  @IsOptional()
  @IsEnum(DonationStatus)
  status?: DonationStatus;
}
