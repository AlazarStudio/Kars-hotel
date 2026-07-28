import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BedType, RoomStatus, RoomView } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Массовое создание номеров одной категории (перенос Д2).
 *
 * Этаж отеля — это 20–40 одинаковых номеров подряд. Заводить их по одному
 * означает сорок раз заполнить одну и ту же форму, меняя две цифры; на этом
 * ошибаются и потом ищут, какой номер пропустили.
 *
 * Диапазон задаётся началом и количеством, а не «от и до»: «создать 20 штук
 * с 101-го» — это то, что человек говорит вслух, и в нём нельзя ошибиться
 * границей. Префикс/суффикс покрывают нумерацию вида «А-101» и «101б».
 */
export class CreateManyRoomsDto {
  @ApiProperty({ description: 'Категория, к которой относятся все номера' })
  @IsUUID()
  roomTypeId!: string;

  @ApiProperty({ description: 'Номер, с которого начинать', example: 101 })
  @IsInt()
  @Min(0)
  startNumber!: number;

  @ApiProperty({ description: 'Сколько номеров создать', example: 20 })
  @IsInt()
  @Min(1)
  // Верхняя граница — защита от опечатки в поле «сколько»: этажей больше
  // сотни номеров не бывает, а «2000» вместо «20» бывает.
  @Max(200)
  count!: number;

  @ApiPropertyOptional({ description: 'Префикс номера, например «А-»' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  prefix?: string;

  @ApiPropertyOptional({ description: 'Суффикс номера, например «б»' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  suffix?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(-5)
  floor?: number;

  @ApiPropertyOptional({ enum: BedType, default: BedType.DOUBLE })
  @IsOptional()
  @IsEnum(BedType)
  bedType?: BedType;

  @ApiPropertyOptional({ enum: RoomView, default: RoomView.NONE })
  @IsOptional()
  @IsEnum(RoomView)
  view?: RoomView;

  @ApiPropertyOptional({ enum: RoomStatus, default: RoomStatus.CLEAN })
  @IsOptional()
  @IsEnum(RoomStatus)
  status?: RoomStatus;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /**
   * Что делать с номерами, которые уже существуют. По умолчанию пропускаем:
   * массовое создание чаще всего «дозаполняет» этаж, и падать целиком из-за
   * одного занятого номера — значит заставить человека вычислять диапазон
   * заново. Со `false` вся операция откатывается.
   */
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  skipExisting?: boolean;
}
