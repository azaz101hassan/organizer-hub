import { Transform } from 'class-transformer';
import {
  IsIn,
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

export class CreateCampaignDto {
  @IsString()
  coalitionId!: string;

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

  // Restrict to http(s) URLs or absolute paths to keep `javascript:` / `data:`
  // schemes out of admin-controlled image references rendered on donor pages.
  @IsOptional()
  @IsString()
  @Length(1, 500)
  @Matches(/^(https?:\/\/|\/)/, {
    message: 'coverImageUrl must be an http(s) URL or an absolute path',
  })
  coverImageUrl?: string;

  // Max matches Postgres Int (2^31 - 1); the schema column is Int, so anything
  // larger would 500 at the DB layer instead of returning a clean 400 here.
  @IsInt()
  @Min(100)
  @Max(2_147_483_647)
  targetAmountCents!: number;

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

  // Transition route is the single source of truth for status changes; create
  // accepts only DRAFT so going live always requires an explicit transition.
  @IsOptional()
  @IsIn(['DRAFT'])
  status?: 'DRAFT';

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  displayOrder?: number;
}
