import {
  IsString,
  IsDateString,
  IsEmail,
  IsInt,
  IsOptional,
  IsNumber,
  Min,
  IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateReservationDto {
  @ApiProperty({ example: 'uuid-of-room' })
  @IsString()
  @IsNotEmpty()
  roomId!: string;

  @ApiProperty({ example: 'Иван Иванов' })
  @IsString()
  @IsNotEmpty()
  guestName!: string;

  @ApiPropertyOptional({ example: '+7 999 123 45 67' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'ivan@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ example: '2026-06-01' })
  @IsDateString()
  checkIn!: string;

  @ApiProperty({ example: '2026-06-05' })
  @IsDateString()
  checkOut!: string;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  adults!: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  children?: number;

  @ApiPropertyOptional({ example: 'CONFIRMED', description: 'Default: CONFIRMED for manual bookings, NEW for OTA' })
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

  @ApiPropertyOptional({ example: 15000 })
  @IsOptional()
  @IsNumber()
  totalPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ratePlanId?: string;
}
