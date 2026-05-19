import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class CheckAvailabilityDto {
  @ApiPropertyOptional({ example: 'uuid-room-type-id', description: 'Filter by room type (omit for all types)' })
  @IsOptional()
  @IsUUID()
  roomTypeId?: string;

  @ApiProperty({ example: '2026-06-10', description: 'Check-in date (YYYY-MM-DD)' })
  @IsDateString()
  checkIn!: string;

  @ApiProperty({ example: '2026-06-15', description: 'Check-out date (YYYY-MM-DD)' })
  @IsDateString()
  checkOut!: string;

  @ApiPropertyOptional({ example: 'uuid-rate-plan-id', description: 'Filter prices by rate plan' })
  @IsOptional()
  @IsUUID()
  ratePlanId?: string;
}
