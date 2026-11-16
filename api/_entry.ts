import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApiApp } from '../serverApp.ts';

const app = createApiApp();

export default function handler(req: IncomingMessage, res: ServerResponse) {
  const rawUrl = req.url || '/';
  const parsed = new URL(rawUrl, 'http://localhost');
  const vpath = parsed.searchParams.get('__vpath');

  if (vpath !== null) {
    parsed.searchParams.delete('__vpath');
    const qs = parsed.searchParams.toString();
    const normalizedPath = vpath.startsWith('/') ? vpath : `/${vpath}`;
    const targetPath = normalizedPath.startsWith('/api/')
      ? normalizedPath
      : `/api${normalizedPath === '/' ? '' : normalizedPath}`;
    req.url = `${targetPath}${qs ? `?${qs}` : ''}`;
  }

  return app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}
