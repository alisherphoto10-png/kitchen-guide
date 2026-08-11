          <input placeholder="Название" value={editData.name} onChange={e => setEditData({...editData, name: e.target.value})}
            className="w-full bg-[#040816] rounded-[14px] px-4 py-3 text-sm text-white outline-none border border-white/8 font-sans" />
          <select value={editData.category} onChange={e => { setEditData({...editData, category: e.target.value}); if (e.target.value !== '__other__') setEditCustomCategory('') }}
            className="w-full bg-[#040816] rounded-[14px] px-4 py-3 text-sm text-white outline-none border border-white/8">
            <option value="">Категория</option>
            {(ttkCategories as string[]).map(c => <option key={c} value={c}>{c}</option>)}
            <option value="__other__">Другая категория...</option>
          </select>
          {editData.category === '__other__' && (
            <input placeholder="Введите категорию" value={editCustomCategory} onChange={e => setEditCustomCategory(e.target.value)}
              className="w-full bg-[#040816] rounded-[14px] px-4 py-3 text-sm text-white outline-none border border-green-500/30 font-sans" />
          )}
          <select value={editData.section} onChange={e => { setEditData({...editData, section: e.target.value}); if (e.target.value !== '__other__') setEditCustomTtkSection('') }}
            className="w-full bg-[#040816] rounded-[14px] px-4 py-3 text-sm text-white outline-none border border-white/8">
            <option value="">Цех (необязательно)</option>
            {(ttkSections as any[]).map((s: any) => <option key={s.id} value={s.name}>{s.name}</option>)}
            <option value="__other__">Другой цех...</option>
          </select>
          {editData.section === '__other__' && (
            <input placeholder="Введите название цеха" value={editCustomTtkSection} onChange={e => setEditCustomTtkSection(e.target.value)}
              className="w-full bg-[#040816] rounded-[14px] px-4 py-3 text-sm text-white outline-none border border-green-500/30 font-sans" />
          )}
          {/* Состав iiko-блюда правится только повторным импортом из iiko, не руками —
              см. iiko-integration-real-import, Часть 4. Бэкенд тоже игнорирует правку
              (PUT /api/admin/ttk/:id), это UI-подсказка, а не единственная защита. */}
          <textarea placeholder="Ингредиенты" value={editData.ingredients}
            onChange={e => setEditData({...editData, ingredients: e.target.value})}
            disabled={!!selected.iikoManaged}
            className={`w-full bg-[#040816] rounded-[14px] px-4 py-3 text-sm text-white outline-none border border-white/8 resize-none h-28 font-sans ${selected.iikoManaged ? 'opacity-50 cursor-not-allowed' : ''}`} />
          {selected.iikoManaged && (
            <p className="text-xs text-orange-400 -mt-2">
              Ингредиенты этого блюда синхронизируются с iiko — редактировать их в KitchenDesk
              нельзя. Изменить состав может администратор iiko вашего заведения, в самой системе iiko.
            </p>
          )}
          <textarea placeholder="Приготовление" value={editData.cooking} onChange={e => setEditData({...editData, cooking: e.target.value})}
            className="w-full bg-[#040816] rounded-[14px] px-4 py-3 text-sm text-white outline-none border border-white/8 resize-none h-20 font-sans" />

