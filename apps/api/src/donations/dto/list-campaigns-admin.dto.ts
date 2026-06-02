import { IsOptional, IsString, Length } from 'class-validator';

export class ListCampaignsAdminDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  coalitionId?: string;
}
