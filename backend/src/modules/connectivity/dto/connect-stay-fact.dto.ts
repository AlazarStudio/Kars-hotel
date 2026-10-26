import { IsISO8601, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Заезд или выезд от партнёра: когда это было на самом деле. */
export class ConnectStayFactDto {
  @ApiPropertyOptional({
    example: '2026-10-21T00:10:00.000Z',
    description: 'Момент заезда или выезда (ISO с поясом). Нет — сейчас. В будущем — нельзя.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  at?: string;
}
