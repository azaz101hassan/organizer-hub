import { CampaignStatus } from '@organizer-hub/db/api';
import { IsEnum } from 'class-validator';

export class TransitionCampaignDto {
  @IsEnum(CampaignStatus)
  to!: CampaignStatus;
}
