import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsISO8601,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Порции одного дня заезда. */
export class ConnectMealDayDto {
  @ApiProperty({ example: '2026-09-22' })
  @IsISO8601()
  date!: string;

  @ApiProperty({ example: 2, description: 'Порций завтрака' })
  @IsInt()
  @Min(0)
  breakfast!: number;

  @ApiProperty({ example: 2, description: 'Порций обеда' })
  @IsInt()
  @Min(0)
  lunch!: number;

  @ApiProperty({ example: 0, description: 'Порций ужина' })
  @IsInt()
  @Min(0)
  dinner!: number;
}

/**
 * Раскладка питания по дням заезда.
 *
 * Присланный набор ЗАМЕНЯЕТ прежний целиком, поэтому PUT, а не POST: у одной
 * брони одна раскладка, и повторная отправка тех же данных ничего не меняет.
 * Пустой список — значит питание по этой брони не заказано.
 *
 * Потолок в 370 дней — защита от нелепого периода: перевёрнутые даты у
 * партнёра рождали бы не ошибку, а тысячи строк.
 */
export class ConnectReservationMealsDto {
  @ApiProperty({ type: [ConnectMealDayDto] })
  @IsArray()
  @ArrayMaxSize(370)
  @ValidateNested({ each: true })
  @Type(() => ConnectMealDayDto)
  days!: ConnectMealDayDto[];
}
