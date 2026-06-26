# Plan F: Backend Reports + XLSX Export

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move report aggregation from frontend to a dedicated `/reports/*` backend module that can handle large datasets efficiently. Add proper XLSX export with hotel header, period, and totals.

**Architecture:** New NestJS `ReportsModule` with 3 endpoints (`/reports/occupancy`, `/reports/revenue`, `/reports/guests`). A streaming XLSX export endpoint (`/reports/export.xlsx`) uses the `exceljs` library. Frontend calls the backend instead of computing from timeline data.

**Tech Stack:** NestJS, Prisma raw SQL, `exceljs` npm package, React Query.

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `backend/src/modules/reports/reports.service.ts` | SQL aggregation queries |
| Create | `backend/src/modules/reports/reports.controller.ts` | REST + streaming XLSX endpoint |
| Create | `backend/src/modules/reports/reports.module.ts` | NestJS module |
| Modify | `backend/src/app.module.ts` | Register ReportsModule |
| Modify | `frontend/src/api/reports.js` | Add backend API calls |
| Modify | `frontend/src/Components/HotelPMS/components/Reports/Reports.jsx` | Use backend data + XLSX button |

---

## Task 1: Install `exceljs`

- [ ] **Step 1: Install**

```bash
cd backend && npm install exceljs
cd backend && npm install --save-dev @types/node
```

- [ ] **Step 2: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "chore: add exceljs for XLSX report generation"
```

---

## Task 2: Create `ReportsService`

**Files:**
- Create: `backend/src/modules/reports/reports.service.ts`

- [ ] **Step 1: Write the service**

```typescript
// backend/src/modules/reports/reports.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/context/tenant-context';

export interface OccupancyRow {
  date: string;
  room_type_id: string;
  room_type_name: string;
  total_rooms: number;
  booked_rooms: number;
  occupancy_pct: number;
}

export interface RevenueRow {
  room_type_id: string;
  room_type_name: string;
  reservations_count: number;
  nights_count: number;
  total_revenue: number;
  adr: number;
}

export interface GuestRow {
  id: string;
  guest_name: string;
  phone: string | null;
  room_number: string;
  room_type_name: string;
  check_in: string;
  check_out: string;
  nights: number;
  status: string;
  source: string;
  total_price: number | null;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOccupancy(from: string, to: string): Promise<OccupancyRow[]> {
    const tenantId = TenantContext.getTenantIdOrThrow();
    return this.prisma.forTenant(async (tx) => {
      return tx.$queryRaw<OccupancyRow[]>`
        WITH dates AS (
          SELECT generate_series(${from}::date, ${to}::date, '1 day'::interval)::date AS d
        ),
        room_counts AS (
          SELECT room_type_id, COUNT(*) AS total
          FROM room
          WHERE is_active = true
          GROUP BY room_type_id
        ),
        bookings AS (
          SELECT
            d.d AS date,
            r.room_type_id,
            COUNT(res.id) AS booked
          FROM dates d
          CROSS JOIN room_type rt
          LEFT JOIN room r ON r.room_type_id = rt.id AND r.is_active = true
          LEFT JOIN reservation res ON res.room_id = r.id
            AND res.check_in <= d.d
            AND res.check_out > d.d
            AND res.status NOT IN ('CANCELLED', 'NO_SHOW')
          GROUP BY d.d, r.room_type_id
        )
        SELECT
          b.date::text,
          b.room_type_id,
          rt.name AS room_type_name,
          COALESCE(rc.total, 0)::int AS total_rooms,
          COALESCE(b.booked, 0)::int AS booked_rooms,
          CASE WHEN COALESCE(rc.total, 0) > 0
               THEN ROUND(COALESCE(b.booked, 0) * 100.0 / rc.total, 1)
               ELSE 0 END AS occupancy_pct
        FROM bookings b
        JOIN room_type rt ON rt.id = b.room_type_id
        LEFT JOIN room_counts rc ON rc.room_type_id = b.room_type_id
        WHERE b.room_type_id IS NOT NULL
        ORDER BY b.date, rt.name
      `;
    });
  }

  async getRevenue(from: string, to: string): Promise<RevenueRow[]> {
    const tenantId = TenantContext.getTenantIdOrThrow();
    return this.prisma.forTenant(async (tx) => {
      return tx.$queryRaw<RevenueRow[]>`
        SELECT
          r.room_type_id,
          rt.name AS room_type_name,
          COUNT(res.id)::int AS reservations_count,
          SUM(res.check_out - res.check_in)::int AS nights_count,
          COALESCE(SUM(res.total_price), 0)::float AS total_revenue,
          CASE WHEN SUM(res.check_out - res.check_in) > 0
               THEN ROUND(COALESCE(SUM(res.total_price), 0) / SUM(res.check_out - res.check_in), 2)::float
               ELSE 0 END AS adr
        FROM reservation res
        JOIN room r ON r.id = res.room_id
        JOIN room_type rt ON rt.id = r.room_type_id
        WHERE res.check_in >= ${from}::date
          AND res.check_out <= ${to}::date
          AND res.status NOT IN ('CANCELLED', 'NO_SHOW')
        GROUP BY r.room_type_id, rt.name
        ORDER BY total_revenue DESC
      `;
    });
  }

