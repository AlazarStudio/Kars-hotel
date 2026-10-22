import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { Request } from 'express';
import type { AuthenticatedRequestUser } from '../../modules/auth/strategies/jwt.strategy';
import { PlatformOperatorGuard } from '../../modules/super-admin/super-admin.guard';
import { redactForJournal } from './journal-redact';
import { JournalService, type JournalRow } from './journal.service';

/* Одно действие в кабинете: нажатие, переход, окно, форма. Введённый текст
   сюда не попадает — только что нажато (решение 23.10.2026). */
class UiEventDto {
  @IsISO8601() at!: string;
  @IsString() @MaxLength(32) event!: string;
  @IsOptional() @IsString() @MaxLength(300) label?: string;
  @IsOptional() @IsString() @MaxLength(500) page?: string;
  @IsOptional() @IsString() @MaxLength(300) target?: string;
  @IsOptional() @IsString() @MaxLength(64) actionId?: string;
  @IsOptional() @IsObject() meta?: Record<string, unknown>;
}

class UiBatchDto {
  @IsString() @MaxLength(64) sessionId!: string;
  /** Часы браузера в момент отправки — по ним время действий сводится к часам сервера. */
  @IsISO8601() sentAt!: string;
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => UiEventDto)
  events!: UiEventDto[];
}

class QueryJournalDto {
  @IsOptional() @IsString() @MaxLength(64) tenantId?: string;
  @IsOptional() @IsString() @MaxLength(64) userId?: string;
  @IsOptional() @IsIn(['request', 'ui']) kind?: string;
  @IsOptional() @IsString() @MaxLength(64) sessionId?: string;
  @IsOptional() @IsString() @MaxLength(64) actionId?: string;
  @IsOptional() @IsString() @MaxLength(200) q?: string;
  @IsOptional() @IsIn(['1']) failed?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @IsISO8601() before?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) take?: number;
}

const MAX_SKEW_MS = 24 * 3600_000;

@Controller()
export class JournalController {
  constructor(private readonly journal: JournalService) {}

  /* След кабинета — пачкой. Пишет любой вошедший: это его собственные нажатия. */
  @Post('journal/ui')
  @HttpCode(204)
  ui(@Req() req: Request, @Body() dto: UiBatchDto): void {
    const user = req.user as AuthenticatedRequestUser;
    const now = Date.now();
    const sent = Date.parse(dto.sentAt);
    const offset = Math.abs(now - sent) < MAX_SKEW_MS ? now - sent : 0;
    const ua = req.headers['user-agent'];
    for (const e of dto.events) {
      const t = Date.parse(e.at) + offset;
      const row: JournalRow = {
        at: new Date(Math.abs(now - t) < MAX_SKEW_MS ? t : now),
        kind: 'ui',
        tenantId: user.tenantId || null,
        userId: user.userId || null,
        email: user.email ?? null,
        impersonatedBy: user.impersonatedBy ?? null,
        sessionId: dto.sessionId,
        actionId: e.actionId ?? null,
        event: e.event,
        label: e.label ?? null,
        page: e.page ?? null,
        target: e.target ?? null,
        meta: e.meta ? (redactForJournal(e.meta, '') as object) : undefined,
        ip: req.ip ?? null,
        userAgent: (Array.isArray(ua) ? ua[0] : ua)?.slice(0, 200) ?? null,
      };
      this.journal.push(row);
    }
  }

  /* Читает платформа: суперадмин и диспетчер Kars Avia (не «от имени»). */
  @Get('admin/journal')
  @UseGuards(PlatformOperatorGuard)
  list(@Query() q: QueryJournalDto) {
    return this.journal.list(q);
  }
}
