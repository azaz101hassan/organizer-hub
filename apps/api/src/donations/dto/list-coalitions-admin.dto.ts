import { CoalitionStatus } from '@organizer-hub/db/api';
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

export class ListCoalitionsAdminDto {
  @IsOptional()
  @IsEnum(CoalitionStatus)
  status?: CoalitionStatus;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  q?: string;

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
