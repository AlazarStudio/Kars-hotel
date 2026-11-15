import { ValidationPipe } from '@nestjs/common';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { SquadronSubmitDto } from './squadron-report.dto';

describe('Squadron report HTTP boundary', () => {
  it('requires report permission on all endpoints and uses the current user tenant', async () => {
    const { SquadronReportController } = require('./squadron-report.controller');
    for (const method of ['list', 'preview', 'detail', 'submit']) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, SquadronReportController.prototype[method])).toEqual(['avia-report.access']);
    }
    const service = { list: jest.fn(), preview: jest.fn(), detail: jest.fn(), submit: jest.fn(async () => ({ id: 'report' })) };
    const prisma = { writeAuditLog: jest.fn() };
    const controller = new SquadronReportController(service, prisma);
    const user = { tenantId: 'my-tenant', userId: 'my-user' };
    controller.list(user);
    controller.preview(user, '2026-10-01', '2026-10-31');
    controller.detail(user, 'report');
    await controller.submit(user, { version: 0 });
    expect(service.list).toHaveBeenCalledWith('my-tenant');
    expect(service.preview).toHaveBeenCalledWith('my-tenant', '2026-10-01', '2026-10-31');
    expect(service.detail).toHaveBeenCalledWith('my-tenant', 'report');
    expect(service.submit).toHaveBeenCalledWith('my-tenant', { version: 0 });
  });

  it('rejects client supplied rows, tenant and totals', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
    const value = { startDate: '2026-10-01', endDate: '2026-10-31', version: 0,
      submissionId: '22222222-2222-4222-8222-222222222222', previewToken: 'a'.repeat(64), corrections: [] };
    await expect(pipe.transform(value, { type: 'body', metatype: SquadronSubmitDto })).resolves.toBeDefined();
    await expect(pipe.transform({ ...value, tenantId: 'other', rows: [], totalKopecks: 0 }, { type: 'body', metatype: SquadronSubmitDto })).rejects.toThrow();
    await expect(pipe.transform({ ...value,
      corrections: [{ reservationId: '11111111-1111-4111-8111-111111111111', mealKopecks: 0, roomNumber: 'changed' }] },
    { type: 'body', metatype: SquadronSubmitDto })).rejects.toThrow();
  });
});
