import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Юрлицо партнёра («счёт»): с ним гостиница заключает договор. */
export class PartnerAccountDto {
  @ApiProperty({ example: 'kars-avia', description: 'Код юрлица у партнёра' })
  @IsString()
  @Length(1, 64)
  code!: string;

  @ApiProperty({ example: 'ООО «Карс Авиа»' })
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiPropertyOptional({ example: '0917012345' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{10}(\d{2})?$/, { message: 'ИНН — 10 или 12 цифр' })
  inn?: string;
}

/** Заказчик партнёра — для Kars Avia авиакомпания. */
export class PartnerCustomerDto {
  @ApiProperty({ example: 'FV', description: 'Код заказчика у партнёра' })
  @IsString()
  @Length(1, 64)
  code!: string;

  @ApiProperty({ example: 'Россия' })
  @IsString()
  @Length(1, 200)
  name!: string;
}

/**
 * Справочник партнёра целиком. Присланный набор — полная картина: чего в нём
 * нет, то выключается (не удаляется — на него могут ссылаться тарифы).
 */
export class ConnectPartnerDirectoryDto {
  @ApiProperty({ type: [PartnerAccountDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PartnerAccountDto)
  accounts!: PartnerAccountDto[];

  @ApiProperty({ type: [PartnerCustomerDto] })
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => PartnerCustomerDto)
  customers!: PartnerCustomerDto[];
}
