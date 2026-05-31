import { IsInt, IsOptional, IsString, Length, Matches, Min } from 'class-validator';

export class CreateEventLabelDto {
  @IsString()
  @Length(1, 60)
  name!: string;

  @IsString()
  @Length(1, 60)
  @Matches(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, {
    message:
      'slug must be lowercase letters, digits, or hyphens, and must not start or end with a hyphen',
  })
  slug!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
