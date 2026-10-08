// backend/src/modules/reservations/reservations.controller.ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ReservationsService } from './reservations.service';
import { GuestDataService } from './guest-data.service';
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
  constructor(
    private readonly reservationsService: ReservationsService,
    private readonly guestData: GuestDataService,
  ) {}

  /* Выгрузка всего, что гостиница хранит о госте, по его запросу (152-ФЗ,
     ст. 14, Г-22; план 13.7): по точному телефону, почте или ФИО. */
  @Get('guest-export')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('guest.export')
  @ApiOperation({ summary: 'Export all data the hotel holds about a guest (exact phone, email or full name)' })
  guestExport(
    @Query('phone') phone: string | undefined,
    @Query('email') email: string | undefined,
    @Query('name') name: string | undefined,
    @CurrentUser() user: AuthenticatedRequestUser,
  ) {
    return this.guestData.export({ phone, email, name }, user.userId);
  }

  /* Обезличить завершённую бронь — по команде гостиницы или требованию гостя
     (152-ФЗ, Р-49, ст. 21; план 13.7). */
  @Post(':id/anonymize')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('guest.anonymize')
  @ApiOperation({ summary: 'Anonymize a finished reservation (name, phone, email, notes; journal traces)' })
  anonymize(@Param('id') id: string, @CurrentUser() user: AuthenticatedRequestUser) {
    return this.guestData.anonymize(id, user.userId);
  }

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

  @Get('meals')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('reservation.read')
  @ApiOperation({ summary: 'Meals to prepare on a given date, by reservation' })
  @ApiQuery({ name: 'date', required: true, example: '2026-09-23' })
  getMealsForDay(@Query('date') date: string) {
    return this.reservationsService.getMealsForDay(date);
  }

  /* Открыли карточку брони — в журнал гостиницы (152-ФЗ, Г-25; план 13.5).
     Брони шахматка получает пачкой, карточку открывает интерфейс — он и
     сообщает об открытии. Чужая бронь под RLS не видна — 404. */
  @Post(':id/view')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('reservation.read')
  @ApiOperation({ summary: 'Record that the reservation card was opened' })
  async viewed(@Param('id') id: string, @CurrentUser() user: AuthenticatedRequestUser) {
    await this.reservationsService.recordView(id, user.userId);
  }

  @Get(':id/meals')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('reservation.read')
  @ApiOperation({ summary: 'Meal plan of a reservation, day by day' })
  getMeals(@Param('id') id: string) {
    return this.reservationsService.getMeals(id);
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
  checkOut(@Param('id') id: string, @CurrentUser() user: AuthenticatedRequestUser) {
    return this.reservationsService.checkOut(id, user.userId);
  }

  @Post(':id/no-show')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('reservation.update')
  @ApiOperation({ summary: 'Mark reservation as no-show' })
  noShow(@Param('id') id: string, @CurrentUser() user: AuthenticatedRequestUser) {
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
