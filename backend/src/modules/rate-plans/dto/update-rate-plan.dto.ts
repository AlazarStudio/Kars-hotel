import { PartialType } from '@nestjs/swagger';
import { CreateRatePlanDto } from './create-rate-plan.dto';

export class UpdateRatePlanDto extends PartialType(CreateRatePlanDto) {}
