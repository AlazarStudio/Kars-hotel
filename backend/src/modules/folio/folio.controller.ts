import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FolioService } from './folio.service';
import { AddChargeDto, AddPaymentDto } from './dto/folio.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';

@ApiBearerAuth()
@ApiTags('Folio')
@Controller('reservations/:reservationId/folio')
export class FolioController {
  constructor(private readonly folioService: FolioService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('folio.read')
  @ApiOperation({ summary: 'Get folio for a reservation (creates if missing)' })
  get(@Param('reservationId') reservationId: string) {
    return this.folioService.getOrCreate(reservationId);
  }

  @Post('charges')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('folio.update')
  @ApiOperation({ summary: 'Add a charge line to the folio' })
  addCharge(
    @Param('reservationId') reservationId: string,
    @Body() dto: AddChargeDto,
    @CurrentUser() user: AuthenticatedRequestUser,
  ) {
    return this.folioService.addCharge(reservationId, dto, user.userId);
  }

  @Delete('charges/:chargeId')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('folio.update')
  @ApiOperation({ summary: 'Remove a charge line' })
  deleteCharge(@Param('chargeId') chargeId: string) {
    return this.folioService.deleteCharge(chargeId);
  }

  @Post('payments')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('payment.create')
  @ApiOperation({ summary: 'Record a payment against the folio' })
  addPayment(
    @Param('reservationId') reservationId: string,
    @Body() dto: AddPaymentDto,
    @CurrentUser() user: AuthenticatedRequestUser,
  ) {
    return this.folioService.addPayment(reservationId, dto, user.userId);
  }
}
