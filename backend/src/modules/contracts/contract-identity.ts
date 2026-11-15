/** A registry row, a legacy price document and a tariff share the same key. */
export const contractNumberKey = (value: string | null | undefined): string => value?.trim() ?? '';
