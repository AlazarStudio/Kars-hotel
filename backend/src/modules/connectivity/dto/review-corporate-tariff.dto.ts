import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** Решение оператора по корпоративному тарифу гостиницы. */
export class ReviewCorporateTariffDto {
  @ApiProperty({ description: 'Тариф, который смотрели' })
  @IsUUID()
  ratePlanId!: string;

  /* Отпечаток того, что оператор ВИДЕЛ. Без него подтверждение относилось бы
     к «тарифу вообще», а не к конкретным цифрам, и гонка правок проходила бы
     незамеченной: гостиница поправила ставку, пока оператор читал экран. */
  @ApiProperty({ description: 'Отпечаток сверенных цен, из ответа чтения' })
  @IsString()
  @MaxLength(128)
  seenFingerprint!: string;

  @ApiProperty({ enum: ['CONFIRMED', 'REJECTED'] })
  @IsIn(['CONFIRMED', 'REJECTED'])
  verdict!: 'CONFIRMED' | 'REJECTED';

  @ApiProperty({ description: 'Кто вынес решение — сотрудник оператора' })
  @IsString()
  @MaxLength(160)
  reviewedBy!: string;

  /* Расхождения построчно: гостиница чинит сама, не звоня диспетчеру.
     «Не подтверждён» без причины — это отказ, который нечем исполнить. */
  @ApiPropertyOptional({
    description: 'Расхождения построчно: что ждали по договору и что стоит в тарифе',
    type: 'array',
    items: { type: 'object' },
  })
  @IsOptional()
  @IsArray()
  notes?: unknown[];
}
