import { Body, Controller, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReservationsService } from './reservations.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';
import { SwapReservationsDto } from './dto/swap-reservations.dto';

@ApiBearerAuth()
@ApiTags('Reservations')
@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new reservation',
    description:
      'Creates a reservation for the specified room and date range. ' +
      'Checks for overlapping bookings and returns 409 if the room is taken. ' +
      'Automatically invalidates the timeline Redis cache and broadcasts ' +
      'a timeline:update WebSocket event to all connected clients.',
  })
  create(@Body() dto: CreateReservationDto) {
    return this.reservationsService.create(dto);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update an existing reservation',
    description:
      'Partial update of room, dates, guest info, status, or source. ' +
      'Requires the current `version` field for optimistic-locking. ' +
      'Returns 409 if room is already booked or version mismatch. ' +
      'Invalidates Redis cache and broadcasts timeline:update event.',
  })
  update(@Param('id') id: string, @Body() dto: UpdateReservationDto) {
    return this.reservationsService.update(id, dto);
  }

  @Post('swap')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Swap place numbers between two reservations',
    description: 'Atomically swaps place_number of two reservations in the same room.',
  })
  swap(@Body() dto: SwapReservationsDto) {
    return this.reservationsService.swap(dto);
  }
}
