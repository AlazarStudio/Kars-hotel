import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class QuotePricingDto {
  @ApiProperty()
  @IsUUID()
  ratePlanId!: string;

  @ApiProperty()
  @IsUUID()
  roomTypeId!: string;

  @ApiProperty({ description: 'Check-in date, ISO 8601 (YYYY-MM-DD)', example: '2026-06-01' })
  @IsISO8601()
  arrival!: string;

  @ApiProperty({ description: 'Check-out date, ISO 8601', example: '2026-06-04' })
  @IsISO8601()
  departure!: string;

  @ApiProperty({ default: 2 })
  @IsInt()
  @Min(1)
  @Max(20)
  occupancy!: number;

  @ApiPropertyOptional({ default: 'RUB' })
  @IsOptional()
  @IsString()
  currency?: string;
}
