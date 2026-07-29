import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BedType, RoomPartnerHold, RoomStatus, RoomView } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateRoomDto {
  @ApiProperty({ description: 'RoomType this room belongs to' })
  @IsUUID()
  roomTypeId!: string;

  @ApiProperty({ description: 'Room number — unique per tenant', example: '101' })
  @IsString()
  @MaxLength(16)
  number!: string;

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
