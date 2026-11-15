import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MealPlan } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';

export class ContractPriceQueryDto {
  @ApiPropertyOptional({ example: '2026-11-15' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-30' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  to?: string;
}

/** A draft is a set of conditions, never prices, a tenant id or a saved tariff id. */
export class ContractPricePreviewDto extends ContractPriceQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  partnerId!: string;

  @ApiProperty()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 120)
  operatorContract!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  partnerAccountId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  partnerCustomerId?: string | null;

  @ApiPropertyOptional({ enum: ['CREW', 'DISRUPTION'], nullable: true })
  @IsOptional()
  @IsIn(['CREW', 'DISRUPTION'])
  guestKind?: 'CREW' | 'DISRUPTION' | null;

  @ApiProperty({ enum: MealPlan })
  @IsEnum(MealPlan)
  mealPlan!: MealPlan;
}
