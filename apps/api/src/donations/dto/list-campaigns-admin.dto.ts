import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListCampaignsAdminDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  coalitionId?: string;

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
