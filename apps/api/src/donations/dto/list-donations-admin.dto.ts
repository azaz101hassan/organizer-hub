import { DonationMode, DonationStatus } from '@organizer-hub/db/api';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

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

  @IsOptional()
  @IsString()
  cursor?: string;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
