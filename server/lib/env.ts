import { config } from 'dotenv';
import { z } from 'zod';

config();

function parseBooleanEnv(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) {
      return true;
    }

    if (['false', '0', 'no', 'n'].includes(normalized)) {
      return false;
    }
  }

  return value;
}

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().default(8787),
    APP_BASE_URL: z.string().url().default('http://localhost:5173'),
    API_BASE_URL: z.string().url().default('http://localhost:8787'),
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(16),
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    GEMINI_PROVIDER: z.enum(['ai_studio', 'vertex']).optional(),
    GOOGLE_GENAI_USE_VERTEXAI: z.preprocess(
      parseBooleanEnv,
      z.boolean().optional(),
    ),
    GEMINI_API_KEY: z.string().min(1).optional(),
    GOOGLE_CLOUD_PROJECT: z.string().min(1).optional(),
    GOOGLE_CLOUD_LOCATION: z.string().min(1).optional(),
    GEMINI_LIVE_MODEL: z.string().default('gemini-live-2.5-flash-preview'),
    GEMINI_CHARACTER_SUBAGENT_MODEL: z.string().default('gemini-2.5-flash'),
    GEMINI_STORYBOARD_SUBAGENT_MODEL: z.string().default('gemini-2.5-flash'),
    GEMINI_STORYBOARD_IMAGE_MODEL: z.string().default('gemini-2.5-flash-image'),
    GEMINI_CHARACTER_DESIGN_IMAGE_MODEL: z
      .string()
      .default('imagen-4.0-generate-001'),
    DEBUG_MONITOR_ENABLED: z
      .preprocess(parseBooleanEnv, z.boolean())
      .default(false),
    DEBUG_MONITOR_MAX_EVENTS: z.coerce.number().int().min(100).default(2000),
  })
  .superRefine((value, context) => {
    const provider =
      value.GEMINI_PROVIDER ??
      (value.GOOGLE_GENAI_USE_VERTEXAI === true ? 'vertex' : 'ai_studio');

    if (
      value.GEMINI_PROVIDER &&
      value.GOOGLE_GENAI_USE_VERTEXAI !== undefined &&
      (value.GEMINI_PROVIDER === 'vertex') !== value.GOOGLE_GENAI_USE_VERTEXAI
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GOOGLE_GENAI_USE_VERTEXAI'],
        message:
          'GOOGLE_GENAI_USE_VERTEXAI conflicts with GEMINI_PROVIDER; align both values',
      });
    }

    if (provider === 'ai_studio' && !value.GEMINI_API_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GEMINI_API_KEY'],
        message: 'GEMINI_API_KEY is required when GEMINI_PROVIDER=ai_studio',
      });
    }

    if (provider === 'vertex') {
      if (!value.GOOGLE_CLOUD_PROJECT) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['GOOGLE_CLOUD_PROJECT'],
          message:
            'GOOGLE_CLOUD_PROJECT is required when GEMINI_PROVIDER=vertex',
        });
      }

      if (!value.GOOGLE_CLOUD_LOCATION) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['GOOGLE_CLOUD_LOCATION'],
          message:
            'GOOGLE_CLOUD_LOCATION is required when GEMINI_PROVIDER=vertex',
        });
      }
    }
  });

const parsedEnv = envSchema.parse(process.env);

export const env = {
  ...parsedEnv,
  GEMINI_PROVIDER:
    parsedEnv.GEMINI_PROVIDER ??
    (parsedEnv.GOOGLE_GENAI_USE_VERTEXAI === true ? 'vertex' : 'ai_studio'),
};
