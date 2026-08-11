  // ── iiko (см. iiko-integration-real-import) ──────────────────────────
  // connection: без пароля (никогда не отдаётся с бэкенда). ttkImport/scheduleImport —
  // реальная запись в наши ttk/schedules (вариант А: текст/is_working, без структуры).
  iikoConnection: (id: number) => request<any>(`/api/admin/restaurants/${id}/iiko/connection`),
  iikoSaveConnection: (id: number, data: { base_url: string; login: string; password: string }) =>
    request<any>(`/api/admin/restaurants/${id}/iiko/connection`, { method: 'POST', body: JSON.stringify(data) }),
  iikoTestConnection: (id: number) =>
    request<any>(`/api/admin/restaurants/${id}/iiko/connection/test`, { method: 'POST' }),
  iikoDeleteConnection: (id: number) =>
    request<any>(`/api/admin/restaurants/${id}/iiko/connection`, { method: 'DELETE' }),
  iikoTtkImport: (id: number) =>
    request<any>(`/api/admin/restaurants/${id}/iiko/ttk-import`, { method: 'POST' }),
  iikoScheduleImport: (id: number) =>
    request<any>(`/api/admin/restaurants/${id}/iiko/schedule-import`, { method: 'POST' }),

