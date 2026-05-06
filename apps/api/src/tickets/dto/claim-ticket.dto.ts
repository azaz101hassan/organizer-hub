import { IsString, Length } from 'class-validator';

export class ClaimTicketDto {
  @IsString()
  @Length(1, 64)
  ticketTypeId!: string;
}
