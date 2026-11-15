import { ValidationPipe } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common/enums/request-method.enum';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { ContractPricePreviewDto, ContractPriceQueryDto } from './dto/contract-price-preview.dto';
import { CreateRatePlanDto } from './dto/create-rate-plan.dto';
import { UpdateRatePlanDto } from './dto/update-rate-plan.dto';
import { RatePlansController } from './rate-plans.controller';

const body = {
  partnerId: '00000000-0000-4000-8000-000000000001',
  operatorContract: ' 205 ',
  mealPlan: 'BB',
  from: '2026-12-01',
};
const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });

describe.each([
  ['create', CreateRatePlanDto, { code: 'CORPORATE', name: 'Корпоративный' }],
  ['update', UpdateRatePlanDto, {}],
] as const)('%s contract number boundary', (_operation, metatype, required) => {
  it('accepts the full 120-character registry contract number', async () => {
    const operatorContract = 'Д'.repeat(120);
    await expect(
      pipe.transform({ ...required, operatorContract }, { type: 'body', metatype }),
    ).resolves.toMatchObject({ operatorContract });
  });

  it('rejects a contract number exceeding 120 characters', async () => {
    await expect(
      pipe.transform(
        { ...required, operatorContract: 'Д'.repeat(121) },
        { type: 'body', metatype },
      ),
    ).rejects.toMatchObject({
      response: { message: ['operatorContract must be shorter than or equal to 120 characters'] },
    });
  });
});

describe('draft contract price preview boundary', () => {
  it('requires read permission and uses a dedicated POST path', () => {
    const method = RatePlansController.prototype.previewContractPrices;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, method)).toEqual(['rate.read']);
    expect(Reflect.getMetadata(PATH_METADATA, method)).toBe('contract-prices/preview');
    expect(Reflect.getMetadata(METHOD_METADATA, method)).toBe(RequestMethod.POST);
  });

  it('accepts only draft conditions, trims the contract and rejects tenant or price overrides', async () => {
    const meta = { type: 'body' as const, metatype: ContractPricePreviewDto };
    await expect(pipe.transform(body, meta)).resolves.toMatchObject({ operatorContract: '205' });
    for (const extra of [{ tenantId: body.partnerId }, { price: 0 }, { id: body.partnerId }]) {
      await expect(pipe.transform({ ...body, ...extra }, meta)).rejects.toThrow();
    }
    for (const change of [
      { partnerId: 'foreign' },
      { mealPlan: 'UNKNOWN' },
      { guestKind: 'OTHER' },
      { operatorContract: '  ' },
      { partnerCustomerId: 'invalid' },
    ]) {
      await expect(pipe.transform({ ...body, ...change }, meta)).rejects.toThrow();
    }
  });

  it('requires date-only real calendar days for preview and saved prices', async () => {
    for (const from of ['2026-02-30', 'yesterday', '2026-12-01T00:00:00Z']) {
      await expect(
        pipe.transform({ from }, { type: 'query', metatype: ContractPriceQueryDto }),
      ).rejects.toThrow();
      await expect(
        pipe.transform({ ...body, from }, { type: 'body', metatype: ContractPricePreviewDto }),
      ).rejects.toThrow();
    }
  });
});
