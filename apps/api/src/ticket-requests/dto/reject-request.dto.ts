import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectRequestDto {
  // Optional organizer note shown in the rejection email. Bounded so a single
  // request can't ship an unbounded blob in mail from the trusted domain.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
