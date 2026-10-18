/**
 * MATIKS HACKATHON ENGINE — CORS & CLIENT ORIGIN GOVERNANCE (corsOrigins.ts)
 * 
 * Centralized allowlist and verification predicate shared between:
 * 1. Express CORS middleware (app.ts)
 * 2. OIDC redirect state binding & callback validation (authController.ts)
 */

const DEV_CLIENT_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const PROD_CLIENT_ORIGINS = ['https://matiks.fossclub.tech', 'https://matiks-usarfoss.vercel.app'];

export const DEFAULT_CLIENT_ORIGINS = PROD_CLIENT_ORIGINS;

export const CORS_ONLY_ORIGINS = [
  'https://fossclub.tech',
  'https://www.fossclub.tech'
];

export const DEFAULT_ALLOWED_ORIGINS = [
  ...DEFAULT_CLIENT_ORIGINS,
  ...CORS_ONLY_ORIGINS
];

/**
 * Returns the exact list of configured trusted origins.
 * For redirect operations, returns only valid client application origins.
 * In non-production environments, loopback development origins are included.
 */
export function getAllowedOrigins(options: { forRedirect?: boolean } = {}): string[] {
  const forRedirect = options.forRedirect ?? true;
  if (typeof process.env.CORS_ORIGINS === 'string' && process.env.CORS_ORIGINS.trim().length > 0) {
    const list = process.env.CORS_ORIGINS.split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
    return forRedirect ? list.filter(o => !CORS_ONLY_ORIGINS.includes(o)) : list;
  }
  const devExtras = process.env.NODE_ENV !== 'production' ? DEV_CLIENT_ORIGINS : [];
  return forRedirect
    ? [...devExtras, ...DEFAULT_CLIENT_ORIGINS]
    : [...devExtras, ...DEFAULT_ALLOWED_ORIGINS];
}



/**
 * Checks whether preview deployments on Vercel are enabled.
 * Preview access is strictly opt-in via ALLOW_VERCEL_PREVIEWS === 'true'
 * (or in development mode when custom CORS is not explicitly provided).
 */
export function isVercelPreviewAllowed(): boolean {
  return process.env.ALLOW_VERCEL_PREVIEWS === 'true' && process.env.NODE_ENV !== 'production';
}


/**
 * Regex matching legitimate preview branch deployments under the USAR FOSS team scope on Vercel.
 * Format: https://matiks-git-<branch>-usarfoss.vercel.app
 */
export const VERCEL_PREVIEW_ORIGIN_REGEX = /^https:\/\/matiks-git-[a-z0-9-]+-usarfoss\.vercel\.app$/;

/**
 * Checks whether an origin is allowed for client operations.
 * - forRedirect=true (default): Strictly requires exact match in the client allowlist.
 *   Never redirects sensitive authorization codes to pattern-matched hosts or non-client portals.
 * - forRedirect=false: Allows credentialed CORS for portal sites and preview environments if enabled.
 */
export function isAllowedClientOrigin(candidate: string, options: { forRedirect?: boolean } = {}): boolean {
  const forRedirect = options.forRedirect ?? true;
  if (!candidate || typeof candidate !== 'string') return false;
  const normalized = candidate.trim().replace(/\/+$/, '');
  const allowed = getAllowedOrigins({ forRedirect });

  if (allowed.includes(normalized)) {
    return true;
  }

  // Previews are never eligible for code redirection without an explicit allowlist entry
  if (!forRedirect && isVercelPreviewAllowed() && VERCEL_PREVIEW_ORIGIN_REGEX.test(normalized)) {
    return true;
  }

  return false;
}
