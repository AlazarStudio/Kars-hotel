import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateTaskDto {
  @IsUUID() roomId!: string;
  @IsOptional() @IsEnum(['CLEANING','TURNDOWN','INSPECTION','MAINTENANCE','DEEP_CLEAN']) type?: string;
  @IsOptional() @IsUUID() assigneeId?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsUUID() reservationId?: string;
}

export class AssignTaskDto {
  @IsUUID() assigneeId!: string;
}
