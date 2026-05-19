import {
  IsString,
  IsDateString,
  IsInt,
  IsOptional,
  IsNumber,
  Min,
  IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateReservationDto {
  @ApiProperty({ description: 'Current version for optimistic-locking', example: 1 })
  @IsInt()
  @Min(0)
  version!: number;

  @ApiPropertyOptional({ example: 'uuid-of-room' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  roomId?: string;

  @ApiPropertyOptional({ example: 'Иван Иванов' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  guestName?: string;

  @ApiPropertyOptional({ example: '+7 999 123 45 67' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'email@domain.ru' })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({ example: '2026-06-01' })
  @IsOptional()
  @IsDateString()
  checkIn?: string;

  @ApiPropertyOptional({ example: '2026-06-05' })
  @IsOptional()
  @IsDateString()
  checkOut?: string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  adults?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  children?: number;

  @ApiPropertyOptional({ example: 'CONFIRMED' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 'DIRECT' })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({ example: 'Early check-in requested' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: 1, description: 'Explicit place number within the room (skips auto-assign)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  placeNumber?: number;

  @ApiPropertyOptional({ example: 15000 })
  @IsOptional()
  @IsNumber()
  totalPrice?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ratePlanId?: string;
}
