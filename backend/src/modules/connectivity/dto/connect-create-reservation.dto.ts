import {
  IsDateString,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Book a room by CATEGORY (not a specific room). The connectivity layer picks
 * an available physical room in the category and creates the reservation.
 */
export class ConnectCreateReservationDto {
  @ApiProperty({ format: 'uuid', description: 'Room category (PMS roomType) id' })
  @IsUUID()
  categoryId!: string;

  /** Chosen rate plan (PMS ratePlan id). When set, the stay is priced by this plan. */
  @ApiPropertyOptional({ format: 'uuid', description: 'Chosen rate plan id' })
  @IsOptional()
  @IsUUID()
  ratePlanId?: string;

  @ApiProperty({ example: '2026-07-01' })
  @IsDateString()
  checkIn!: string;

  @ApiProperty({ example: '2026-07-05' })
  @IsDateString()
  checkOut!: string;

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

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  adults!: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  children?: number;

  /** Partner-side reference (e.g. the Avia request id) for cross-system tracing. */
  @ApiPropertyOptional({ description: "Partner's own reference id" })
  @IsOptional()
  @IsString()
  operatorRef?: string;

  @ApiPropertyOptional({ example: 'Late arrival ~23:00' })
  @IsOptional()
  @IsString()
  comment?: string;
}
