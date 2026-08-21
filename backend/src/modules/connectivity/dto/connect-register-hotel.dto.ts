import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

/**
 * Регистрация гостиницы партнёром (Kars Avia, сбойная заявка).
 *
 * Ночью при сбое людей селят куда придётся: с гостиницей договариваются по
 * телефону, и в каталоге её нет. Диспетчеру нужно завести её за минуту — он
 * знает название, город и адрес, и ничего больше: ни номерного фонда, ни
 * тарифов, ни реквизитов.
 *
 * Поэтому обязательное здесь — только название. Всё остальное дозаполняется
 * потом, если с гостиницей всё-таки заключат договор.
 */
export class ConnectRegisterHotelDto {
  @ApiProperty({ example: 'Гостиница «Кавказ»' })
  @IsString()
  @Length(2, 160)
  name!: string;

  @ApiPropertyOptional({ example: 'Минеральные Воды' })
  @IsOptional()
  @IsString()
  @Length(0, 120)
  city?: string;

  @ApiPropertyOptional({ example: 'Ставропольский край' })
  @IsOptional()
  @IsString()
  @Length(0, 120)
  region?: string;

  @ApiPropertyOptional({ example: 'ул. Гагарина, 1' })
  @IsOptional()
  @IsString()
  @Length(0, 300)
  address?: string;

  @ApiPropertyOptional({ example: '+7 928 000-00-00' })
  @IsOptional()
  @IsString()
  @Length(0, 40)
  phone?: string;

  /** Код аэропорта, который обслуживает гостиница — связь со сбойной заявкой. */
  @ApiPropertyOptional({ example: 'MRV' })
  @IsOptional()
  @IsString()
  @Length(3, 4)
  airportCode?: string;

  /** Заявленная вместимость в местах: диспетчер знает её со слов администратора. */
  @ApiPropertyOptional({ example: 40 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5000)
  capacity?: number;

  /**
   * Разовая ли это гостиница. По умолчанию ДА: партнёр заводит её посреди
   * ночи, договора нет, и в общем каталоге ей не место. Снять признак —
   * отдельное решение, которое принимают, когда договор заключён.
   */
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  provisional?: boolean;
}
