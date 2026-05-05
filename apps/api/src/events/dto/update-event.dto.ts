import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsIn,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { EventStatus } from '@organizer-hub/db/api';

export class UpdateEventDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  description?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startsAt?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endsAt?: Date;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  venue?: string;

  @IsOptional()
  @IsIn([EventStatus.DRAFT, EventStatus.PUBLISHED, EventStatus.CANCELLED])
  status?: EventStatus;

  @IsOptional()
  @IsBoolean()
  membersExcluded?: boolean;
}
