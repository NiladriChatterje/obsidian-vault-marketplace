/**
 * Loads the repo-root .env. Imported first by index.ts (ESM evaluates imports
 * in order) so shared modules that read process.env at import time see it.
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';

loadEnv({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true });
