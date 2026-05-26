import { IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTenantUserDto {
  @ApiProperty({ example: 'ivan@hotel.ru' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Иван Петров' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  fullName: string;

  @ApiProperty({ description: 'Role ID to assign', example: 'uuid-of-front-desk-role' })
  @IsUUID()
  roleId: string;

  @ApiPropertyOptional({ description: 'Initial password (min 8 chars). If omitted, a random one is generated and returned.', minLength: 8 })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}

export class UpdateTenantUserDto {
  @ApiPropertyOptional({ description: 'New role ID' })
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @ApiPropertyOptional({ description: 'Activate or deactivate the user' })
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'New full name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string;
}
