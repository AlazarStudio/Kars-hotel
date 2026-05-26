import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'required_permissions';

/**
 * Declare which permission codes are required to call this endpoint.
 * All listed codes must be present in req.user.permissions (AND semantics).
 *
 * @example
 *   @RequirePermissions('reservation.create')
 *   @Post()
 *   create(...) {}
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
