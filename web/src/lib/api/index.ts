import { CATALOG_SOURCE, IS_DEMO } from '../config';
import { withServerCatalog } from './catalog';
import { demoBackend } from './demo';
import { supabaseBackend } from './supabase';
import type { Backend } from './types';

export type { AuthUser, Backend, UploadedFile } from './types';

const base: Backend = IS_DEMO ? demoBackend : supabaseBackend;

/**
 * The active backend for this build. Auth and purchases come from Supabase (or
 * the in-memory demo); listings and notes come from Sanity via the payment
 * server unless NEXT_PUBLIC_CATALOG_SOURCE=local.
 */
export const api: Backend = CATALOG_SOURCE === 'sanity' ? withServerCatalog(base) : base;
