import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

/**
 * Fill (set/overwrite) the same price for every date in [fromDate, toDate]
 * for one (ratePlanId × roomTypeId × occupancy).
 *
 * This is the typical "set 3800 ₽ for Стандарт on the whole next month" action.
 */
export class FillRatesDto {
  @ApiProperty()
  @IsUUID()
  ratePlanId!: string;

  @ApiProperty()
  @IsUUID()
  roomTypeId!: string;

  @ApiProperty({ example: '2026-06-01' })
  @IsISO8601()
  fromDate!: string;

  @ApiProperty({ example: '2026-06-30' })
  @IsISO8601()
  toDate!: string;

  @ApiPropertyOptional({ default: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  occupancy?: number;

  @ApiProperty({ description: '0 to clear, or > 0 to set a price' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price!: number;

  @ApiPropertyOptional({ default: 'RUB' })
  @IsOptional()
  @IsString()
  currency?: string;
}
