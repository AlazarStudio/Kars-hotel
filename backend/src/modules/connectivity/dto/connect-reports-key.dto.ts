import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Ключ гостиницы к «Отчётам Kars Avia» — от партнёра (152-ФЗ, план 11.3). */
export class ConnectReportsKeyDto {
  @ApiProperty({ example: 'q1w2e3…' })
  @IsString()
  @MinLength(32)
  @MaxLength(200)
  @Matches(/^[A-Za-z0-9_-]+$/)
  key!: string;
}
