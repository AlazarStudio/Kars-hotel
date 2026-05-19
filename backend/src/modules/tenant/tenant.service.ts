import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/context/tenant-context';
import { UpdateTenantSettingsDto } from './dto/update-tenant-settings.dto';

@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings() {
    const tenantId = TenantContext.getTenantIdOrThrow();
    // Use admin client to bypass RLS — tenant table is not tenant-scoped by RLS,
    // but the app_user connection requires SET LOCAL app.tenant_id which forTenant provides.
    return this.prisma.admin.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  }

  async updateSettings(dto: UpdateTenantSettingsDto) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    const data = Object.fromEntries(
      Object.entries(dto).filter(([, v]) => v !== undefined),
    );
    return this.prisma.admin.tenant.update({
      where: { id: tenantId },
      data,
    });
  }
}
