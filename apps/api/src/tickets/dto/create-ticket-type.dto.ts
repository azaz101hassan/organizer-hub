import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateTicketTypeDto {
  @IsString()
  @Length(1, 80)
  name!: string;

  @IsInt()
  @Min(0)
  @Max(100_000_00) // $100,000 ceiling — enough headroom for portfolio scope
  priceCents!: number;

  // 0 = anyone can pay for it (no membership required). 1/2/3 = Bronze /
  // Silver / Gold required for the free-claim path; everyone else still
  // pays. Out-of-range values are rejected.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3)
  minTierLevel?: number;
}
