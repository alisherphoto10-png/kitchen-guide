// Карточка подключения к iiko на вкладке ресторана (только суперадмин). Реальный
// импорт (вариант А, см. iiko-integration-real-import) пишет прямо в существующие
// ttk/schedules — импортированные данные появляются в обычных экранах ТТК и
// графика сами, без отдельного "импортированного" вида.
function IikoCard({ restaurantId }: { restaurantId: number }) {
  const { haptic } = useTelegram()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ base_url: '', login: '', password: '' })

  const { data: connection, isLoading } = useQuery({
    queryKey: ['iiko-connection', restaurantId],
    queryFn: () => superadminApi.iikoConnection(restaurantId),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['iiko-connection', restaurantId] })

  const saveMutation = useMutation({
    mutationFn: () => superadminApi.iikoSaveConnection(restaurantId, form),
    onSuccess: () => {
      haptic.success(); toast('Подключение к iiko сохранено')
      setEditing(false); setForm({ base_url: '', login: '', password: '' }); invalidate()
    },
    onError: (e: any) => { haptic.error(); toast(e.message, 'error') },
  })

  const testMutation = useMutation({
    mutationFn: () => superadminApi.iikoTestConnection(restaurantId),
    onSuccess: (res: any) => {
      if (res.ok) { haptic.success(); toast('Подключение работает') }
      else { haptic.error(); toast(res.error || 'Не удалось подключиться', 'error') }
      invalidate()
    },
    onError: (e: any) => { haptic.error(); toast(e.message, 'error') },
  })

  const deleteMutation = useMutation({
    mutationFn: () => superadminApi.iikoDeleteConnection(restaurantId),
    onSuccess: () => { haptic.success(); toast('Подключение к iiko удалено'); invalidate() },
    onError: (e: any) => { haptic.error(); toast(e.message, 'error') },
  })

  const ttkImportMutation = useMutation({
    mutationFn: () => superadminApi.iikoTtkImport(restaurantId),
    onSuccess: (res: any) => {
      haptic.success()
      toast(`ТТК из iiko: создано ${res.created}, обновлено ${res.updated}${res.skipped ? `, пропущено ${res.skipped}` : ''}`)
    },
    onError: (e: any) => { haptic.error(); toast(e.message, 'error') },
  })

  const scheduleImportMutation = useMutation({
    mutationFn: () => superadminApi.iikoScheduleImport(restaurantId),
    onSuccess: (res: any) => {
      haptic.success()
      toast(`График из iiko: проставлено дней ${res.days_marked}` +
        (res.unmatched?.length ? `. Не сопоставлены с сотрудниками KitchenDesk: ${res.unmatched.join(', ')}` : ''))
    },
    onError: (e: any) => { haptic.error(); toast(e.message, 'error') },
  })

  const anyImportPending = ttkImportMutation.isPending || scheduleImportMutation.isPending

  return (
    <GlassCard className="p-4">
      <p className="text-xs text-gray-500 mb-3 font-medium uppercase tracking-wide">Подключение к iiko</p>

      {isLoading ? (
        <p className="text-gray-500 text-sm">Загрузка...</p>
      ) : connection?.connected && !editing ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-xs text-gray-500">Стенд</p>
              <p className="text-sm text-white font-mono mt-0.5 truncate">{connection.base_url}</p>
              <p className="text-xs text-gray-500 mt-1">
                {connection.last_test_ok_at
                  ? `Последняя успешная проверка: ${formatDate(new Date(connection.last_test_ok_at))}`
                  : 'Ещё не проверялось'}
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => { haptic.select(); testMutation.mutate() }}
              disabled={testMutation.isPending}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-white/5 py-2.5 text-xs font-medium text-gray-300 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${testMutation.isPending ? 'animate-spin' : ''}`} /> Проверить
            </button>
            <button
              onClick={() => { haptic.select(); setEditing(true) }}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-white/5 py-2.5 text-xs font-medium text-gray-300"
            >
              <Edit3 className="h-3.5 w-3.5" /> Изменить
            </button>
            <button
              onClick={() => { haptic.medium(); deleteMutation.mutate() }}
              disabled={deleteMutation.isPending}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-red-500/10 border border-red-500/20 py-2.5 text-xs font-medium text-red-400 disabled:opacity-50"
            >
              <Unlink className="h-3.5 w-3.5" /> Отключить
            </button>
          </div>

          <div className="flex gap-2 border-t border-white/5 pt-3">
            <button
              onClick={() => { haptic.medium(); ttkImportMutation.mutate() }}
              disabled={anyImportPending}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-blue-600/80 py-2.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              <Download className={`h-3.5 w-3.5 ${ttkImportMutation.isPending ? 'animate-spin' : ''}`} /> Импорт ТТК
            </button>
            <button
              onClick={() => { haptic.medium(); scheduleImportMutation.mutate() }}
              disabled={anyImportPending}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-blue-600/80 py-2.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              <Download className={`h-3.5 w-3.5 ${scheduleImportMutation.isPending ? 'animate-spin' : ''}`} /> Импорт графика
            </button>
          </div>
          <p className="text-[11px] text-gray-600 leading-snug">
            Состав блюд импортируется текстом (без брутто/нетто/% потерь), график — только
            «работал в этот день» (без времени смены и должности).
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {connection?.connected && (
            <p className="text-xs text-gray-500 mb-1">
              Уже подключено к {connection.base_url} — заполните форму, чтобы заменить.
            </p>
          )}
          <input
            value={form.base_url}
            onChange={(e) => setForm({ ...form, base_url: e.target.value })}
            placeholder="https://xxx.iiko.it/resto"
            className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white placeholder-gray-600 outline-none"
          />
          <input
            value={form.login}
            onChange={(e) => setForm({ ...form, login: e.target.value })}
            placeholder="Логин"
            className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white placeholder-gray-600 outline-none"
          />
          <input
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="Пароль"
            type="password"
            className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white placeholder-gray-600 outline-none"
          />
          <div className="flex gap-2 mt-1">
            {editing && (
              <button
                onClick={() => { setEditing(false); setForm({ base_url: '', login: '', password: '' }) }}
                className="flex-1 rounded-xl bg-white/5 py-2.5 text-xs font-medium text-gray-300"
              >
                Отмена
              </button>
            )}
            <button
              onClick={() => { haptic.medium(); saveMutation.mutate() }}
              disabled={saveMutation.isPending || !form.base_url || !form.login || !form.password}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-blue-600/80 py-2.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              <Link2 className="h-3.5 w-3.5" /> Сохранить
            </button>
          </div>
        </div>
      )}
    </GlassCard>
  )
}

