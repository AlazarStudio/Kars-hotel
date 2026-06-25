import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ConnectCancelDto {
  @ApiPropertyOptional({ example: 'Guest cancelled via dispatcher' })
  @IsOptional()
  @IsString()
  reason?: string;
}
