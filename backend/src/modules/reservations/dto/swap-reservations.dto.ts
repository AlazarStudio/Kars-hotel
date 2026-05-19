import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, IsUUID, Min } from 'class-validator';

export class SwapReservationsDto {
  @ApiProperty({ description: 'ID of reservation A' })
  @IsUUID()
  idA!: string;

  @ApiProperty({ description: 'Current version of reservation A' })
  @IsInt()
  @Min(0)
  versionA!: number;

  @ApiProperty({ description: 'ID of reservation B' })
  @IsUUID()
  idB!: string;

  @ApiProperty({ description: 'Current version of reservation B' })
  @IsInt()
  @Min(0)
  versionB!: number;
}
