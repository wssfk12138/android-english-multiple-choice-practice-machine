export function resolveUpdateSetting(
  buildOverride: unknown,
  storedValue: unknown,
  fallbackValue = '',
): string {
  const override = typeof buildOverride === 'string' ? buildOverride.trim() : ''
  if (override) return override
  if (storedValue !== undefined && storedValue !== null) {
    return String(storedValue).trim()
  }
  return fallbackValue.trim()
}
