import { IsEmail, IsIn, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterTenantDto {
  @ApiProperty({ description: 'Hotel display name', example: 'Hotel Parkoviy' })
  @IsString()
  @MinLength(2)
  hotelName!: string;

  @ApiPropertyOptional({
    description:
      'URL-safe slug. Optional — auto-generated from hotelName if omitted. Used for invitation links and URLs.',
    example: 'parkoviy',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/, {
    message: 'slug must be lowercase letters, digits and dashes (3-32 chars)',
  })
  slug?: string;

  @ApiProperty({ example: 'owner@parkoviy.ru' })
  @IsEmail()
  email!: string;

  @ApiProperty({ description: 'Min 8 characters', example: 'StrongP@ssw0rd' })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({ example: 'Иванов Иван Иванович' })
  @IsString()
  @MinLength(2)
  fullName!: string;

  @ApiPropertyOptional({ default: 'Europe/Moscow' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({ default: 'RUB' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ enum: ['LITE', 'STANDART', 'PREMIUM'], default: 'LITE' })
  @IsOptional()
  @IsIn(['LITE', 'STANDART', 'PREMIUM'])
  plan?: 'LITE' | 'STANDART' | 'PREMIUM';
}
