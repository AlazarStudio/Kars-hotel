import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Заведение гостиницы из панели платформы (суперадмин и диспетчер Kars Avia,
 * решение владельца 25.10.2026).
 *
 * Учётка владельца НЕОБЯЗАТЕЛЬНА: гостиницы приходят в систему и без кабинета
 * (перенос из старой системы, разовые от партнёра), а владельца приглашают
 * потом. Три поля владельца — либо все, либо ни одного: проверка в сервисе.
 */
export class CreateTenantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  hotelName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  /** Почта гостиницы для связи (не логин). */
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'Валюта — трёхбуквенный код (RUB, USD…)' })
  currency?: string;

  @IsOptional()
  @IsIn(['LITE', 'STANDART', 'PREMIUM'])
  plan?: 'LITE' | 'STANDART' | 'PREMIUM';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  ownerFullName?: string;

  @IsOptional()
  @IsEmail()
  ownerEmail?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  ownerPassword?: string;

  /** «Всё равно создать», когда гостиница с тем же названием в том же городе уже есть. */
  @IsOptional()
  @IsBoolean()
  allowDuplicate?: boolean;
}
