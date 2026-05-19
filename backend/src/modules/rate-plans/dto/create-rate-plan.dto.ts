import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MealPlan, PriceModifierType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateRatePlanDto {
  @ApiProperty({ example: 'STANDARD' })
  @IsString()
  @Matches(/^[A-Z0-9_-]{2,32}$/, {
    message: 'code must be 2-32 chars of A-Z, 0-9, underscore or dash',
  })
  code!: string;

  @ApiProperty({ example: 'Стандартный тариф' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ enum: MealPlan, default: MealPlan.NONE })
  @IsOptional()
  @IsEnum(MealPlan)
  mealPlan?: MealPlan;

  @ApiPropertyOptional({ default: false, description: 'If true, prices vary by occupancy' })
  @IsOptional()
  @IsBoolean()
  occupancyPricing?: boolean;

  @ApiPropertyOptional({ description: 'Inherit prices from this rate plan' })
  @IsOptional()
  @IsUUID()
  parentRatePlanId?: string;

  @ApiPropertyOptional({ enum: PriceModifierType, default: PriceModifierType.PERCENT })
  @IsOptional()
  @IsEnum(PriceModifierType)
  priceModifierType?: PriceModifierType;

  @ApiPropertyOptional({ description: 'Modifier value (percent or absolute)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  priceModifierValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  cancellationPolicyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  paymentPolicyId?: string;

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
