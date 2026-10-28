import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

/**
 * Удаление номеров «в архив» пачкой (28.10.2026) — номера, отмеченные
 * галочками в «Номерном фонде». Предел тот же, что у создания пачкой.
 */
export class ArchiveManyRoomsDto {
  @ApiProperty({ type: [String], description: 'id номеров, от 1 до 200' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  ids!: string[];
}
