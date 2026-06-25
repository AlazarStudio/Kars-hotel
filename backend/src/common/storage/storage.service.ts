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

    const key = `room-type-photos/${tenantId}/${roomTypeId}/${randomUUID()}.${ext}`;
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
