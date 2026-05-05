import { IsString, Length } from 'class-validator';

export class CreateTicketCheckoutDto {
  @IsString()
  @Length(1, 64)
  ticketTypeId!: string;
}