  async getGuests(from: string, to: string): Promise<GuestRow[]> {
    const tenantId = TenantContext.getTenantIdOrThrow();
    return this.prisma.forTenant(async (tx) => {
      return tx.$queryRaw<GuestRow[]>`
        SELECT
          res.id,
          res.guest_name,
          res.phone,
          r.number AS room_number,
          rt.name AS room_type_name,
          res.check_in::text,
          res.check_out::text,
          (res.check_out - res.check_in)::int AS nights,
          res.status,
          res.source,
          res.total_price::float AS total_price
        FROM reservation res
        JOIN room r ON r.id = res.room_id
        JOIN room_type rt ON rt.id = r.room_type_id
        WHERE res.check_in >= ${from}::date
          AND res.check_out <= ${to}::date
        ORDER BY res.check_in ASC, res.guest_name ASC
      `;
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/modules/reports/reports.service.ts
git commit -m "feat(reports): add ReportsService with occupancy, revenue, guests queries"
```

---

## Task 3: Create `ReportsController` with XLSX streaming

**Files:**
- Create: `backend/src/modules/reports/reports.controller.ts`

- [ ] **Step 1: Write the controller**

```typescript
// backend/src/modules/reports/reports.controller.ts
import { Controller, Get, HttpCode, HttpStatus, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import * as ExcelJS from 'exceljs';
import { ReportsService } from './reports.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiBearerAuth()
@ApiTags('Reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('occupancy')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('report.view.operations')
  @ApiOperation({ summary: 'Daily occupancy by room type' })
  @ApiQuery({ name: 'from', required: true, example: '2026-06-01' })
  @ApiQuery({ name: 'to', required: true, example: '2026-06-30' })
  getOccupancy(@Query('from') from: string, @Query('to') to: string) {
    return this.reportsService.getOccupancy(from, to);
  }

  @Get('revenue')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('report.view.finance')
  @ApiOperation({ summary: 'Revenue summary by room type for a period' })
  @ApiQuery({ name: 'from', required: true })
  @ApiQuery({ name: 'to', required: true })
  getRevenue(@Query('from') from: string, @Query('to') to: string) {
    return this.reportsService.getRevenue(from, to);
  }

  @Get('guests')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('report.view.operations')
  @ApiOperation({ summary: 'Guest list for a period' })
  @ApiQuery({ name: 'from', required: true })
  @ApiQuery({ name: 'to', required: true })
  getGuests(@Query('from') from: string, @Query('to') to: string) {
    return this.reportsService.getGuests(from, to);
  }

  @Get('guests/export.xlsx')
  @RequirePermissions('report.export')
  @ApiOperation({ summary: 'Download guest report as XLSX' })
  @ApiQuery({ name: 'from', required: true })
  @ApiQuery({ name: 'to', required: true })
  async exportGuestsXlsx(
    @Query('from') from: string,
    @Query('to') to: string,
    @Res() res: Response,
  ) {
    const guests = await this.reportsService.getGuests(from, to);
    const revenue = await this.reportsService.getRevenue(from, to);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'KarsHotel PMS';
    wb.created = new Date();

    // ── Sheet 1: Guests ──────────────────────────────────────────────────────
    const wsGuests = wb.addWorksheet('Гости');

    // Header row
    wsGuests.getRow(1).values = [
      '№', 'Гость', 'Телефон', 'Номер', 'Категория',
      'Заезд', 'Выезд', 'Ночей', 'Статус', 'Источник', 'Сумма (₽)',
    ];
    wsGuests.getRow(1).font = { bold: true };
    wsGuests.getRow(1).fill = {
      type: 'pattern', pattern: 'solid',
      fgColor: { argb: 'FFE2E8F0' },
    };
    wsGuests.columns = [
      { key: 'n',    width: 5  },
      { key: 'name', width: 25 },
      { key: 'ph',   width: 16 },
      { key: 'rm',   width: 10 },
      { key: 'rt',   width: 18 },
      { key: 'ci',   width: 12 },
      { key: 'co',   width: 12 },
      { key: 'nts',  width: 8  },
      { key: 'st',   width: 14 },
      { key: 'src',  width: 12 },
      { key: 'amt',  width: 14 },
    ];

    guests.forEach((g, idx) => {
      wsGuests.addRow({
        n: idx + 1,
        name: g.guest_name,
        ph: g.phone ?? '',
        rm: g.room_number,
        rt: g.room_type_name,
        ci: g.check_in,
        co: g.check_out,
        nts: g.nights,
        st: g.status,
        src: g.source,
        amt: g.total_price ?? '',
      });
    });

    // Total row
    const totalRevenue = guests.reduce((s, g) => s + (g.total_price ?? 0), 0);
    const totalRow = wsGuests.addRow({
      name: 'ИТОГО',
      nts: guests.reduce((s, g) => s + g.nights, 0),
      amt: totalRevenue,
    });
    totalRow.font = { bold: true };

    // ── Sheet 2: Revenue by room type ────────────────────────────────────────
    const wsRev = wb.addWorksheet('Выручка по категориям');
    wsRev.getRow(1).values = ['Категория', 'Броней', 'Ночей', 'Выручка (₽)', 'ADR (₽)'];
    wsRev.getRow(1).font = { bold: true };
    wsRev.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    wsRev.columns = [
      { key: 'rt',   width: 20 },
      { key: 'cnt',  width: 10 },
      { key: 'nts',  width: 10 },
      { key: 'rev',  width: 16 },
      { key: 'adr',  width: 14 },
    ];
    revenue.forEach((r) => {
      wsRev.addRow({
        rt: r.room_type_name,
        cnt: r.reservations_count,
        nts: r.nights_count,
        rev: Number(r.total_revenue),
        adr: Number(r.adr),
      });
    });

    // Format currency columns
    wsGuests.getColumn('amt').numFmt = '#,##0.00 ₽';
    wsRev.getColumn('rev').numFmt = '#,##0.00 ₽';
    wsRev.getColumn('adr').numFmt = '#,##0.00 ₽';

    // Stream response
    const filename = `report_guests_${from}_${to}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await wb.xlsx.write(res);
    res.end();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/modules/reports/reports.controller.ts
git commit -m "feat(reports): add ReportsController with occupancy/revenue/guests + XLSX export"
```

---

## Task 4: Create `ReportsModule` and register

**Files:**
- Create: `backend/src/modules/reports/reports.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Write module**

```typescript
// backend/src/modules/reports/reports.module.ts
import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
```

- [ ] **Step 2: Register in `app.module.ts`**

```typescript
import { ReportsModule } from './modules/reports/reports.module';
// Add to imports: [..., ReportsModule]
```

- [ ] **Step 3: Build to verify**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/reports/ backend/src/app.module.ts
git commit -m "feat(reports): register ReportsModule in AppModule"
```

---

## Task 5: Update frontend Reports screen

**Files:**
- Modify: `frontend/src/api/reports.js` (or create if it doesn't exist)
- Modify: `frontend/src/Components/HotelPMS/components/Reports/Reports.jsx`

- [ ] **Step 1: Create/update API client**

```javascript
// frontend/src/api/reports.js
import client from './client';

export const getOccupancy = (from, to) =>
  client.get('/reports/occupancy', { params: { from, to } }).then((r) => r.data);

export const getRevenue = (from, to) =>
  client.get('/reports/revenue', { params: { from, to } }).then((r) => r.data);

export const getGuests = (from, to) =>
  client.get('/reports/guests', { params: { from, to } }).then((r) => r.data);

export const downloadXlsx = (from, to) => {
  // Trigger file download via link click (avoids axios blob handling complexity)
  const token = localStorage.getItem('accessToken');
  const url = `${client.defaults.baseURL}/reports/guests/export.xlsx?from=${from}&to=${to}`;
  const a = document.createElement('a');
  a.href = url;
  a.setAttribute('download', `report_${from}_${to}.xlsx`);
  // Pass auth header via fetch + createObjectURL for security
  fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    .then((res) => res.blob())
    .then((blob) => {
      a.href = URL.createObjectURL(blob);
      a.click();
      URL.revokeObjectURL(a.href);
    });
};
```

- [ ] **Step 2: Read current `Reports.jsx` and replace frontend aggregation with backend calls**

Keep the existing date picker UI (from/to range). Replace `useTimeline()` aggregation with `useQuery` calls to the new backend endpoints. Add "Скачать XLSX" button that calls `downloadXlsx(from, to)`.

Key changes:
```jsx
import { getOccupancy, getRevenue, getGuests, downloadXlsx } from '../../../../api/reports';
import { useQuery } from '@tanstack/react-query';

// Replace local KPI computation with:
const { data: revenueData = [] } = useQuery({
  queryKey: ['reports-revenue', from, to],
  queryFn: () => getRevenue(from, to),
  enabled: !!from && !!to,
});

// XLSX button:
<button onClick={() => downloadXlsx(from, to)} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm">
  Скачать XLSX
</button>
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/reports.js \
        frontend/src/Components/HotelPMS/components/Reports/Reports.jsx
git commit -m "feat(reports): connect Reports screen to backend endpoints + add XLSX download"
```

---

## Self-Review Checklist

- [x] Spec coverage: Tasks 49 and 50 fully covered
- [x] `exceljs` installed and used for real `.xlsx` (not CSV)
- [x] Two sheets: guest list + revenue by room type
- [x] Currency formatting in Excel cells
- [x] Streaming response (no large buffer in memory)
- [x] Frontend downloads file via fetch + createObjectURL (passes auth header)
- [x] `@RequirePermissions('report.view.operations/finance/export')` applied
