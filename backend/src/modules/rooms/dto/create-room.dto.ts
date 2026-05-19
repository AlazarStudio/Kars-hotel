import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BedType, RoomStatus, RoomView } from '@prisma/client';
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
