import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BedType, RoomPartnerHold, RoomStatus, RoomView } from '@prisma/client';
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

export class CreateRoomDto {
  @ApiProperty({ description: 'RoomType this room belongs to' })
  @IsUUID()
  roomTypeId!: string;

  @ApiProperty({ description: 'Room number — unique per tenant', example: '101' })
  /* 100, а не 16 (22.10.2026): перенесённые из старой системы номера бывают
     адресом квартиры («ул. 40 лет Победы 3 кв 58») — 824 из них длиннее 16,
     и при пределе 16 такой номер нельзя было даже пересохранить. */
  @IsString()
  @MaxLength(100)
  number!: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(-5)
  floor?: number;

  /** Прежнее описание одним видом. Если чисел ниже нет — они берутся из него. */
  @ApiPropertyOptional({ enum: BedType, default: BedType.DOUBLE })
  @IsOptional()
  @IsEnum(BedType)
  bedType?: BedType;

  /* Кровати числами (27.10.2026). Прислано хоть одно из трёх — остальные 0. */
  @ApiPropertyOptional({ description: 'Односпальных кроватей' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  singleBeds?: number;

  @ApiPropertyOptional({ description: 'Двуспальных кроватей' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  doubleBeds?: number;

  @ApiPropertyOptional({ description: 'Диванов' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  sofas?: number;

  @ApiPropertyOptional({ description: 'Доп. кроватей' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  extraBeds?: number;

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

  @ApiPropertyOptional({ default: 1, description: 'Number of bookable places (beds) in this room' })
  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;

  @ApiPropertyOptional({
    enum: RoomPartnerHold,
    default: RoomPartnerHold.NONE,
    description:
      'Держится ли номер за партнёром по договору (Д4). Признак информационный — продажу не блокирует.',
  })
  @IsOptional()
  @IsEnum(RoomPartnerHold)
  partnerHold?: RoomPartnerHold;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
