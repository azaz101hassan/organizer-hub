import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// status is intentionally absent — use POST :id/archive to change status.
export class UpdateCoalitionDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  @Matches(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, {
    message:
      'slug must be lowercase letters, digits, or hyphens, and must not start or end with a hyphen',
  })
  slug?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 2000)
  description?: string;

  // No @IsUrl: see CreateCoalitionDto for the rationale.
  @IsOptional()
  @IsString()
  @Length(1, 500)
  coverImageUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  displayOrder?: number;
}
