import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoomTypesService } from './room-types.service';
import { CreateRoomTypeDto } from './dto/create-room-type.dto';
import { UpdateRoomTypeDto } from './dto/update-room-type.dto';

@ApiTags('room-types')
@ApiBearerAuth()
@Controller('room-types')
export class RoomTypesController {
  constructor(private readonly service: RoomTypesService) {}

  @Get()
  @ApiOperation({ summary: 'List all room types for the current tenant' })
  list() {
    return this.service.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one room type by id' })
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.get(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new room type' })
  create(@Body() dto: CreateRoomTypeDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an existing room type' })
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateRoomTypeDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a room type (only if it has no rooms)' })
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.remove(id);
  }
}
