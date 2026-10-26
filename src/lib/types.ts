// Model internal yang ternormalisasi. Semua format import (Postman, OpenAPI, Swagger) diubah ke bentuk ini.

export type KV = { key: string; value: string; enabled: boolean; description?: string; type?: 'text' | 'file' };

export type Auth =
  | { type: 'inherit' }
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'apikey'; key: string; value: string; in: 'header' | 'query' };

export type Body =
  | { mode: 'none' }
  | { mode: 'json'; raw: string }
  | { mode: 'raw'; raw: string; contentType?: string }
  | { mode: 'urlencoded'; fields: KV[] }
  | { mode: 'formdata'; fields: KV[] };

export type Example = {
  name: string;
  status: number;
  statusText?: string;
  headers: KV[];
  body: string;
};

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export type RequestItem = {
  kind: 'request';
  id: string;
  name: string;
  method: Method;
  /** URL tanpa query string. Variabel env memakai {{nama}}, path variable memakai :nama */
  url: string;
  description?: string;
  query: KV[];
  pathVars: KV[];
  headers: KV[];
  body: Body;
  auth: Auth;
  examples: Example[];
};

export type FolderItem = {
  kind: 'folder';
  id: string;
  name: string;
  description?: string;
  auth: Auth;
  items: Item[];
};

export type Item = RequestItem | FolderItem;

export type ProjectMeta = {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  tags: string[];
  color: string;
  icon: string;
  published: boolean;
  featured: boolean;
  order: number;
  source: 'postman' | 'openapi' | 'swagger' | 'manual';
  endpointCount: number;
  createdAt: string;
  updatedAt: string;
  demo?: boolean;
};

export type Project = ProjectMeta & {
  variables: KV[];
  auth: Auth;
  items: Item[];
};

/** Hasil importer sebelum digabung dengan metadata dari admin */
export type ImportResult = {
  source: ProjectMeta['source'];
  name: string;
  description: string;
  version?: string;
  variables: KV[];
  auth: Auth;
  items: Item[];
  endpointCount: number;
  warnings: string[];
};
