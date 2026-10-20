/**
 * MATIKS HACKATHON ENGINE — AUTH PROVIDER FACTORY (authProviderFactory.ts)
 * 
 * Factory that instantiates and supplies the active IAuthProvider implementation
 * based on process.env.AUTH_MODE ('local' vs 'club_oidc').
 * Provides dependency injection hooks for automated test suites and hybrid OIDC SSO support.
 */

import type { AuthUser, IAuthProvider } from '../../types/auth.js';
import { LocalHackathonAuthProvider } from './localAuthProvider.js';
import { ClubOidcAuthProvider } from './clubOidcAuthProvider.js';

let customProvider: IAuthProvider | null = null;
let localProviderInstance: LocalHackathonAuthProvider | null = null;
let oidcProviderInstance: ClubOidcAuthProvider | null = null;

export function getClubOidcProvider(): ClubOidcAuthProvider {
  if (!oidcProviderInstance) {
    oidcProviderInstance = new ClubOidcAuthProvider();
  }
  return oidcProviderInstance;
}

export function getAuthProvider(): IAuthProvider {
  if (customProvider) {
    return customProvider;
  }

  const mode = (process.env.AUTH_MODE || 'local').toLowerCase().trim();

  if (mode === 'club_oidc') {
    return getClubOidcProvider();
  }

  if (!localProviderInstance) {
    localProviderInstance = new LocalHackathonAuthProvider();
  }
  return localProviderInstance;
}

export async function verifyAnySession(token: string): Promise<AuthUser | null> {
  const primary = getAuthProvider();
  const user = await primary.verifySession(token);
  if (user) return user;

  if (!customProvider) {
    let oidc: ClubOidcAuthProvider | null = null;
    try {
      oidc = getClubOidcProvider();
    } catch {
      return null;
    }
    if (primary !== oidc) {
      return oidc.verifySession(token);
    }
  }
  return null;
}

export function setAuthProvider(provider: IAuthProvider | null): void {
  customProvider = provider;
}

export function resetAuthProviderInstances(): void {
  customProvider = null;
  localProviderInstance = null;
  oidcProviderInstance = null;
}
