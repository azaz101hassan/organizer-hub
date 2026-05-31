import { IsString } from 'class-validator';

export class QueryEventLabelsDto {
  @IsString()
  organizationId!: string;
}
