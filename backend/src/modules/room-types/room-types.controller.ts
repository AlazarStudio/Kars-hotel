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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoomTypesService } from './room-types.service';
import { CreateRoomTypeDto } from './dto/create-room-type.dto';
import { UpdateRoomTypeDto } from './dto/update-room-type.dto';
import { RemovePhotoDto, SetPhotosDto } from './dto/room-type-photos.dto';
import { MAX_PHOTO_BYTES, UploadedFile as MediaFile } from '../../common/storage/storage.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiTags('room-types')
@ApiBearerAuth()
@Controller('room-types')
export class RoomTypesController {
  constructor(private readonly service: RoomTypesService) {}

  @Get()
  @RequirePermissions('room.read')
  @ApiOperation({ summary: 'List all room types for the current tenant' })
  list() {
    return this.service.list();
  }

  @Get(':id')
  @RequirePermissions('room.read')
  @ApiOperation({ summary: 'Get one room type by id' })
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.get(id);
  }

  @Post()
  @RequirePermissions('room.update')
  @ApiOperation({ summary: 'Create a new room type' })
  create(@Body() dto: CreateRoomTypeDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('room.update')
  @ApiOperation({ summary: 'Update an existing room type' })
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateRoomTypeDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('room.update')
  @ApiOperation({ summary: 'Delete a room type (only if it has no rooms)' })
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.remove(id);
  }

  // ── photos ───────────────────────────────────────────────────────────────

  @Post(':id/photos')
  @RequirePermissions('room.update')
  @ApiOperation({ summary: 'Upload a photo for a room type' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_BYTES } }),
  )
  uploadPhoto(
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file?: MediaFile,
  ) {
    if (!file) {
      throw new BadRequestException('Файл не передан (ожидается поле "file")');
    }
    return this.service.addPhoto(id, file);
  }

  @Patch(':id/photos')
  @RequirePermissions('room.update')
  @ApiOperation({ summary: 'Replace the ordered photo list (reorder / bulk remove)' })
  setPhotos(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetPhotosDto,
  ) {
    return this.service.setPhotos(id, dto.photos);
  }

  @Delete(':id/photos')
  @RequirePermissions('room.update')
  @ApiOperation({ summary: 'Remove one photo by URL' })
  removePhoto(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RemovePhotoDto,
  ) {
    return this.service.removePhoto(id, dto.url);
  }
}
