import type {
  AdminUser,
  CompleteResponse,
  Dashboard,
  Experiment,
  ExperimentAnalytics,
  ExperimentDraft,
  ExperimentListItem,
  Me,
  MediaItem,
  MediaKind,
  PreviewResponse,
  Role,
  RunInfo,
  RunPayload,
  SessionDetail,
  SessionListItem,
  ClientInfo,
  LiveSession,
} from "./types";

export interface StartBody {
  participantCode: string;
  client: ClientInfo;
  answers: Record<string, string>;
  consented: boolean;
}

/** Sunucunun ProblemDetails yanıtından okunan, kullanıcıya gösterilebilir hata. */
export class ApiError extends Error {
  readonly status: number;
  readonly detail?: string;
  readonly fields: Record<string, string[]>;

  constructor(status: number, title: string, detail?: string, fields: Record<string, string[]> = {}) {
    super(title);
    this.status = status;
    this.detail = detail;
    this.fields = fields;
  }

  field(name: string): string | undefined {
    return this.fields[name]?.[0];
  }
}

async function toError(res: Response): Promise<ApiError> {
  let title = res.status === 413 ? "Dosya çok büyük." : `İstek başarısız oldu (${res.status}).`;
  let detail: string | undefined;
  let fields: Record<string, string[]> = {};
  try {
    const body = await res.json();
    if (body?.title) title = body.title;
    if (body?.detail) detail = body.detail;
    if (body?.errors) fields = body.errors;
  } catch {
    if (res.status >= 500) title = "Sunucuda bir hata oluştu. Biraz sonra yeniden deneyin.";
  }
  return new ApiError(res.status, title, detail, fields);
}

export async function request<T>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body !== undefined ? { "Content-Type": "application/json", ...headers } : headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.");
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const get = <T,>(url: string) => request<T>("GET", url);
const post = <T,>(url: string, body?: unknown, headers?: Record<string, string>) => request<T>("POST", url, body ?? {}, headers);
const put = <T,>(url: string, body: unknown) => request<T>("PUT", url, body);
const patch = <T,>(url: string, body: unknown) => request<T>("PATCH", url, body);
const del = <T = void,>(url: string) => request<T>("DELETE", url);

export interface UploadMeta {
  name?: string;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  peaks?: number[] | null;
}

/** İlerleme bildirebilmek için XHR ile yükler; sırayla meta, kapak ve dosya parçalarını gönderir. */
export function uploadMedia(file: File, meta: UploadMeta, poster: Blob | null, onProgress: (fraction: number) => void, signal?: AbortSignal) {
  return new Promise<MediaItem>((resolve, reject) => {
    const form = new FormData();
    form.append("meta", new Blob([JSON.stringify(meta)], { type: "application/json" }));
    if (poster) form.append("poster", poster, "poster.jpg");
    form.append("file", file, file.name);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/media");
    xhr.responseType = "text";
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
      else reject(await toError(new Response(xhr.responseText, { status: xhr.status })));
    };
    xhr.onerror = () => reject(new ApiError(0, "Yükleme sırasında bağlantı koptu."));
    xhr.onabort = () => reject(new ApiError(0, "Yükleme iptal edildi."));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(form);
  });
}

export const api = {
  setupStatus: () => get<{ needsSetup: boolean }>("/api/setup"),
  setup: (email: string, displayName: string, password: string) => post<Me>("/api/setup", { email, displayName, password }),
  login: (email: string, password: string, remember: boolean) => post<Me>("/api/auth/login", { email, password, remember }),
  logout: () => post<void>("/api/auth/logout"),
  me: () => get<Me>("/api/auth/me"),
  changePassword: (currentPassword: string, newPassword: string) => post<void>("/api/auth/password", { currentPassword, newPassword }),

  dashboard: () => get<Dashboard>("/api/dashboard"),

  media: (kind?: MediaKind) => get<MediaItem[]>(kind ? `/api/media?kind=${kind}` : "/api/media"),
  renameMedia: (id: string, name: string) => patch<MediaItem>(`/api/media/${id}`, { name }),
  deleteMedia: (id: string) => del(`/api/media/${id}`),

  experiments: () => get<ExperimentListItem[]>("/api/experiments"),
  experiment: (id: string) => get<Experiment>(`/api/experiments/${id}`),
  createExperiment: (name: string, description: string) => post<Experiment>("/api/experiments", { name, description }),
  saveExperiment: (id: string, draft: ExperimentDraft) => put<Experiment>(`/api/experiments/${id}`, draft),
  preview: (id: string, draft: ExperimentDraft, seed?: number) => post<PreviewResponse>(`/api/experiments/${id}/preview`, { draft, seed }),
  duplicateExperiment: (id: string) => post<Experiment>(`/api/experiments/${id}/duplicate`),
  archiveExperiment: (id: string, archived: boolean) => post<void>(`/api/experiments/${id}/archive`, { archived }),
  deleteExperiment: (id: string) => del(`/api/experiments/${id}`),
  setRunLink: (id: string, enabled: boolean, regenerate = false) =>
    post<{ enabled: boolean; token: string | null }>(`/api/experiments/${id}/link`, { enabled, regenerate }),
  analytics: (id: string) => get<ExperimentAnalytics>(`/api/experiments/${id}/analytics`),
  experimentSessions: (id: string) => get<SessionListItem[]>(`/api/experiments/${id}/sessions`),

  labRunInfo: (id: string) => get<RunInfo>(`/api/experiments/${id}/run-info`),
  startLabSession: (id: string, body: StartBody) => post<RunPayload>(`/api/experiments/${id}/sessions`, body),
  linkRunInfo: (token: string) => get<RunInfo>(`/api/run/${encodeURIComponent(token)}`),
  startLinkSession: (token: string, body: StartBody) => post<RunPayload>(`/api/run/${encodeURIComponent(token)}/sessions`, body),
  markStarted: (sessionId: string, key: string) => post<void>(`/api/sessions/${sessionId}/start`, {}, { "X-Session-Key": key }),
  heartbeat: (sessionId: string, key: string, progressMs: number) =>
    post<void>(`/api/sessions/${sessionId}/heartbeat`, { progressMs: Math.round(progressMs) }, { "X-Session-Key": key }),
  complete: (sessionId: string, key: string, body: unknown) =>
    post<CompleteResponse>(`/api/sessions/${sessionId}/complete`, body, { "X-Session-Key": key }),
  live: () => get<LiveSession[]>("/api/live"),

  sessions: () => get<SessionListItem[]>("/api/sessions?take=500"),
  session: (id: string) => get<SessionDetail>(`/api/sessions/${id}`),
  deleteSession: (id: string) => del(`/api/sessions/${id}`),

  users: () => get<AdminUser[]>("/api/admin/users"),
  createUser: (body: { email: string; displayName: string; password: string; role: Role; credits: number | null }) =>
    post<AdminUser>("/api/admin/users", body),
  updateUser: (id: string, body: { displayName?: string; role?: Role; isActive?: boolean; credits?: { mode: "set" | "add" | "unlimited"; value: number } }) =>
    patch<AdminUser>(`/api/admin/users/${id}`, body),
  resetPassword: (id: string, newPassword: string) => post<void>(`/api/admin/users/${id}/password`, { newPassword }),
};
