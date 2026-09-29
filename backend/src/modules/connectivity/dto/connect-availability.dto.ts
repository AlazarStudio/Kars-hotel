import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Query params for GET /connect/v1/hotels/:slug/availability */
export class ConnectAvailabilityDto {
  @ApiProperty({ example: '2026-07-01' })
  @IsDateString()
  checkIn!: string;

  @ApiProperty({ example: '2026-07-05' })
  @IsDateString()
  checkOut!: string;

  /** Restrict offers to categories that can host at least this many guests. */
  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  guests?: number;

  /** Restrict to a single room category (PMS roomType id). */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  /* Кого селят (29.09.2026) — по этим условиям выбирается корпоративный
     тариф партнёра: юрлицо партнёра и заказчик — коды из его справочника. */
  @ApiPropertyOptional({ description: 'Код юрлица партнёра' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  account?: string;

  @ApiPropertyOptional({ description: 'Код заказчика партнёра (авиакомпании)' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  customer?: string;

  @ApiPropertyOptional({ enum: ['CREW', 'DISRUPTION'] })
  @IsOptional()
  @IsIn(['CREW', 'DISRUPTION'])
  guestKind?: 'CREW' | 'DISRUPTION';
}
