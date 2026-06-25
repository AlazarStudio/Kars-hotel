import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** The price of a season for one category. */
export class SeasonPriceItemDto {
  @ApiProperty()
  @IsUUID()
  roomTypeId!: string;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price!: number;
}

/** One named season (date range) with a price per category. */
export class SeasonInputDto {
  @ApiProperty({ example: 'Высокий сезон' })
  @IsString()
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ example: '#F59E0B' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  color?: string;

  @ApiProperty({ example: '2026-06-01' })
  @IsISO8601()
  dateFrom!: string;

  @ApiProperty({ example: '2026-08-31' })
  @IsISO8601()
  dateTo!: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiProperty({ type: [SeasonPriceItemDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SeasonPriceItemDto)
  items!: SeasonPriceItemDto[];
}

/**
 * Replace the full set of seasons for one rate plan in a single atomic call.
 * The UI edits the season list locally and saves the whole thing.
 */
export class ReplaceSeasonsDto {
  @ApiProperty()
  @IsUUID()
  ratePlanId!: string;

  @ApiPropertyOptional({ default: 'RUB' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({ type: [SeasonInputDto] })
  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => SeasonInputDto)
  seasons!: SeasonInputDto[];
}
