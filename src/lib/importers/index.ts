import type { ImportResult, KV } from '../types';
import { importOpenAPI, isOpenAPI } from './openapi';
import { importPostman, importPostmanEnvironment, isPostmanCollection, isPostmanEnvironment } from './postman';

export class ImportError extends Error {}

export type Detected =
  | { kind: 'collection'; result: ImportResult }
  | { kind: 'environment'; name: string; variables: KV[] };

/** Deteksi format otomatis dari JSON mentah. */
export function detectAndImport(input: string | object): Detected {
  let json: any = input;
  if (typeof input === 'string') {
    try { json = JSON.parse(input); }
    catch (e: any) { throw new ImportError(`File bukan JSON yang valid: ${e.message}`); }
  }
  if (json?.collection && isPostmanCollection(json.collection)) json = json.collection; // export dari Postman API
  if (isPostmanCollection(json)) return { kind: 'collection', result: importPostman(json) };
  if (isOpenAPI(json)) return { kind: 'collection', result: importOpenAPI(json) };
  if (isPostmanEnvironment(json)) return { kind: 'environment', name: json.name || 'Environment', variables: importPostmanEnvironment(json) };
  throw new ImportError('Format tidak dikenali. Dukungan: Postman Collection v2.0/v2.1, Postman Environment, OpenAPI 3.x, Swagger 2.0 (JSON).');
}
