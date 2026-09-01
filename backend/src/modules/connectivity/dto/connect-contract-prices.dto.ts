import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';

/**
 * Зеркало закупочных цен договора с оператором (Kars Avia, Э6).
 *
 * Цена вводится ОДИН раз — в реестре договоров оператора; сюда приезжает
 * снимок, чтобы гостиница видела, по какой цене её посчитают, и не вела
 * вторую копию. Правится он там же: здесь запись только читается.
 *
 * Полная замена по документу: приложение одно на пару «договор + ДС» и услугу,
 * и присланный набор строк заменяет предыдущий целиком. Частичных правок нет
 * намеренно — иначе снимок и оригинал разъедутся незаметно.
 */
export class ConnectContractPriceRowDto {
  @ApiPropertyOptional({ description: 'Категория PMS (для размещения)' })
  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @ApiPropertyOptional({ example: 'Двухместный' })
  @IsOptional()
  @IsString()
  categoryName?: string | null;

  @ApiPropertyOptional({ example: 'BREAKFAST', description: 'Приём пищи (для питания)' })
  @IsOptional()
  @IsString()
  mealKind?: string | null;

  /* Копейки, как во всём контракте с Авиа. null — «по запросу»: цена есть, но
     называется в переписке. Отдельно от нуля: ноль читается как «бесплатно». */
  @ApiPropertyOptional({ example: 280000, description: 'Копейки; null при «по запросу»' })
  @IsOptional()
  @IsInt()
  priceNet?: number | null;

  @ApiProperty({ example: false })
  @IsBoolean()
  onRequest!: boolean;
}

export class ConnectContractPricesDto {
  @ApiProperty({ example: 'Г-18' })
  @IsString()
  @Length(1, 120)
  contractNumber!: string;

  @ApiPropertyOptional({ example: 'ДС №2' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  amendmentNumber?: string | null;

  @ApiProperty({ enum: ['ACCOMMODATION', 'MEAL'] })
  @IsIn(['ACCOMMODATION', 'MEAL'])
  service!: 'ACCOMMODATION' | 'MEAL';

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  @IsISO8601()
  validFrom!: string;

  @ApiPropertyOptional({ example: null, description: 'null — бессрочно' })
  @IsOptional()
  @IsISO8601()
  validTo?: string | null;

  @ApiPropertyOptional({ example: 5, description: 'Ставка НДС, %; null — без НДС' })
  @IsOptional()
  @IsNumber()
  vatRate?: number | null;

  @ApiProperty({ type: [ConnectContractPriceRowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConnectContractPriceRowDto)
  rows!: ConnectContractPriceRowDto[];
}

/* Набор документов, действующих у оператора ПРЯМО СЕЙЧАС.
 *
 * Полная картина, а не добавка: чего в наборе нет, того у гостиницы быть не
 * должно. Так чинится обратный ход, которого у одиночной отправки не было —
 * скрытый в Авии договор оставался здесь навсегда.
 *
 * Пустой набор законен и означает ровно то, что означает: действующих
 * договорных цен у оператора для этой гостиницы нет. */
export class ConnectContractPricesSyncDto {
  @ApiProperty({ type: [ConnectContractPricesDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConnectContractPricesDto)
  documents!: ConnectContractPricesDto[];
}
