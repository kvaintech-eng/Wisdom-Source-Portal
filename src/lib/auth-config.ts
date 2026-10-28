export function isPortalAuthEnabled(
  isSupabaseConfigured: boolean,
  authFlag: string | undefined,
): boolean {
  return isSupabaseConfigured && authFlag === 'true';
}
