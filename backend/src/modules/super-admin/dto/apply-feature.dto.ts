import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsUUID } from 'class-validator';
import { TENANT_FEATURE_KEYS } from '../tenant-features';

/** Включить или выключить функцию сразу у выбранных гостиниц. */
export class ApplyFeatureDto {
  @IsIn(TENANT_FEATURE_KEYS as string[])
  feature!: string;

  @IsBoolean()
  enabled!: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @IsUUID('all', { each: true })
  tenantIds!: string[];
}
