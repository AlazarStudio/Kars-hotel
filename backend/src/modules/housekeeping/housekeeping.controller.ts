import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { HousekeepingService } from './housekeeping.service';
import { AssignTaskDto, CreateTaskDto } from './dto/housekeeping.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';

@ApiBearerAuth()
@ApiTags('Housekeeping')
@Controller('housekeeping/tasks')
export class HousekeepingController {
  constructor(private readonly hkService: HousekeepingService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('hk.task.read')
  listTasks(@Query('status') status?: string) {
    return this.hkService.listTasks(status);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('hk.task.update')
  createTask(@Body() dto: CreateTaskDto, @CurrentUser() user: AuthenticatedRequestUser) {
    return this.hkService.createTask(dto, user.userId);
  }

  @Post(':taskId/assign')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('hk.task.update')
  assignTask(@Param('taskId') taskId: string, @Body() dto: AssignTaskDto) {
    return this.hkService.assignTask(taskId, dto);
  }

  @Post(':taskId/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('hk.task.update')
  completeTask(@Param('taskId') taskId: string, @CurrentUser() user: AuthenticatedRequestUser) {
    return this.hkService.completeTask(taskId, user.userId);
  }
}
