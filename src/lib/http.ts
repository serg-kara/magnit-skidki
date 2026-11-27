import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function notFound(message: string) {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function serverError(message: string) {
  return NextResponse.json({ error: message }, { status: 500 });
}

/** §5: все входные параметры через zod, ошибки 400 с внятным текстом. */
export function fromZodError(err: ZodError): string {
  const first = err.issues[0];
  if (!first) return 'Некорректный запрос';
  const path = first.path.join('.');
  return `${path ? `Параметр «${path}»` : 'Параметр запроса'}: ${first.message}`;
}

export function searchParamsOf(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of new URL(request.url).searchParams.entries()) out[key] = value;
  return out;
}
