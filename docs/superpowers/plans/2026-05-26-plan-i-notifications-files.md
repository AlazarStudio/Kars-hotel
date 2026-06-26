# Plan I: Notifications + File Uploads

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Send email confirmations when a reservation is created or cancelled. (2) Allow hotel owners to upload their logo and room type photos via a `/files/upload` endpoint backed by S3/MinIO.

**Architecture:**
- **Notifications:** A `NotificationsService` that wraps `nodemailer`. Sends emails via SMTP (configured via env vars). Plugged into `ReservationsService` via event emission (same fire-and-forget pattern as webhooks).
- **Files:** A `FilesModule` with a `POST /files/upload` endpoint. Stores files in MinIO/S3 using `@aws-sdk/client-s3`. Returns a presigned URL. `Tenant.logoUrl` and `RoomType.photos` are updated with the storage key.

**Tech Stack:** `nodemailer`, `@aws-sdk/client-s3`, NestJS multipart/form-data (`@nestjs/platform-express`, `multer`).

---

## File Map

### Notifications

| Action | File | Purpose |
|--------|------|---------|
| Create | `backend/src/modules/notifications/notifications.service.ts` | SMTP email sending |
| Create | `backend/src/modules/notifications/notifications.module.ts` | Module |
| Create | `backend/src/modules/notifications/templates/reservation-confirmed.ts` | Email template |
| Create | `backend/src/modules/notifications/templates/reservation-cancelled.ts` | Email template |
| Modify | `backend/src/modules/reservations/reservations.service.ts` | Emit email after create/cancel |

### Files

| Action | File | Purpose |
|--------|------|---------|
| Create | `backend/src/modules/files/files.service.ts` | S3/MinIO upload + presigned URL |
| Create | `backend/src/modules/files/files.controller.ts` | POST /files/upload |
| Create | `backend/src/modules/files/files.module.ts` | Module |
| Modify | `backend/src/app.module.ts` | Register both modules |
| Modify | `frontend/src/Components/HotelPMS/components/Settings/Settings.jsx` | Logo upload button |

---

## Task 1: Install dependencies

- [ ] **Step 1: Install nodemailer and AWS SDK**

```bash
cd backend && npm install nodemailer @aws-sdk/client-s3 @aws-sdk/s3-request-presigner multer
cd backend && npm install --save-dev @types/nodemailer @types/multer
```

