import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateTenantSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10)
  country?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  website?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  email?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  stars?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  vatPayer?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  touristTax?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  multiPlaceEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  vatRate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  touristTaxAmount?: number;

  @ApiPropertyOptional({ description: 'HH:MM format', example: '14:00' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'checkInTime must be in HH:MM format' })
  checkInTime?: string;

  @ApiPropertyOptional({ description: 'HH:MM format', example: '12:00' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'checkOutTime must be in HH:MM format' })
  checkOutTime?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  cancellationHours?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string;

  // ── Профиль для партнёрского каталога (В2/В4) ───────────────────────────
  // Диспетчер партнёра выбирает, куда селить экипаж, и звёзд для этого мало.

  @ApiPropertyOptional({ description: 'Гостевой рейтинг 0..5', example: 4.6 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5)
  guestRating?: number;

  @ApiPropertyOptional({ description: 'Заявленная вместимость, мест' })
  @IsOptional()
  @IsInt()
  @Min(0)
  capacity?: number;

  @ApiPropertyOptional({ description: 'Код обслуживаемого аэропорта (IATA)', example: 'MRV' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  airportCode?: string;

  @ApiPropertyOptional({ description: 'Время в пути до аэропорта, минут' })
  @IsOptional()
  @IsInt()
  @Min(0)
  airportMinutes?: number;

  @ApiPropertyOptional({ description: 'Окно завтрака', example: '07:00–10:00' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  mealBreakfast?: string;

  @ApiPropertyOptional({ description: 'Окно обеда' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  mealLunch?: string;

  @ApiPropertyOptional({ description: 'Окно ужина' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  mealDinner?: string;

  @ApiPropertyOptional({
    description: 'Инфраструктура рядом, список строк',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  infrastructure?: string[];
}
