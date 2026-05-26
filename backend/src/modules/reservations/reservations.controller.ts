// backend/src/modules/reservations/reservations.controller.ts
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ReservationsService } from './reservations.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';
import { SwapReservationsDto } from './dto/swap-reservations.dto';
import { CancelReservationDto, CheckInDto } from './dto/action-reservation.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';

@ApiBearerAuth()
@ApiTags('Reservations')
@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Get('arrivals')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('reservation.read')
  @ApiOperation({ summary: 'List arrivals for a given date' })
  @ApiQuery({ name: 'date', required: true, example: '2026-06-01' })
  getArrivals(@Query('date') date: string) {
    return this.reservationsService.getArrivals(date);
  }

  @Get('departures')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('reservation.read')
  @ApiOperation({ summary: 'List departures for a given date' })
  @ApiQuery({ name: 'date', required: true, example: '2026-06-01' })
  getDepartures(@Query('date') date: string) {
    return this.reservationsService.getDepartures(date);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('reservation.create')
  @ApiOperation({ summary: 'Create a new reservation' })
  create(@Body() dto: CreateReservationDto) {
    return this.reservationsService.create(dto);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('reservation.update')
  @ApiOperation({ summary: 'Update an existing reservation (partial)' })
  update(@Param('id') id: string, @Body() dto: UpdateReservationDto) {
    return this.reservationsService.update(id, dto);
  }

  @Post('swap')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('reservation.update')
  @ApiOperation({ summary: 'Swap place numbers between two reservations' })
  swap(@Body() dto: SwapReservationsDto) {
    return this.reservationsService.swap(dto);
  }

  @Post(':id/check-in')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('reservation.checkin')
  @ApiOperation({ summary: 'Check in a guest — moves reservation to CHECKED_IN' })
  checkIn(
    @Param('id') id: string,
    @Body() dto: CheckInDto,
    @CurrentUser() user: AuthenticatedRequestUser,
  ) {
    return this.reservationsService.checkIn(id, user.userId, dto.actualCheckInTime);
  }

  @Post(':id/check-out')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('reservation.checkout')
  @ApiOperation({ summary: 'Check out a guest — moves to CHECKED_OUT, marks room DIRTY' })
  checkOut(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedRequestUser,
  ) {
    return this.reservationsService.checkOut(id, user.userId);
  }

  @Post(':id/no-show')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('reservation.update')
  @ApiOperation({ summary: 'Mark reservation as no-show' })
  noShow(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedRequestUser,
  ) {
    return this.reservationsService.noShow(id, user.userId);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('reservation.cancel')
  @ApiOperation({ summary: 'Cancel a reservation with optional reason' })
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelReservationDto,
    @CurrentUser() user: AuthenticatedRequestUser,
  ) {
    return this.reservationsService.cancel(id, user.userId, dto.reason);
  }
}
