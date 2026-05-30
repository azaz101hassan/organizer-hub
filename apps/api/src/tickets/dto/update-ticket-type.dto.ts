import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class UpdateTicketTypeDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_00)
  priceCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3)
  minTierLevel?: number;

  // null clears the cap; a positive int sets it; omitted leaves it unchanged.
  @IsOptional()
  @IsInt()
  @Min(1)
  cap?: number | null;
}
