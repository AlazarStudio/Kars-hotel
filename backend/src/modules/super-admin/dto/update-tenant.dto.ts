import { IsEmail, IsIn, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

/**
 * Правка карточки гостиницы из панели платформы. Пустая строка в
 * необязательном поле — «очистить» (в базе станет null), `stars: null` —
 * снять звёзды; не присланное поле не меняется.
 */
export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

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

  @IsOptional()
  @ValidateIf((o: UpdateTenantDto) => o.email !== '')
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  stars?: number | null;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'Валюта — трёхбуквенный код (RUB, USD…)' })
  currency?: string;

  @IsOptional()
  @IsIn(['LITE', 'STANDART', 'PREMIUM'])
  plan?: string;
}
