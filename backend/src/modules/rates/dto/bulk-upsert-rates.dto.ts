import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class BulkUpsertRateItemDto {
  @ApiProperty()
  @IsUUID()
  ratePlanId!: string;

  @ApiProperty()
  @IsUUID()
  roomTypeId!: string;

  @ApiProperty({ description: 'YYYY-MM-DD', example: '2026-06-01' })
  @IsISO8601()
  date!: string;

  @ApiPropertyOptional({ default: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  occupancy?: number;

  @ApiProperty({ description: 'Price per night, e.g. 3800.00' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price!: number;

  @ApiPropertyOptional({ default: 'RUB' })
  @IsOptional()
  @IsString()
  currency?: string;
}

export class BulkUpsertRatesDto {
  @ApiProperty({ type: [BulkUpsertRateItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkUpsertRateItemDto)
  items!: BulkUpsertRateItemDto[];
}
