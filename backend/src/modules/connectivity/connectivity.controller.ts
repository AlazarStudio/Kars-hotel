import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
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
import { ConnectUpdateReservationDto } from './dto/connect-update-reservation.dto';
import { ConnectReservationMealsDto } from './dto/connect-reservation-meals.dto';
import { ConnectCancelDto } from './dto/connect-cancel.dto';
import { ReviewCorporateTariffDto } from './dto/review-corporate-tariff.dto';
import {
  ConnectContractPricesDto,
  ConnectContractPricesSyncDto,
} from './dto/connect-contract-prices.dto';
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

  /* Номерной фонд: перечень номеров гостиницы. Право то же, что у карточки
     гостиницы, — это её справочные данные, а не доступность на даты. */
  @Get('hotels/:slug/rooms')
  @RequireScopes(PARTNER_SCOPES.HotelsRead)
  @ApiOperation({
    summary: 'Room fund: numbers, floors, categories',
    description:
      'Статический перечень активных номеров. Партнёру он нужен, чтобы ' +
      'диспетчер выбирал номер из списка, а не печатал его руками: иначе ' +
      'номера в отчёте и в счёте гостиницы расходятся.',
  })
  listRooms(@Param('slug') slug: string) {
    return this.connectivity.listRooms(slug);
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

  /* Правка брони партнёра. PATCH, а не PUT: партнёр присылает только то, что
     изменилось в заявке, — сдвинулись даты, сменился член экипажа, переселили
     в другой номер. Полная замена заставила бы его знать и присылать поля, до
     которых ему нет дела. */
  @Patch('hotels/:slug/reservations/:id')
  @RequireScopes(PARTNER_SCOPES.ReservationsWrite)
  @ApiOperation({
    summary: 'Update a partner reservation in place',
    description:
      'Даты, номер, гость, число гостей и комментарий. Статус здесь не ' +
      'меняется: заезд, выезд и отмена — отдельные события. Правится только ' +
      'бронь, созданная партнёром.',
  })
  updateReservation(
    @Param('slug') slug: string,
    @Param('id') id: string,
    @Body() dto: ConnectUpdateReservationDto,
  ) {
    return this.connectivity.updateReservation(slug, id, dto);
  }

  /* Раскладка питания по дням. PUT — присланный набор заменяет прежний
     целиком: у брони одна раскладка, и оператор пересчитывает её каждый раз,
     когда меняются даты, число людей или набор приёмов. */
  @Put('hotels/:slug/reservations/:id/meals')
  @HttpCode(HttpStatus.OK)
  @RequireScopes(PARTNER_SCOPES.ReservationsWrite)
  @ApiOperation({
    summary: 'Set the meal plan of a reservation, day by day',
    description:
      'Порции завтраков, обедов и ужинов на каждый день заезда. Дни вне ' +
      'периода проживания отклоняются: это ошибка счёта на стороне партнёра.',
  })
  setReservationMeals(
    @Param('slug') slug: string,
    @Param('id') id: string,
    @Body() dto: ConnectReservationMealsDto,
  ) {
    return this.connectivity.setReservationMeals(slug, id, dto);
  }

  @Get('hotels/:slug/reservations/:id/meals')
  @RequireScopes(PARTNER_SCOPES.ReservationsRead)
  @ApiOperation({ summary: 'Read the meal plan of a reservation' })
  getReservationMeals(@Param('slug') slug: string, @Param('id') id: string) {
    return this.connectivity.getReservationMeals(slug, id);
  }

  @Get('hotels/:slug/reservations/:id/facts')
  @RequireScopes(PARTNER_SCOPES.ReservationsRead)
  @ApiOperation({ summary: 'Stay facts for reconciliation' })
  getFacts(@Param('slug') slug: string, @Param('id') id: string) {
    return this.connectivity.getFacts(slug, id);
  }

  /* Э6 · Зеркало закупочных цен договора. PUT, а не POST: приложение одно на
     пару «договор + ДС» и услугу, и присланный набор заменяет предыдущий
     целиком — повторный вызов теми же данными ничего не меняет. */
  @Put('hotels/:slug/contract-prices')
  @HttpCode(HttpStatus.OK)
  @RequireScopes(PARTNER_SCOPES.ContractPricesWrite)
  @ApiOperation({
    summary: 'Mirror the operator contract price list for a hotel',
    description:
      'Цена вводится один раз — в реестре договоров оператора; сюда приезжает ' +
      'снимок, чтобы гостиница видела, по какой цене её посчитают, и не вела ' +
      'вторую копию. Полная замена по документу.',
  })
  putContractPrices(
    @Param('slug') slug: string,
    @Body() dto: ConnectContractPricesDto,
  ) {
    return this.connectivity.putContractPrices(slug, dto);
  }

  /* Э6 · Синхронизация зеркала целиком. Объявлена ДО одиночного PUT не по
     необходимости, а по смыслу: это основной путь, одиночная отправка
     осталась совместимостью. */
  @Put('hotels/:slug/contract-prices/sync')
  @HttpCode(HttpStatus.OK)
  @RequireScopes(PARTNER_SCOPES.ContractPricesWrite)
  @ApiOperation({
    summary: 'Replace the whole set of mirrored contract price lists',
    description:
      'Присланный набор — полная картина действующих документов оператора. ' +
      'Чего в нём нет, то удаляется: у оператора документ перестал ' +
      'действовать, и показывать его гостинице значит обещать цену, которой ' +
      'больше нет. Пустой набор законен.',
  })
  syncContractPrices(
    @Param('slug') slug: string,
    @Body() dto: ConnectContractPricesSyncDto,
  ) {
    return this.connectivity.syncContractPrices(slug, dto.documents);
  }

  @Get('hotels/:slug/contract-prices')
  @RequireScopes(PARTNER_SCOPES.HotelsRead)
  @ApiOperation({ summary: 'Contract price snapshots mirrored for a hotel' })
  getContractPrices(@Param('slug') slug: string) {
    return this.connectivity.listContractPrices(slug);
  }

  /* Э3 · Корпоративный тариф гостиницы для оператора.
     Читает оператор ту же картину, что видит гостиница у себя: один расчёт
     статуса на обе стороны, иначе спор «у меня подтверждён» неразрешим. */
  @Get('hotels/:slug/corporate-tariff')
  @RequireScopes(PARTNER_SCOPES.HotelsRead)
  @ApiOperation({ summary: 'Corporate rate plan for the operator, with review status' })
  getCorporateTariff(@Param('slug') slug: string) {
    return this.connectivity.getCorporateTariff(slug);
  }

  @Post('hotels/:slug/corporate-tariff/review')
  @HttpCode(HttpStatus.OK)
  @RequireScopes(PARTNER_SCOPES.CorporateTariffReview)
  @ApiOperation({
    summary: 'Confirm or reject the corporate rate plan',
    description:
      'Подтверждение — шлюз: неподтверждённый тариф к заявкам оператора не ' +
      'применяется. Отпечаток сверяется с текущим, чтобы решение относилось ' +
      'к тем цифрам, которые человек видел.',
  })
  reviewCorporateTariff(
    @Param('slug') slug: string,
    @Body() dto: ReviewCorporateTariffDto,
  ) {
    return this.connectivity.reviewCorporateTariff(slug, dto);
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
