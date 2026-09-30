import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** Принятие приглашения владельца: пароль, который он задаёт сам. */
export class AcceptOwnerInviteDto {
  @ApiProperty({ description: 'Не короче 8 символов' })
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;
}
