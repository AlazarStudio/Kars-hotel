import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { ConnectivityService } from './connectivity.service';
import { PartnerApiKeyGuard } from './guards/partner-api-key.guard';
import { PARTNER_SCOPES, RequireScopes } from './decorators/partner-scopes.decorator';
import { ConnectAvailabilityDto } from './dto/connect-availability.dto';
import { ConnectCreateReservationDto } from './dto/connect-create-reservation.dto';
import { ConnectCancelDto } from './dto/connect-cancel.dto';
import { ConnectRegisterHotelDto } from './dto/connect-register-hotel.dto';

/**
 * Partner connectivity API — the cross-tenant integration surface consumed by
 * external systems (e.g. the Kars Avia dispatcher platform), analogous to a
 * TravelLine connectivity channel.
 *
 * Auth: `X-Api-Key: <partner key>` (or `Authorization: Bearer <key>`), enforced
 * by {@link PartnerApiKeyGuard}. Routes are `@Public()` so the global JWT guard
 * steps aside — partner traffic carries no user JWT, only the partner key.
 *
 * Versioned base path: `/api/connect/v1`.
 */
@ApiTags('Connectivity (Partner API)')
@ApiSecurity('partner-api-key')
@Public()
@UseGuards(PartnerApiKeyGuard)
@Controller('connect/v1')
export class ConnectivityController {
  constructor(private readonly connectivity: ConnectivityService) {}

  @Post('sso')
  @HttpCode(HttpStatus.OK)
  @RequireScopes(PARTNER_SCOPES.SsoCreate)
  @ApiOperation({
    summary:
      'Mint a one-time SSO entry code (dispatcher "open in PMS"); optional hotelSlug targets a specific hotel',
  })
  createSso(
    @Body()
    body: {
      hotelSlug?: string;
      dispatcher?: { email?: string; fullName?: string };
    },
  ) {
    const email = body?.dispatcher?.email?.trim();
    if (!email) {
      throw new BadRequestException('dispatcher.email is required');
    }
    return this.connectivity.createSso(
      { email, fullName: body.dispatcher?.fullName?.trim() || email },
      body?.hotelSlug,
    );
  }

  @Get('hotels')
  @RequireScopes(PARTNER_SCOPES.HotelsRead)
  @ApiOperation({
    summary: 'List all connected hotels',
    description:
      'includeProvisional=1 — вместе с разовыми, заведёнными партнёром под ' +
      'конкретный случай. По умолчанию их нет: договора с ними не заключено.',
  })
  listHotels(@Query('includeProvisional') includeProvisional?: string) {
    return this.connectivity.listHotels({
      includeProvisional: includeProvisional === '1' || includeProvisional === 'true',
    });
  }

  @Post('hotels')
  @RequireScopes(PARTNER_SCOPES.HotelsWrite)
  @ApiOperation({
    summary: 'Register a hotel',
    description:
      'Заводит запись гостиницы без кабинета и номерного фонда: диспетчер ' +
      'сбойной заявки знает название, город и адрес, и селить людей надо ' +
      'сейчас. По умолчанию — разовая, в каталоге не показывается.',
  })
  registerHotel(@Body() dto: ConnectRegisterHotelDto) {
    return this.connectivity.registerHotel(dto);
  }

  @Post('hotels/:slug/activate')
  @RequireScopes(PARTNER_SCOPES.HotelsWrite)
  @ApiOperation({
    summary: 'Activate a provisional hotel',
    description:
      'Снимает признак «разовая»: с гостиницей заключён договор, и её место ' +
      'теперь в общем каталоге. Идемпотентно — на обычной гостинице просто ' +
      'возвращает её как есть.',
  })
  activateHotel(@Param('slug') slug: string) {
    return this.connectivity.activateHotel(slug);
  }

  @Get('hotels/:slug')
  @RequireScopes(PARTNER_SCOPES.HotelsRead)
  @ApiOperation({ summary: 'Hotel detail + room categories' })
  getHotel(@Param('slug') slug: string) {
    return this.connectivity.getHotel(slug);
  }

  @Get('hotels/:slug/availability')
  @RequireScopes(PARTNER_SCOPES.AvailabilityRead)
  @ApiOperation({ summary: 'Availability + nightly rates for a stay period' })
  availability(@Param('slug') slug: string, @Query() dto: ConnectAvailabilityDto) {
    return this.connectivity.availabilityFor(slug, dto);
  }

  @Post('hotels/:slug/reservations')
  @HttpCode(HttpStatus.CREATED)
  @RequireScopes(PARTNER_SCOPES.ReservationsWrite)
  @ApiOperation({ summary: 'Create a reservation by room category' })
  createReservation(@Param('slug') slug: string, @Body() dto: ConnectCreateReservationDto) {
    return this.connectivity.createReservation(slug, dto);
  }

  @Get('hotels/:slug/reservations/:id')
  @RequireScopes(PARTNER_SCOPES.ReservationsRead)
  @ApiOperation({ summary: 'Fetch a reservation' })
  getReservation(@Param('slug') slug: string, @Param('id') id: string) {
    return this.connectivity.getReservation(slug, id);
  }

  @Get('hotels/:slug/reservations/:id/facts')
  @RequireScopes(PARTNER_SCOPES.ReservationsRead)
  @ApiOperation({ summary: 'Stay facts for reconciliation' })
  getFacts(@Param('slug') slug: string, @Param('id') id: string) {
    return this.connectivity.getFacts(slug, id);
  }

  // В7 · история изменений гостиницы: оператор видит, что и когда поменял
  // отель, не заходя в PMS.
  @Get('hotels/:slug/history')
  @RequireScopes(PARTNER_SCOPES.HotelsRead)
  @ApiOperation({ summary: 'Recent audit trail for a hotel (partner view)' })
  getHistory(@Param('slug') slug: string, @Query('take') take?: string) {
    return this.connectivity.getHotelHistory(slug, Number(take) || 50);
  }

  @Delete('hotels/:slug/reservations/:id')
  @HttpCode(HttpStatus.OK)
  @RequireScopes(PARTNER_SCOPES.ReservationsWrite)
  @ApiOperation({ summary: 'Cancel a reservation' })
  cancelReservation(
    @Param('slug') slug: string,
    @Param('id') id: string,
    @Body() dto: ConnectCancelDto,
  ) {
    return this.connectivity.cancelReservation(slug, id, dto.reason);
  }
}
