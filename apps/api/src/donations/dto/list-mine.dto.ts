import { DonationMode, DonationStatus } from '@organizer-hub/db/api';
import { IsEnum, IsOptional } from 'class-validator';

export class ListMineDto {
  @IsOptional()
  @IsEnum(DonationMode)
  mode?: DonationMode;

  @IsOptional()
  @IsEnum(DonationStatus)
  status?: DonationStatus;
}
