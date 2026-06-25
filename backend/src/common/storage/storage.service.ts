import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client as MinioClient } from 'minio';
import { randomUUID } from 'node:crypto';

/** Image MIME types we accept for room-type photos. */
const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** Max upload size — 5 MB. Room photos shouldn't need more. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname?: string;
}

/**
 * S3-compatible object storage (MinIO in dev) for tenant media.
 *
 * Photos are stored under a per-tenant prefix and served by PUBLIC URL so that
 * partners reading over the connectivity API (e.g. Kars Avia) can render them
 * directly via <img src>. The bucket is given an anonymous read-only policy on
 * init; writes/deletes always go through this service with our credentials.
 *
 * The public base is configurable (S3_PUBLIC_URL) so production can front the
 * bucket with a CDN or a public hostname without code changes.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private client!: MinioClient;
  private bucket!: string;
  private publicBase!: string;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const endpoint = this.config.get<string>('S3_ENDPOINT') ?? 'http://localhost:9000';
    const url = new URL(endpoint);
    this.bucket = this.config.get<string>('S3_BUCKET') ?? 'kars-hotel';
    this.publicBase = (
      this.config.get<string>('S3_PUBLIC_URL') ?? endpoint
    ).replace(/\/+$/, '');

    this.client = new MinioClient({
      endPoint: url.hostname,
      port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
      useSSL: url.protocol === 'https:',
      accessKey: this.config.get<string>('S3_ACCESS_KEY') ?? 'minioadmin',
      secretKey: this.config.get<string>('S3_SECRET_KEY') ?? 'minioadmin',
    });

    try {
      await this.ensureBucket();
      this.logger.log(`Storage ready (bucket="${this.bucket}", public="${this.publicBase}")`);
    } catch (err) {
      // Don't crash the app if MinIO is down at boot — uploads will surface the
      // error to the caller. Log loudly so it's noticed in dev.
      this.logger.error(`Storage init failed: ${(err as Error).message}`);
    }
  }

  /**
   * Upload a room-type photo and return its public URL.
   * Key layout: room-type-photos/{tenantId}/{roomTypeId}/{uuid}.{ext}
   */
  async uploadRoomTypePhoto(
    tenantId: string,
    roomTypeId: string,
    file: UploadedFile,
  ): Promise<string> {
    return this.putImage(`room-type-photos/${tenantId}/${roomTypeId}`, file);
  }

  /**
   * Upload a hotel logo and return its public URL.
   * Key layout: tenant-logos/{tenantId}/{uuid}.{ext}
   */
  async uploadTenantLogo(tenantId: string, file: UploadedFile): Promise<string> {
    return this.putImage(`tenant-logos/${tenantId}`, file);
  }

  /** True when a URL already points at an object in our own bucket. */
  isOwnUrl(url: string): boolean {
    return this.keyFromUrl(url) != null;
  }

  /**
   * Download a remote image and store it in our bucket, returning the new
   * public URL. Used to "internalise" external images (e.g. legacy Unsplash
   * seed links) so every image we serve is hosted by us. Idempotent: a URL that
   * already lives in our bucket is returned unchanged.
   */
  async ingestFromUrl(keyPrefix: string, sourceUrl: string): Promise<string> {
    if (this.isOwnUrl(sourceUrl)) return sourceUrl;

    let res: globalThis.Response;
    try {
      res = await fetch(sourceUrl);
    } catch (err) {
      throw new BadRequestException(
        `Не удалось скачать изображение (${sourceUrl}): ${(err as Error).message}`,
      );
    }
    if (!res.ok) {
      throw new BadRequestException(
        `Источник вернул ${res.status} при загрузке ${sourceUrl}`,
      );
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    let mimetype = (res.headers.get('content-type') ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    // Some hosts omit or mislabel the content-type — fall back to sniffing the
    // magic bytes so a valid image still gets stored with the right extension.
    if (!ALLOWED_MIME[mimetype]) {
      mimetype = sniffImageMime(buffer) ?? mimetype;
    }
    return this.putImage(keyPrefix, {
      buffer,
      mimetype,
      size: buffer.length,
    });
  }

  /** Validate an image file and store it under `{keyPrefix}/{uuid}.{ext}`. */
  private async putImage(
    keyPrefix: string,
    file: UploadedFile,
  ): Promise<string> {
    const ext = ALLOWED_MIME[file.mimetype];
    if (!ext) {
      throw new BadRequestException(
        `Неподдерживаемый тип файла "${file.mimetype}". Разрешены JPEG, PNG, WebP, GIF.`,
      );
    }
    if (file.size > MAX_PHOTO_BYTES) {
      throw new BadRequestException(
        `Файл слишком большой (${Math.round(file.size / 1024)} КБ). Максимум 5 МБ.`,
      );
    }

    const key = `${keyPrefix}/${randomUUID()}.${ext}`;
    await this.client.putObject(this.bucket, key, file.buffer, file.size, {
      'Content-Type': file.mimetype,
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    return this.publicUrl(key);
  }

  /**
   * Best-effort delete of an object given its public URL. Only removes objects
   * that live in our bucket; foreign URLs (e.g. legacy Unsplash links) are
   * silently ignored so callers can mix-and-match safely.
   */
  async deleteByUrl(url: string): Promise<void> {
    const key = this.keyFromUrl(url);
    if (!key) return;
    try {
      await this.client.removeObject(this.bucket, key);
    } catch (err) {
      this.logger.warn(`Failed to delete object ${key}: ${(err as Error).message}`);
    }
  }

  private publicUrl(key: string): string {
    return `${this.publicBase}/${this.bucket}/${key}`;
  }

  /** Extract the object key from a public URL, or null if it isn't ours. */
  private keyFromUrl(url: string): string | null {
    const prefix = `${this.publicBase}/${this.bucket}/`;
    if (!url.startsWith(prefix)) return null;
    return url.slice(prefix.length);
  }

  private async ensureBucket(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucket).catch(() => false);
    if (!exists) {
      await this.client.makeBucket(this.bucket, this.config.get<string>('S3_REGION') ?? 'us-east-1');
      this.logger.log(`Created bucket "${this.bucket}"`);
    }
    // Anonymous read-only on objects so partners can fetch photos by URL.
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${this.bucket}/*`],
        },
      ],
    };
    await this.client.setBucketPolicy(this.bucket, JSON.stringify(policy));
  }
}

/** Detect an image MIME type from its leading magic bytes, or null. */
function sniffImageMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return 'image/png';
  // GIF: "GIF8"
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38)
    return 'image/gif';
  // WEBP: "RIFF"...."WEBP"
  if (
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  return null;
}
