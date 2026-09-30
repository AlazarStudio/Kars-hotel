import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/** Приглашение владельца в кабинет гостиницы — от партнёра (Э10). */
export class ConnectOwnerInviteDto {
  @ApiProperty({ example: 'owner@hotel.ru' })
  @IsEmail()
  @MaxLength(200)
  email!: string;

  @ApiProperty({ example: 'Иванова Мария Петровна' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  fullName!: string;
}
