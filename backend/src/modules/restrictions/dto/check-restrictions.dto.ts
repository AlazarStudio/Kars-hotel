import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsUUID } from 'class-validator';

export class CheckRestrictionsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ratePlanId?: string;

  @ApiProperty()
  @IsUUID()
  roomTypeId!: string;

  @ApiProperty({ example: '2026-06-01' })
  @IsISO8601()
  arrival!: string;

  @ApiProperty({ example: '2026-06-04' })
  @IsISO8601()
  departure!: string;
}
