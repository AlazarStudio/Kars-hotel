import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Mark a controller / handler as accessible without authentication. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
