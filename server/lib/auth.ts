import { betterAuth } from 'better-auth';
import { prismaAdapter } from '@better-auth/prisma-adapter';
import { prisma } from './db';
import { env } from './env';

export const auth = betterAuth({
  appName: 'Leobot',
  baseURL: env.API_BASE_URL,
  basePath: '/api/auth',
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.APP_BASE_URL, env.API_BASE_URL],
  database: prismaAdapter(prisma, {
    provider: 'mongodb',
    transaction: false,
  }),
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
  },
});

export async function getSessionFromHeaders(headers: Headers) {
  return auth.api.getSession({ headers });
}
