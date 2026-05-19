import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterTenantDto } from './dto/register-tenant.dto';
import { LoginDto } from './dto/login.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthenticatedRequestUser } from './strategies/jwt.strategy';

const REFRESH_COOKIE = 'refresh_token';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register-tenant')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a brand-new tenant and its OWNER user' })
  @ApiResponse({ status: 201, description: 'Tenant + OWNER created, tokens issued' })
  @ApiResponse({ status: 409, description: 'Slug already taken' })
  @ApiBody({ type: RegisterTenantDto })
  async registerTenant(
    @Body() dto: RegisterTenantDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { tenantId, userId, tokens } = await this.auth.registerTenant(
      dto,
      req.ip,
      req.headers['user-agent'],
    );
    this.setRefreshCookie(res, tokens.refreshToken, tokens.refreshTtlSeconds);
    return {
      tenantId,
      userId,
      accessToken: tokens.accessToken,
      accessTtlSeconds: tokens.accessTtlSeconds,
    };
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
  @Post('refresh')
  @ApiOperation({ summary: 'Rotate refresh token, issue a new access token' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 401, description: 'Refresh token missing/invalid/expired' })
  async refresh(@Req() req: Request, @Res() res: Response) {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
    const refreshToken = cookies?.[REFRESH_COOKIE];
    if (!refreshToken) {
      res.status(401).json({ statusCode: 401, message: 'Missing refresh token', error: 'Unauthorized' });
      return;
    }
    try {
      const tokens = await this.auth.refresh(refreshToken, req.ip, req.headers['user-agent']);
      this.setRefreshCookie(res, tokens.refreshToken, tokens.refreshTtlSeconds);
      res.json({ accessToken: tokens.accessToken, accessTtlSeconds: tokens.accessTtlSeconds });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Invalid or expired refresh token';
      res.status(401).json({ statusCode: 401, message: msg, error: 'Unauthorized' });
    }
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

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the authenticated user + permissions' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 401 })
  async me(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.auth.me(user.userId, user.tenantId);
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private setRefreshCookie(res: Response, token: string, ttlSeconds: number) {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: ttlSeconds * 1000,
      path: '/api/auth',
    });
  }

  private clearRefreshCookie(res: Response) {
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  }
}
