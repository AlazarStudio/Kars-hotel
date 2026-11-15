import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min, ValidateNested } from 'class-validator';

export const MAX_KOPECKS = 999999999999;

export class SquadronCorrectionDto {
  @IsUUID('all')
  reservationId!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_KOPECKS)
  accommodationKopecks?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_KOPECKS)
  mealKopecks?: number;
}

export class SquadronSubmitDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate!: string;

  @IsInt()
  @Min(0)
  @Max(2147483646)
  version!: number;

  @IsUUID('all')
  submissionId!: string;

  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  previewToken!: string;

  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => SquadronCorrectionDto)
  corrections!: SquadronCorrectionDto[];
}
