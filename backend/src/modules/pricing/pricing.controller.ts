import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PricingService } from './pricing.service';
import { QuotePricingDto } from './dto/quote-pricing.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiTags('pricing')
@ApiBearerAuth()
@Controller('pricing')
export class PricingController {
  constructor(private readonly service: PricingService) {}

  @Post('quote')
  @RequirePermissions('rate.read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Compute the full pricing breakdown for a hypothetical reservation',
  })
  async quote(@Body() dto: QuotePricingDto) {
    const breakdown = await this.service.quote({
      ratePlanId: dto.ratePlanId,
      roomTypeId: dto.roomTypeId,
      arrival: new Date(`${dto.arrival}T00:00:00.000Z`),
      departure: new Date(`${dto.departure}T00:00:00.000Z`),
      occupancy: dto.occupancy,
      currency: dto.currency,
    });

    // Serialize Decimal → string with 2 decimal places for HTTP wire.
    return {
      ...breakdown,
      arrival: breakdown.arrival.toISOString().slice(0, 10),
      departure: breakdown.departure.toISOString().slice(0, 10),
      subtotal: breakdown.subtotal.toFixed(2),
      totalPrice: breakdown.totalPrice.toFixed(2),
      nightly: breakdown.nightly.map((n) => ({
        ...n,
        date: n.date.toISOString().slice(0, 10),
        price: n.price.toFixed(2),
      })),
    };
  }
}
