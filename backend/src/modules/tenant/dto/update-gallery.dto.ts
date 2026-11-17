import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, MaxLength } from 'class-validator';

/**
 * Replace the hotel gallery with an explicit ordered list of image URLs.
 *
 * Used to reorder (the first element is the cover / main image shown to
 * partners) and to remove photos — any previously-stored URL absent from this
 * list is deleted from object storage. Every URL must already be one of ours
 * (uploaded via POST /tenant/gallery); the service rejects foreign URLs.
 */
export class UpdateGalleryDto {
  @ApiProperty({ type: [String], description: 'Ordered image URLs; first is the cover.' })
  /* Потолка в 30 здесь НЕТ намеренно (17.11.2026): правило живёт в
     gallery-limit.ts и разрешает уменьшать список, даже если он длиннее 30 —
     иначе отель с 37 фотографиями не может удалить ни одной. */
  @IsArray()
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  photos!: string[];
}
