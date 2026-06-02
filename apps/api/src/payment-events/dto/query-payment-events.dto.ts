import { IsEnum, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { PaymentEventKind, PaymentEventStatus } from '@organizer-hub/db/api';

export class QueryPaymentEventsDto {
  @IsOptional() @IsString() cursor?: string;
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(100) limit?: number = 20;
  @IsOptional() @IsEnum(PaymentEventKind) kind?: PaymentEventKind;
  @IsOptional() @IsEnum(PaymentEventStatus) status?: PaymentEventStatus;
  @IsOptional() @IsString() organizationId?: string; // admin
  @IsOptional() @IsString() userEmail?: string; // admin, not yet used in v1
  @IsOptional() @IsString() from?: string; // ISO date
  @IsOptional() @IsString() to?: string;
  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 200)
  campaignId?: string;
  @IsOptional() @IsIn(['true', 'false']) recurringOnly?: 'true' | 'false';
}
