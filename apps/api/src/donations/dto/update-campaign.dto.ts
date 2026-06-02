import { Transform } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// coalitionId absent: re-parenting between coalitions is deferred.
// status absent: use POST :id/transition.
export class UpdateCampaignDto {
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

  // See CreateCampaignDto for the scheme/path rationale.
  @IsOptional()
  @IsString()
  @Length(1, 500)
  @Matches(/^(https?:\/\/|\/)/, {
    message: 'coverImageUrl must be an http(s) URL or an absolute path',
  })
  coverImageUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(2_147_483_647)
  targetAmountCents?: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Matches(/^[a-z]{3}$/, {
    message: 'currency must be a lowercase ISO 4217 code, e.g. "usd"',
  })
  currency?: string;

  @IsOptional()
  @IsISO8601()
  deadline?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  displayOrder?: number;
}
