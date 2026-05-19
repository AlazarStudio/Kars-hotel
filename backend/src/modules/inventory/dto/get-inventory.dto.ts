import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsUUID } from 'class-validator';

export class GetInventoryDto {
  @ApiProperty({ example: 'uuid-room-type-id' })
  @IsUUID()
  roomTypeId!: string;

  @ApiProperty({ example: '2026-06-01', description: 'Start date inclusive (YYYY-MM-DD)' })
  @IsDateString()
  from!: string;

  @ApiProperty({ example: '2026-06-30', description: 'End date inclusive (YYYY-MM-DD)' })
  @IsDateString()
  to!: string;
}
