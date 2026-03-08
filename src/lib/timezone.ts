/**
 * Browser-safe timezone validation using Intl.DateTimeFormat.
 * Extracted so both client components and server code can import
 * without pulling in croner (server-only).
 */
export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
