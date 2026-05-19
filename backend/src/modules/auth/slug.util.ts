/**
 * Generate a URL-safe slug from arbitrary hotel name (Russian / English / mixed).
 *
 *   "Отель Парковый"   → "otel-parkoviy"
 *   "Hotel Москва 5*"  → "hotel-moskva-5"
 *   "  Δ Café "        → "cafe"  (Δ is dropped — not in our table)
 *
 * The output is at most 32 chars and matches  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.
 *
 * Collision resolution (suffixing "-2", "-3", …) is the caller's responsibility.
 */

const RU_TABLE: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh',
  з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu',
  я: 'ya',
};

export function slugifyHotelName(name: string): string {
  const lower = name.toLowerCase();
  let out = '';
  for (const ch of lower) {
    if (RU_TABLE[ch] !== undefined) out += RU_TABLE[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else if (/\s|[-_.]/.test(ch)) out += '-';
    // everything else is dropped
  }
  // collapse dashes, trim
  out = out.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  // cap at 32
  if (out.length > 32) out = out.slice(0, 32).replace(/-+$/g, '');
  // pattern requires the first/last char to be alphanumeric; minimum length 1
  if (!out || !/^[a-z0-9]/.test(out)) out = 'hotel';
  return out;
}