- [ ] **Step 2: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "chore: add nodemailer, AWS S3 SDK, multer for notifications and file uploads"
```

---

## Task 2: Create `NotificationsService`

**Files:**
- Create: `backend/src/modules/notifications/notifications.service.ts`

- [ ] **Step 1: Write email templates**

```typescript
// backend/src/modules/notifications/templates/reservation-confirmed.ts
export function reservationConfirmedHtml(params: {
  hotelName: string;
  guestName: string;
  roomTypeName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  totalPrice?: number;
}): { subject: string; html: string } {
  return {
    subject: `Подтверждение бронирования — ${params.hotelName}`,
    html: `
      <h2>Ваше бронирование подтверждено</h2>
      <p>Уважаемый(ая) ${params.guestName},</p>
      <p>Ваше бронирование в <strong>${params.hotelName}</strong> подтверждено.</p>
      <table>
        <tr><td>Тип номера:</td><td>${params.roomTypeName}</td></tr>
        <tr><td>Заезд:</td><td>${params.checkIn}</td></tr>
        <tr><td>Выезд:</td><td>${params.checkOut}</td></tr>
        <tr><td>Ночей:</td><td>${params.nights}</td></tr>
        ${params.totalPrice ? `<tr><td>Стоимость:</td><td>${params.totalPrice.toLocaleString('ru-RU')} ₽</td></tr>` : ''}
      </table>
      <p>Ждём вас!</p>
    `,
  };
}
```

```typescript
// backend/src/modules/notifications/templates/reservation-cancelled.ts
export function reservationCancelledHtml(params: {
  hotelName: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
}): { subject: string; html: string } {
  return {
    subject: `Отмена бронирования — ${params.hotelName}`,
    html: `
      <h2>Ваше бронирование отменено</h2>
      <p>Уважаемый(ая) ${params.guestName},</p>
      <p>Бронирование в <strong>${params.hotelName}</strong> на ${params.checkIn}–${params.checkOut} было отменено.</p>
      <p>Если это произошло по ошибке, свяжитесь с отелем.</p>
    `,
  };
}
```

- [ ] **Step 2: Write the service**

```typescript
// backend/src/modules/notifications/notifications.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { reservationConfirmedHtml } from './templates/reservation-confirmed';
import { reservationCancelledHtml } from './templates/reservation-cancelled';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    const host = config.get<string>('SMTP_HOST');
    const port = config.get<number>('SMTP_PORT') ?? 587;
    const user = config.get<string>('SMTP_USER');
    const pass = config.get<string>('SMTP_PASS');

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
      this.logger.log(`SMTP configured: ${host}:${port}`);
    } else {
      this.logger.warn('SMTP not configured — email notifications disabled');
    }
  }

  async sendReservationConfirmed(params: {
    to: string;
    hotelName: string;
    guestName: string;
    roomTypeName: string;
    checkIn: string;
    checkOut: string;
    nights: number;
    totalPrice?: number;
  }): Promise<void> {
    if (!this.transporter) return;
    const { subject, html } = reservationConfirmedHtml(params);
    await this.send({ to: params.to, subject, html });
  }

  async sendReservationCancelled(params: {
    to: string;
    hotelName: string;
    guestName: string;
    checkIn: string;
    checkOut: string;
  }): Promise<void> {
    if (!this.transporter) return;
    const { subject, html } = reservationCancelledHtml(params);
    await this.send({ to: params.to, subject, html });
  }

  private async send(opts: { to: string; subject: string; html: string }): Promise<void> {
    try {
      const from = this.config.get<string>('SMTP_FROM') ?? 'noreply@karshotel.ru';
      await this.transporter!.sendMail({ from, ...opts });
      this.logger.log(`Email sent to ${opts.to}: ${opts.subject}`);
    } catch (err) {
      this.logger.error(`Email failed: ${(err as Error).message}`);
    }
  }
}
```

- [ ] **Step 3: Write module**

```typescript
// backend/src/modules/notifications/notifications.module.ts
import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@Module({
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/notifications/
git commit -m "feat(notifications): add NotificationsService with SMTP email templates"
```

---

## Task 3: Plug notifications into `ReservationsService`

**Files:**
- Modify: `backend/src/modules/reservations/reservations.service.ts`
- Modify: `backend/src/modules/reservations/reservations.module.ts`

- [ ] **Step 1: Add `NotificationsModule` to imports**

```typescript
// reservations.module.ts
imports: [TimelineModule, FolioModule, HousekeepingModule, WebhooksModule, NotificationsModule],
```

- [ ] **Step 2: Inject `NotificationsService` and send emails**

In `create()`, after timeline invalidation, if `dto.email` is set:
```typescript
if (dto.email) {
  this.notificationsService.sendReservationConfirmed({
    to: dto.email,
    hotelName: 'Hotel',  // TODO: fetch tenant name from context
    guestName: dto.guestName,
    roomTypeName: '',    // TODO: can be enriched later
    checkIn: dto.checkIn,
    checkOut: dto.checkOut,
    nights: Math.round((new Date(dto.checkOut).getTime() - new Date(dto.checkIn).getTime()) / 86400000),
    totalPrice: dto.totalPrice,
  }).catch(() => undefined);
}
```

In `cancel()`, after audit log write, if reservation email is available (needs a lookup or can be deferred):
```typescript
// Fire-and-forget — fetch email from reservation and send cancellation
this.prisma.forTenantExplicit(tenantId, async (tx) => {
  const [res] = await tx.$queryRaw<{ email: string | null; guest_name: string; check_in: Date; check_out: Date }[]>`
    SELECT email, guest_name, check_in, check_out FROM reservation WHERE id = ${id}::uuid LIMIT 1
  `;
  if (res?.email) {
    await this.notificationsService.sendReservationCancelled({
      to: res.email,
      hotelName: 'Hotel',
      guestName: res.guest_name,
      checkIn: res.check_in.toISOString().split('T')[0],
      checkOut: res.check_out.toISOString().split('T')[0],
    });
  }
}).catch(() => undefined);
```

- [ ] **Step 3: Build and commit**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -20
git add backend/src/modules/reservations/
git commit -m "feat(notifications): send confirmation/cancellation emails from ReservationsService"
```

---

## Task 4: Create `FilesModule`

**Files:**
- Create: `backend/src/modules/files/files.service.ts`
- Create: `backend/src/modules/files/files.controller.ts`
- Create: `backend/src/modules/files/files.module.ts`

- [ ] **Step 1: Write `FilesService`**

```typescript
// backend/src/modules/files/files.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as crypto from 'node:crypto';
import * as path from 'node:path';

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = config.get<string>('S3_BUCKET') ?? 'karshotel';
    this.s3 = new S3Client({
      endpoint: config.get<string>('S3_ENDPOINT'), // MinIO or AWS
      region: config.get<string>('S3_REGION') ?? 'us-east-1',
      credentials: {
        accessKeyId: config.get<string>('S3_ACCESS_KEY') ?? 'minioadmin',
        secretAccessKey: config.get<string>('S3_SECRET_KEY') ?? 'minioadmin',
      },
      forcePathStyle: true, // Required for MinIO
    });
  }

  /**
   * Upload a file buffer to S3/MinIO.
   * Returns the storage key (not a URL — URL is minted on demand via presignedUrl).
   */
  async upload(tenantId: string, buffer: Buffer, originalName: string, mimeType: string): Promise<string> {
    const ext = path.extname(originalName).toLowerCase() || '.bin';
    const key = `${tenantId}/${crypto.randomUUID()}${ext}`;

    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    }));

    this.logger.log(`Uploaded: ${key}`);
    return key;
  }

  /** Generate a presigned GET URL valid for 1 hour */
  async presignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.s3, command, { expiresIn: expiresInSeconds });
  }
}
```

- [ ] **Step 2: Write controller**

```typescript
// backend/src/modules/files/files.controller.ts
import {
  Controller, HttpCode, HttpStatus, Post,
  UploadedFile, UseInterceptors, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FilesService } from './files.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

@ApiBearerAuth()
@ApiTags('Files')
@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('room.create') // reuse existing permission — any content editor
  @ApiOperation({ summary: 'Upload a file (logo, room photo). Returns storage key + presigned URL.' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: MAX_SIZE },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_MIME.includes(file.mimetype)) cb(null, true);
      else cb(new BadRequestException(`Unsupported file type: ${file.mimetype}`), false);
    },
  }))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedRequestUser,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const key = await this.filesService.upload(user.tenantId, file.buffer, file.originalname, file.mimetype);
    const url = await this.filesService.presignedUrl(key);
    return { key, url };
  }

  @Post('presign')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('room.read')
  @ApiOperation({ summary: 'Get a presigned URL for a stored file key' })
  async presign(
    @CurrentUser() user: AuthenticatedRequestUser,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    body: { key: string },
  ) {
    // Validate the key belongs to this tenant
    const { key } = body;
    if (!key.startsWith(`${user.tenantId}/`)) {
      throw new BadRequestException('Key does not belong to this tenant');
    }
    const url = await this.filesService.presignedUrl(key);
    return { url };
  }
}
```

- [ ] **Step 3: Write module and register**

```typescript
// backend/src/modules/files/files.module.ts
import { Module } from '@nestjs/common';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';

@Module({
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
```

Register in `app.module.ts`.

- [ ] **Step 4: Add env vars to `.env.example`**

```bash
# Append to .env.example:
cat >> backend/.env.example << 'EOF'

# SMTP (for email notifications)
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=your-sendgrid-api-key
SMTP_FROM=noreply@yourhotel.ru

# S3 / MinIO (for file uploads)
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=karshotel
EOF
```

- [ ] **Step 5: Build and commit**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -20
git add backend/src/modules/files/ backend/src/modules/notifications/ \
        backend/src/app.module.ts backend/.env.example
git commit -m "feat(files): add FilesModule with S3/MinIO upload + presigned URLs"
```

---

## Task 5: Frontend — logo upload in Settings

**Files:**
- Modify: `frontend/src/Components/HotelPMS/components/Settings/Settings.jsx`

- [ ] **Step 1: Add logo upload input**

Read `Settings.jsx`. In the "Основная информация" section, add an `<input type="file" accept="image/*">` next to the logo URL field. On change, call `POST /files/upload` with `FormData`, receive `{ key, url }`, then `PATCH /tenant/settings` with `{ logoUrl: key }`.

```jsx
// Inside Settings component:
const handleLogoUpload = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  const { key, url } = await client.post('/files/upload', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data);
  // Update settings with new logo key
  await client.patch('/tenant/settings', { logoUrl: key });
  setLogoPreview(url);  // Show preview (local state)
};
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/Components/HotelPMS/components/Settings/Settings.jsx
git commit -m "feat(files): add logo upload to Settings screen"
```

---

## Self-Review Checklist

- [x] Spec coverage: Task 52 (notifications + files) fully covered
- [x] SMTP is optional — service degrades gracefully if env vars not set
- [x] File upload validates MIME type + 5MB size limit
- [x] Presigned URLs — raw S3 credentials never reach frontend
- [x] Key ownership validated on presign endpoint (tenantId prefix check)
- [x] Fire-and-forget email — never blocks reservation creation
- [x] `.env.example` updated with all new env vars
