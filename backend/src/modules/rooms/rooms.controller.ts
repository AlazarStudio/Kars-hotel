import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RoomPartnerHold, RoomStatus } from '@prisma/client';
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { CreateManyRoomsDto } from './dto/create-many-rooms.dto';
import { UpdateRoomStatusDto } from './dto/update-room-status.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiTags('rooms')
@ApiBearerAuth()
@Controller('rooms')
export class RoomsController {
  constructor(private readonly service: RoomsService) {}

  @Get()
  @RequirePermissions('room.read')
  @ApiOperation({ summary: 'List all rooms for the current tenant' })
  @ApiQuery({ name: 'roomTypeId', required: false })
  @ApiQuery({ name: 'floor', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, enum: RoomStatus })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiQuery({ name: 'q', required: false, description: 'Поиск по номеру и заметке' })
  @ApiQuery({
    name: 'partnerHold',
    required: false,
    enum: RoomPartnerHold,
    description: 'Договорный блок: NONE | QUOTA | RESERVE',
  })
  list(
    @Query('roomTypeId') roomTypeId?: string,
    @Query('floor') floorRaw?: string,
    @Query('status') status?: RoomStatus,
    @Query('isActive') isActiveRaw?: string,
    @Query('q') q?: string,
    @Query('partnerHold') partnerHold?: RoomPartnerHold,
  ) {
    let floor: number | undefined;
    if (floorRaw !== undefined && floorRaw !== '') {
      const n = Number.parseInt(floorRaw, 10);
      if (Number.isNaN(n)) throw new BadRequestException('floor must be an integer');
      floor = n;
    }
    const isActive =
      isActiveRaw === 'true' ? true : isActiveRaw === 'false' ? false : undefined;
    return this.service.list({
      roomTypeId,
      floor,
      status,
      isActive,
      q: q?.trim() || undefined,
      partnerHold,
    });
  }

  @Get(':id')
  @RequirePermissions('room.read')
  @ApiOperation({ summary: 'Get one room by id' })
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.get(id);
  }

  @Post()
  @RequirePermissions('room.update')
  @ApiOperation({ summary: 'Create a new room' })
  create(@Body() dto: CreateRoomDto) {
    return this.service.create(dto);
  }

  // Д2 · «создать несколько»: этаж — это 20–40 одинаковых номеров подряд,
  // заводить их по одному значит сорок раз заполнить одну форму.
  @Post('bulk')
  @RequirePermissions('room.update')
  @ApiOperation({ summary: 'Create a numbered range of rooms in one category' })
  createMany(@Body() dto: CreateManyRoomsDto) {
    return this.service.createMany(dto);
  }

  @Patch(':id')
  @RequirePermissions('room.update')
  @ApiOperation({ summary: 'Update an existing room' })
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateRoomDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/status')
  @RequirePermissions('room.update')
  @ApiOperation({ summary: 'Change just the room status (housekeeping shortcut)' })
  setStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateRoomStatusDto,
  ) {
    return this.service.setStatus(id, dto.status);
  }

  @Delete(':id')
  @RequirePermissions('room.update')
  @ApiOperation({ summary: 'Delete a room' })
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.remove(id);
  }
}
