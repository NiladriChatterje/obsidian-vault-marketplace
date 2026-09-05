import { IS_DEMO } from '../config';
import { demoBackend } from './demo';
import { supabaseBackend } from './supabase';
import type { Backend } from './types';

export type { AuthUser, Backend, UploadedFile } from './types';

/** The active backend for this build. */
export const api: Backend = IS_DEMO ? demoBackend : supabaseBackend;
