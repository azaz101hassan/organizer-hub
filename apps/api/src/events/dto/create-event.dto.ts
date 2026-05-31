import { Type } from 'class-transformer';
import { IsDate, IsOptional, IsString, Length } from 'class-validator';

export class CreateEventDto {
  @IsString()
  @Length(2, 120)
  title!: string;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  description?: string;

  @Type(() => Date)
  @IsDate()
  startsAt!: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endsAt?: Date;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  venue?: string;

  @IsOptional()
  @IsString()
  labelId?: string;
}
