import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { OwnerInviteService } from './owner-invite.service';
import { AcceptOwnerInviteDto } from './dto/accept-owner-invite.dto';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthenticatedRequestUser } from './strategies/jwt.strategy';

const REFRESH_COOKIE = 'refresh_token';

/* Вход в гостиницу по ссылке из Kars Avia продлевается СВОЕЙ кукой — на пути
   этой гостиницы. Общая кука одна на браузер, а вкладки диспетчера — разные
   гостиницы: вход в соседней вкладке переписывал её, и продление уводило
   вкладку в чужую гостиницу (бой, 25.10.2026). Кука с путём гостиницы уходит
   только на её ручки — вкладки разных гостиниц друг другу не мешают. */
const HOTEL_REFRESH_COOKIE = 'refresh_hotel';
const hotelCookiePath = (tenantId: string) => `/api/auth/hotel/${tenantId}`;

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly invites: OwnerInviteService,
  ) {}

  /* Э10 · приглашение владельца: страница без входа показывает, куда
     приглашают; принятие задаёт пароль и сразу входит — тем же входом, что
     обычный логин (одна выдача сессии на всю систему). */
  @Public()
  @Get('invite/:token')
  @ApiOperation({ summary: 'Owner invite: what hotel and whom it is for' })
  peekInvite(@Param('token') token: string) {
    return this.invites.peek(token);
  }

  @Public()
  @Post('invite/:token/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Owner invite: set password, create the OWNER account and sign in' })
  async acceptInvite(
    @Param('token') token: string,
    @Body() dto: AcceptOwnerInviteDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const created = await this.invites.accept(token, dto.password);
    const { user, tokens } = await this.auth.login(
      { email: created.email, password: dto.password } as never,
      req.ip,
      req.headers['user-agent'],
    );
    this.setRefreshCookie(res, tokens.refreshToken, tokens.refreshTtlSeconds);
    return { user, accessToken: tokens.accessToken, accessTtlSeconds: tokens.accessTtlSeconds };
  }

  /* Открытая регистрация ЗАКРЫТА (152-ФЗ, Р-45, решение владельца 12; план
     13.2): самозарегистрированный владелец получал все права гостиницы, а
     гостиница в системе — это обработка ПДн по поручению. Кабинет теперь
     только по приглашению Kars Avia (`/invite/:token`); гостиницу заводит
     партнёр (connect API) или администратор платформы. Ручка оставлена, чтобы
     старые клиенты получали понятный отказ, а не 404. */
  @Public()
  @Post('register-tenant')
  @ApiOperation({ summary: 'Closed: hotels join by Kars Avia invitation only' })
  @ApiResponse({ status: 403, description: 'Registration is by invitation only' })
  registerTenant(): never {
    throw new ForbiddenException('Регистрация гостиниц — только по приглашению Kars Avia');
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login by tenant slug + email + password' })
  @ApiResponse({ status: 200, description: 'Authenticated' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiBody({ type: LoginDto })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, tokens } = await this.auth.login(dto, req.ip, req.headers['user-agent']);
    this.setRefreshCookie(res, tokens.refreshToken, tokens.refreshTtlSeconds);
    return {
      user,
      accessToken: tokens.accessToken,
      accessTtlSeconds: tokens.accessTtlSeconds,
    };
  }

  @Public()
  @Post('sso/exchange')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Exchange a one-time partner SSO code (issued to the Kars Avia dispatcher platform) for an access token',
  })
  @ApiResponse({ status: 200, description: 'Access token issued' })
  @ApiResponse({ status: 401, description: 'Code invalid or expired' })
  async ssoExchange(
    @Body() body: { code?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!body?.code) throw new UnauthorizedException('SSO code is required');
    const { refreshToken, refreshTtlSeconds, ...rest } = await this.auth.exchangeSsoCode(
      body.code,
      req.ip,
      req.headers['user-agent'],
    );
    /* Кука ставится так же, как при обычном входе: иначе сессия жила ровно
       час, а перезагрузка обрывала её и раньше. Вход в гостиницу — кукой
       гостиницы; без её id куки нет вовсе, но общей она не станет. */
    if (rest.mode === 'admin') {
      this.setRefreshCookie(res, refreshToken, refreshTtlSeconds);
    } else if (rest.tenant) {
      this.setHotelRefreshCookie(res, rest.tenant.id, refreshToken, refreshTtlSeconds);
    }
    return rest;
  }

  @Post('exit-impersonation')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Exit impersonation: re-issue a token for the operator (imp claim). Works without a refresh cookie (SSO dispatcher / super-admin).',
  })
  @ApiResponse({ status: 200, description: 'Operator token re-issued' })
  @ApiResponse({ status: 400, description: 'Not in an impersonation session' })
  async exitImpersonation(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!user.impersonatedBy) {
      throw new BadRequestException('Not in an impersonation session');
    }
    const { refreshToken, refreshTtlSeconds, ...rest } = await this.auth.exitImpersonation(
      user.impersonatedBy,
      req.ip,
      req.headers['user-agent'],
      user.tenantId,
    );
    /* Вкладка после выхода — в своей панели и продлевается общей кукой. */
    this.setRefreshCookie(res, refreshToken, refreshTtlSeconds);
    return rest;
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: 'Rotate refresh token, issue a new access token' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 401, description: 'Refresh token missing/invalid/expired' })
  async refresh(@Req() req: Request, @Res() res: Response) {
    return this.rotate(req, res, REFRESH_COOKIE, (token, ttl) =>
      this.setRefreshCookie(res, token, ttl),
    );
  }

  @Public()
  @Post('hotel/:tenantId/refresh')
  @ApiOperation({ summary: 'Rotate the hotel refresh token of a Kars Avia SSO session in that hotel' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 401, description: 'No refresh token of this hotel, or it belongs to another session' })
  async refreshHotel(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.rotate(
      req,
      res,
      HOTEL_REFRESH_COOKIE,
      (token, ttl) => this.setHotelRefreshCookie(res, tenantId, token, ttl),
      tenantId,
    );
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the refresh token bound to this session' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
    await this.auth.logout(cookies?.[REFRESH_COOKIE]);
    this.clearRefreshCookie(res);
    return;
  }

  /* Выход из гостиницы — её кукой. Общую не трогает: в ней может жить панель
     диспетчера или вход паролем в соседней вкладке. */
  @Public()
  @Post('hotel/:tenantId/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the hotel refresh token of a Kars Avia SSO session in that hotel' })
  async logoutHotel(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
    await this.auth.logout(cookies?.[HOTEL_REFRESH_COOKIE]);
    res.clearCookie(HOTEL_REFRESH_COOKIE, { path: hotelCookiePath(tenantId) });
    return;
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the authenticated user + permissions' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 401 })
  async me(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.auth.me(user.userId, user.tenantId, user.impersonatedBy, {
      roleCode: user.roleCode,
      permissions: user.permissions,
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /* Кука с флагом Secure над голым HTTP молча выбрасывается браузером: вход
   * проходит, а обновление токена приходит без куки — сессия отваливается.
   * Признак поэтому выводится из PUBLIC_URL (compose передаёт туда PMS_DOMAIN):
   * адрес со схемой http:// — переходный режим без TLS, кука обычная; голое
   * доменное имя — боевой HTTPS, кука защищённая. Та же починка, что в Kars
   * Avia 02.09.2026. */
  private static cookieSecure(): boolean {
    if (process.env.NODE_ENV !== 'production') return false;
    return !(process.env.PUBLIC_URL ?? '').startsWith('http://');
  }

  /* Продление по куке `cookie`; `hotelTenantId` — вход в эту гостиницу. */
  private async rotate(
    req: Request,
    res: Response,
    cookie: string,
    setCookie: (token: string, ttlSeconds: number) => void,
    hotelTenantId?: string,
  ) {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
    const refreshToken = cookies?.[cookie];
    if (!refreshToken) {
      res
        .status(401)
        .json({ statusCode: 401, message: 'Missing refresh token', error: 'Unauthorized' });
      return;
    }
    try {
      const tokens = await this.auth.refresh(
        refreshToken,
        req.ip,
        req.headers['user-agent'],
        hotelTenantId,
      );
      setCookie(tokens.refreshToken, tokens.refreshTtlSeconds);
      res.json({ accessToken: tokens.accessToken, accessTtlSeconds: tokens.accessTtlSeconds });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Invalid or expired refresh token';
      res.status(401).json({ statusCode: 401, message: msg, error: 'Unauthorized' });
    }
  }

  private setRefreshCookie(res: Response, token: string, ttlSeconds: number) {
    res.cookie(REFRESH_COOKIE, token, AuthController.cookieOptions(ttlSeconds, '/api/auth'));
  }

  private setHotelRefreshCookie(res: Response, tenantId: string, token: string, ttlSeconds: number) {
    res.cookie(
      HOTEL_REFRESH_COOKIE,
      token,
      AuthController.cookieOptions(ttlSeconds, hotelCookiePath(tenantId)),
    );
  }

  private static cookieOptions(ttlSeconds: number, path: string) {
    return {
      httpOnly: true,
      secure: AuthController.cookieSecure(),
      sameSite: 'lax' as const,
      maxAge: ttlSeconds * 1000,
      path,
    };
  }

  private clearRefreshCookie(res: Response) {
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  }
}
