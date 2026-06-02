import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateCoalitionDto {
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsString()
  @Length(1, 80)
  @Matches(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, {
    message:
      'slug must be lowercase letters, digits, or hyphens, and must not start or end with a hyphen',
  })
  slug!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 2000)
  description?: string;

  // No @IsUrl: admins may post relative paths from an internal upload endpoint.
  // Length cap is the only constraint until U23 lands the upload UI and tells us
  // exactly which shapes are valid.
  @IsOptional()
  @IsString()
  @Length(1, 500)
  coverImageUrl?: string;

  // ARCHIVED on create is rejected at runtime to keep archiveForAdmin as the
  // single source of truth for the archive invariant (no active campaigns).
  @IsOptional()
  @IsIn(['ACTIVE'])
  status?: 'ACTIVE';

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  displayOrder?: number;
}
