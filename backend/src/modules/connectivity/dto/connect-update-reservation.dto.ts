import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Правка брони, созданной партнёром.
 *
 * Появилось из-за находки в Авии 16.09.2026: заявку правят (сменился аэропорт,
 * уехали даты, поменялся член экипажа), а бронь в гостинице остаётся прежней.
 * Раньше у партнёра был только один выход — отменить и забронировать заново,
 * то есть потерять номер и место в очереди ради смены фамилии.
 *
 * ЧЕГО ЗДЕСЬ НЕТ НАМЕРЕННО. Статуса: заезд, выезд и отмена — это отдельные
 * события со своими последствиями (факты, вебхуки, деньги), и прятать их в
 * общую правку значило бы разрешить «отменить бронь» незаметным полем.
 * Категории тоже нет: сменить категорию — значит переехать в другой номер,
 * и это `roomId`.
 */
export class ConnectUpdateReservationDto {
  @ApiPropertyOptional({ example: '2026-09-22', description: 'Дата заезда' })
  @IsOptional()
  @IsISO8601()
  checkIn?: string;

  @ApiPropertyOptional({ example: '2026-09-24', description: 'Дата выезда' })
  @IsOptional()
  @IsISO8601()
  checkOut?: string;

  @ApiPropertyOptional({
    description:
      'Переселить в другой номер. Номер обязан принадлежать этой гостинице ' +
      'и быть свободным на весь период.',
  })
  @IsOptional()
  @IsUUID()
  roomId?: string;

  @ApiPropertyOptional({ example: 'Петров Пётр Петрович' })
  @IsOptional()
  @IsString()
  guestName?: string;

  @ApiPropertyOptional({ example: '+7 900 000-00-00' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'crew@example.com' })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({ example: 2, description: 'Взрослых' })
  @IsOptional()
  @IsInt()
  @Min(1)
  adults?: number;

  @ApiPropertyOptional({ example: 0, description: 'Детей' })
  @IsOptional()
  @IsInt()
  @Min(0)
  children?: number;

  @ApiPropertyOptional({
    description:
      'Комментарий к брони целиком заменяет прежний: им едет метка «резерв» ' +
      'и просьбы к гостинице, и дописывание превратило бы его в ленту.',
  })
  @IsOptional()
  @IsString()
  comment?: string;

  /**
   * Версия брони, с которой партнёр работает.
   *
   * Необязательна, и это осознанный размен. Партнёр версию у себя не хранит:
   * у него бронь — часть заявки, а не отдельная карточка с историей. Если её
   * не прислали, берём текущую — правка проходит как «прочитать и записать».
   * Прислали — сработает защита от одновременной правки: гостиница успела
   * поменять бронь у себя, и партнёр получит отказ вместо тихой перезаписи.
   */
  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  @Min(0)
  version?: number;
}
