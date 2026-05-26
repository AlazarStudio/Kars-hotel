import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CancelReservationDto {
  @ApiPropertyOptional({ description: 'Reason for cancellation', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CheckInDto {
  @ApiPropertyOptional({ description: 'Actual check-in time override (ISO datetime)', example: '2026-06-01T13:00:00Z' })
  @IsOptional()
  @IsString()
  actualCheckInTime?: string;
}
