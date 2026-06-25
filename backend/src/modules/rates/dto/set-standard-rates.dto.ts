import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

/** One baseline price for a (ratePlan × roomType). price = 0 clears the row. */
export class StandardRateItemDto {
  @ApiProperty()
  @IsUUID()
  roomTypeId!: string;

  @ApiProperty({ description: '0 clears the standard price for this category' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price!: number;
}

/**
 * Replace the standard (baseline) prices for one rate plan. Each item is
 * upserted; price = 0 deletes that category's standard price.
 */
export class SetStandardRatesDto {
  @ApiProperty()
  @IsUUID()
  ratePlanId!: string;

  @ApiPropertyOptional({ default: 'RUB' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({ type: [StandardRateItemDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => StandardRateItemDto)
  items!: StandardRateItemDto[];
}
