import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsString, IsUrl, MaxLength } from 'class-validator';

export class RemovePhotoDto {
  @ApiProperty({ description: 'Public URL of the photo to remove' })
  @IsString()
  @MaxLength(2048)
  url!: string;
}

export class SetPhotosDto {
  @ApiProperty({
    description: 'Full ordered list of photo URLs (reorder / bulk remove)',
    type: [String],
  })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(2048, { each: true })
  @IsUrl({ require_tld: false }, { each: true })
  photos!: string[];
}
