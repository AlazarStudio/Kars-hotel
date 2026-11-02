import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

const RUNS_SHOWN = 30;
const EVERY_HOURS = [1, 2, 3, 4, 6, 8, 12, 24];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const AGE_RE = /^age1[02-9ac-hj-np-z]{58}$/;

export interface BackupConfigPatch {
  atHour?: number;
  everyHours?: number;
  keepDays?: number;
  mailTo?: string | null;
  ageRecipient?: string | null;
}

/**
 * Резервные копии PMS для админки Kars Avia (02.11.2026, после аварии Beget).
 *
 * Ответ — та же форма, что у Авии (`BackupSystemState` в её
 * `libs/shared/src/lib/backups.ts`): общий экран показывает обе системы, а
 * правило «как дела» и оповещения считает Авиа. Пишет журнал служба `backup`
 * (backup/run.sh), здесь — только чтение, настройки и отметка «сделать сейчас».
 * Только админский клиент: таблицы служебные, app_user их не видит.
 */
@Injectable()
export class BackupsService {
  constructor(private readonly prisma: PrismaService) {}

  async state() {
    const db = this.prisma.admin;
    const [config, runs] = await Promise.all([
      db.backupConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }),
      db.backupRun.findMany({ orderBy: { startedAt: 'desc' }, take: RUNS_SHOWN }),
    ]);
    return {
      config: {
        atHour: config.atHour,
        everyHours: config.everyHours,
        keepDays: config.keepDays,
        mailTo: config.mailTo,
        ageRecipient: config.ageRecipient,
        runRequestedAt: config.runRequestedAt?.toISOString() ?? null,
      },
      agentSeenAt: config.agentSeenAt?.toISOString() ?? null,
      agentInfo: config.agentInfo ?? null,
      runs: runs.map((r) => ({
        id: r.id,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
        status: r.status,
        trigger: r.trigger,
        file: r.file,
        sizeBytes: r.sizeBytes == null ? null : Number(r.sizeBytes),
        mail: r.mail,
        offsite: r.offsite,
        files: null,
        error: r.error,
      })),
    };
  }

  async saveConfig(raw: BackupConfigPatch) {
    const data: BackupConfigPatch = {};
    if (raw.atHour !== undefined) {
      if (!Number.isInteger(raw.atHour) || raw.atHour < 0 || raw.atHour > 23) throw new BadRequestException('atHour: 0–23');
      data.atHour = raw.atHour;
    }
    if (raw.everyHours !== undefined) {
      if (!EVERY_HOURS.includes(raw.everyHours)) throw new BadRequestException(`everyHours: ${EVERY_HOURS.join(', ')}`);
      data.everyHours = raw.everyHours;
    }
    if (raw.keepDays !== undefined) {
      if (!Number.isInteger(raw.keepDays) || raw.keepDays < 1 || raw.keepDays > 365) throw new BadRequestException('keepDays: 1–365');
      data.keepDays = raw.keepDays;
    }
    if (raw.mailTo !== undefined) {
      const v = raw.mailTo?.trim() || null;
      if (v && !EMAIL_RE.test(v)) throw new BadRequestException(`mailTo: ${v}`);
      data.mailTo = v;
    }
    if (raw.ageRecipient !== undefined) {
      const v = raw.ageRecipient?.trim() || null;
      if (v && !AGE_RE.test(v)) throw new BadRequestException('ageRecipient: age1…');
      data.ageRecipient = v;
    }
    await this.prisma.admin.backupConfig.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
    return this.state();
  }

  /** «Сделать копию сейчас»: служба увидит отметку в течение минуты. */
  async requestRun() {
    const now = new Date();
    await this.prisma.admin.backupConfig.upsert({ where: { id: 1 }, update: { runRequestedAt: now }, create: { id: 1, runRequestedAt: now } });
    return this.state();
  }
}
