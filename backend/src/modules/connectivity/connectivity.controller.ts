import {
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

  @Get('hotels')
  @RequireScopes(PARTNER_SCOPES.HotelsRead)
  @ApiOperation({ summary: 'List all connected hotels' })
  listHotels() {
    return this.connectivity.listHotels();
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
  createReservation(
    @Param('slug') slug: string,
    @Body() dto: ConnectCreateReservationDto,
  ) {
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
