import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateRoomTypeDto {
  @ApiProperty({ description: 'Stable machine code, unique per tenant', example: 'STANDARD' })
  @IsString()
  @Matches(/^[A-Z0-9_-]{2,32}$/, {
    message: 'code must be 2-32 chars of A-Z, 0-9, underscore or dash',
  })
  code!: string;

  @ApiProperty({ example: 'Стандарт' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ example: 'Уютный номер с двуспальной кроватью' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ default: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  baseOccupancy?: number;

  @ApiPropertyOptional({ default: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  maxOccupancy?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  extraBeds?: number;

  @ApiPropertyOptional({ default: 0, description: 'Base price per night (RUB), used until Phase E' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  basePrice?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
