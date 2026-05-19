import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class InventoryRowDto {
  @ApiProperty({ example: '2026-06-15', description: 'Date to update (YYYY-MM-DD)' })
  @IsDateString()
  date!: string;

  @ApiPropertyOptional({ example: 10, description: 'Total physical rooms to sell on this date' })
  @IsOptional()
  @IsInt()
  @Min(0)
  totalRooms?: number;

  @ApiPropertyOptional({ example: 2, description: 'Manually blocked rooms (OOO, maintenance)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  blockedRooms?: number;

  @ApiPropertyOptional({ example: false, description: 'Stop-sell flag (disables all new bookings)' })
  @IsOptional()
  @IsBoolean()
  stopSell?: boolean;
}

export class BulkUpdateInventoryDto {
  @ApiProperty({ type: [InventoryRowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InventoryRowDto)
  rows!: InventoryRowDto[];
}
