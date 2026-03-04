import { createAuthClient } from 'better-auth/react';

export const authBaseUrl =
  import.meta.env.VITE_AUTH_BASE_URL ?? `${window.location.origin}/api/auth`;

export const authClient = createAuthClient({
  baseURL: authBaseUrl,
});
