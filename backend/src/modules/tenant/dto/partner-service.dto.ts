import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PartnerServiceGroup } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Услуга отеля для партнёра: питание или доп. услуга с ценой (Б5/Е2/Е4).
 *
 * Проживание сюда НЕ входит — за него отвечают тарифные планы. Здесь то, что
 * попадает в заявку отдельной строкой: обед, поздний выезд, прачечная.
 */
export class UpsertPartnerServiceDto {
  @ApiProperty({ enum: PartnerServiceGroup })
  @IsEnum(PartnerServiceGroup)
  group!: PartnerServiceGroup;

  @ApiProperty({ example: 'Завтрак' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({
    description: 'Цена без НДС, руб. Не указывается для услуг «по запросу».',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  priceNet?: number;

  @ApiPropertyOptional({ description: 'Ставка НДС, %', default: 20 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  vatRate?: number;

  @ApiPropertyOptional({
    description:
      'Стоимость по запросу: цена называется в переписке. Не то же самое, что 0 — ноль читается как «бесплатно».',
  })
  @IsOptional()
  @IsBoolean()
  onRequest?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
