export type RecordItem = { id: number; [key: string]: unknown };
export type Paged<T> = { count: number; next: string | null; results: T[] };

export type Conflict = { code: string; message: string; conflicting_session_id?: number | null; offering_id?: number; group_code?: string; subject_name?: string; required_minutes?: number; allocated_minutes?: number };
export class ApiError extends Error {
  constructor(message: string, public status: number, public details: unknown) { super(message); }
}

function csrfToken(): string {
  return document.cookie.split('; ').find((part) => part.startsWith('csrftoken='))?.split('=')[1] ?? '';
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.method && init.method !== 'GET' ? { 'X-CSRFToken': csrfToken() } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
      const session = await fetch('/api/v1/auth/session/', { credentials: 'same-origin', cache: 'no-store' }).then((result) => result.json()).catch(() => null);
      if (session?.authenticated === false) window.dispatchEvent(new Event('orbita:auth-expired'));
    }
    let detail = '';
    if (body.detail) {
      detail = String(body.detail);
    } else if (body.message) {
      detail = String(body.message);
    } else if (Array.isArray(body.conflicts) && body.conflicts.length) {
      detail = body.conflicts.map((c: { message?: string; code?: string }) => c.message || c.code).join(' · ');
    } else {
      detail = Object.entries(body)
        .map(([key, value]) => {
          if (Array.isArray(value)) return `${value.join(', ')}`;
          if (typeof value === 'object' && value !== null) return `${key}: ${JSON.stringify(value)}`;
          return `${value}`;
        })
        .join(' · ');
    }
    throw new ApiError(detail || `Erro HTTP ${response.status}`, response.status, body);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function list<T = RecordItem>(resource: string): Promise<Paged<T>> {
  return api<Paged<T>>(`${resource}/`);
}

export async function listAll<T = RecordItem>(resource: string): Promise<T[]> {
  const rows: T[] = [];
  let page = 1;
  while (true) {
    const result = await api<Paged<T>>(`${resource}/?page=${page}`);
    rows.push(...result.results);
    if (!result.next) return rows;
    page += 1;
  }
}

export function create<T = RecordItem>(resource: string, data: Record<string, unknown>): Promise<T> {
  return api<T>(`${resource}/`, { method: 'POST', body: JSON.stringify(data) });
}

export function update<T = RecordItem>(resource: string, id: number, data: Record<string, unknown>): Promise<T> {
  return api<T>(`${resource}/${id}/`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function remove(resource: string, id: number): Promise<void> {
  return api<void>(`${resource}/${id}/`, { method: 'DELETE' });
}
