import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddChargeDto {
  @ApiProperty({ enum: ['ROOM', 'MEAL', 'ANCILLARY', 'PENALTY', 'MANUAL'] })
  @IsEnum(['ROOM', 'MEAL', 'ANCILLARY', 'PENALTY', 'MANUAL'])
  type!: string;

  @ApiProperty({ example: 'Проживание 2 ночи' })
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ApiProperty({ example: 2 })
  @IsNumber()
  @Min(0.01)
  quantity!: number;

  @ApiProperty({ example: 5000 })
  @IsNumber()
  @Min(0)
  unitPrice!: number;
}

export class AddPaymentDto {
  @ApiProperty({ enum: ['CASH', 'CARD', 'BANK_TRANSFER', 'OTA_PASSTHRU'] })
  @IsEnum(['CASH', 'CARD', 'BANK_TRANSFER', 'OTA_PASSTHRU'])
  method!: string;

  @ApiProperty({ example: 10000 })
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @ApiPropertyOptional({ enum: ['PAYMENT', 'DEPOSIT', 'REFUND'] })
  @IsOptional()
  @IsEnum(['PAYMENT', 'DEPOSIT', 'REFUND'])
  type?: string;

  @ApiPropertyOptional({ example: 'Наличные на стойке' })
  @IsOptional()
  @IsString()
  note?: string;
}
