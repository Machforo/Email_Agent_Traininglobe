/**
 * Worker entry. boot.ts must load before any other import so APP_ROLE and .env
 * are in place when db.ts sizes its pool and groq.ts reads keys.
 */
import './boot';

void import('./main');
