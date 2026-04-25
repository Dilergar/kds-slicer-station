import React, { useState } from 'react';
import { Category, SystemSettings } from '../../types';
import { Plus, Save, X, Edit2, Trash2, ArrowUp, ArrowDown, PauseCircle, Lock } from 'lucide-react';
import { ConfirmModal } from '../ui/ConfirmModal';
import {
  fetchCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories
} from '../../services/categoriesApi';
import { updateSettings } from '../../services/settingsApi';

interface CategoriesTabProps {
  categories: Category[];
  setCategories: (cats: Category[]) => void;
  settings: SystemSettings;
  setSettings: (s: SystemSettings) => void;
}

export const CategoriesTab: React.FC<CategoriesTabProps> = ({ categories, setCategories, settings, setSettings }) => {
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [tempCategoryName, setTempCategoryName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Локальный буфер для инпута минут авто-парковки. Пишем в БД только на blur
  // или Enter, чтобы каждый нажатый символ не триггерил PUT /settings.
  const [dessertMinutesDraft, setDessertMinutesDraft] = useState<string>('');

  /**
   * Откат локального стейта к серверному состоянию при ошибке API.
   */
  const reloadFromServer = async () => {
    try {
      const fresh = await fetchCategories();
      setCategories(fresh);
    } catch (err) {
      console.error('[CategoriesTab] Не удалось откатить из БД:', err);
    }
  };

  /**
   * Перемещение категории вверх/вниз — оптимистично свапаем порядок локально,
   * пересчитываем sort_index по позиции в массиве и отправляем пакетный PUT.
   */
  const moveCategory = async (index: number, direction: 'UP' | 'DOWN') => {
    if ((direction === 'UP' && index === 0) || (direction === 'DOWN' && index === categories.length - 1)) return;

    const newCats = [...categories];
    const swapIndex = direction === 'UP' ? index - 1 : index + 1;
    [newCats[index], newCats[swapIndex]] = [newCats[swapIndex], newCats[index]];

    const reindexed = newCats.map((c, i) => ({ ...c, sort_index: i }));
    setCategories(reindexed);

    try {
      await reorderCategories(reindexed.map(c => ({ id: c.id, sort_index: c.sort_index })));
    } catch (err) {
      console.error('[CategoriesTab] Ошибка reorder:', err);
      await reloadFromServer();
    }
  };

  const handleAddCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    setNewCategoryName('');
    setIsAddingCategory(false);
    try {
      const created = await createCategory(name);
      setCategories([...categories, created]);
    } catch (err) {
      console.error('[CategoriesTab] Ошибка создания категории:', err);
      await reloadFromServer();
    }
  };

  const handleDeleteCategory = (id: string) => {
    setConfirmDeleteId(id);
  };

  const initiateEditCategory = (cat: Category) => {
    setEditingCategoryId(cat.id);
    setTempCategoryName(cat.name);
  };

  const saveCategory = async () => {
    const name = tempCategoryName.trim();
    if (!name || !editingCategoryId) return;
    const targetId = editingCategoryId;
    setEditingCategoryId(null);
    setCategories(categories.map(c => c.id === targetId ? { ...c, name } : c));
    try {
      await updateCategory(targetId, { name });
    } catch (err) {
      console.error('[CategoriesTab] Ошибка переименования:', err);
      await reloadFromServer();
    }
  };

  /**
   * Сохранить настройки авто-парковки десертов.
   * Оптимистичный стейт сразу, потом PUT /settings. При ошибке откат.
   */
  const patchDessertSettings = async (patch: Partial<Pick<SystemSettings, 'dessertAutoParkEnabled' | 'dessertAutoParkMinutes'>>) => {
    const prev = settings;
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      const saved = await updateSettings(patch);
      setSettings({ ...next, ...saved });
    } catch (err) {
      console.error('[CategoriesTab] Ошибка сохранения настроек десерта:', err);
      setSettings(prev);
    }
  };

  // Клэмп минут в [1..240] на отправке — БД всё равно отвергнет через CHECK,
  // но дадим пользователю мгновенный feedback без 400-ки.
  const commitDessertMinutes = (raw: string) => {
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed)) {
      setDessertMinutesDraft(String(settings.dessertAutoParkMinutes ?? 40));
      return;
    }
    const clamped = Math.max(1, Math.min(240, parsed));
    setDessertMinutesDraft(String(clamped));
    if (clamped !== (settings.dessertAutoParkMinutes ?? 40)) {
      void patchDessertSettings({ dessertAutoParkMinutes: clamped });
    }
  };

  return (
    <div className="bg-kds-card rounded-lg p-6 max-w-2xl border border-gray-800">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-xl font-bold text-white mb-2">Категории Меню</h2>
          <p className="text-sm text-gray-400">Используйте стрелки для настройки приоритета на KDS экране.</p>
        </div>
        <button
          onClick={() => setIsAddingCategory(true)}
          className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-500 flex items-center gap-1 font-bold shadow-lg shadow-blue-900/20"
        >
          <Plus size={16} /> Добавить Категорию
        </button>
      </div>

      {isAddingCategory && (
        <div className="bg-gray-800/80 p-3 rounded-lg border border-blue-500/50 mb-6 flex items-center gap-2 shadow-lg shadow-blue-900/10 backdrop-blur-sm">
          <input
            type="text"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            placeholder="Имя новой категории"
            className="bg-gray-900 text-white px-3 py-2 rounded flex-1 outline-none border border-gray-700/50 focus:border-blue-500/50 focus:ring-1 ring-blue-500/50 transition-all"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
          />
          <button onClick={handleAddCategory} className="text-green-500 hover:text-green-400 p-2 transition-colors"><Save size={20} /></button>
          <button onClick={() => setIsAddingCategory(false)} className="text-red-500 hover:text-red-400 p-2 transition-colors"><X size={20} /></button>
        </div>
      )}

      <ul className="space-y-3">
        {categories.map((cat, index) => {
          // Дессертная категория — та, что привязана в slicer_settings.dessert_category_id
          // (миграция 017). Её нельзя удалить и она показывает панель авто-парковки.
          const isDessert = settings.dessertCategoryId === cat.id;
          const autoParkOn = isDessert && (settings.dessertAutoParkEnabled ?? false);
          const autoParkMinutes = settings.dessertAutoParkMinutes ?? 40;

          return (
            <li key={cat.id} className="bg-gray-800/50 hover:bg-gray-800/80 rounded-lg border border-gray-700/50 transition-colors group overflow-hidden">
              <div className="flex items-center justify-between p-3">
                <div className="flex items-center gap-4 flex-1">
                  <span className="bg-gray-900 text-gray-400 text-xs px-2 py-1 rounded font-mono font-bold border border-gray-800">#{cat.sort_index}</span>

                  {editingCategoryId === cat.id ? (
                    <div className="flex items-center gap-2 flex-1 mr-4">
                      <input
                        type="text"
                        value={tempCategoryName}
                        onChange={(e) => setTempCategoryName(e.target.value)}
                        className="bg-gray-900 text-white px-3 py-1.5 rounded flex-1 outline-none border border-blue-500/50 focus:ring-1 ring-blue-500/50 transition-all font-medium"
                        autoFocus
                        onKeyDown={(e) => e.key === 'Enter' && saveCategory()}
                      />
                      <button onClick={saveCategory} className="text-green-500 hover:text-green-400"><Save size={18} /></button>
                      <button onClick={() => setEditingCategoryId(null)} className="text-red-500 hover:text-red-400"><X size={18} /></button>
                    </div>
                  ) : (
                    <span className="text-gray-200 font-bold flex-1 text-lg uppercase tracking-wider flex items-center gap-2">
                      {cat.name}
                      {isDessert && (
                        <span
                          title="Системная категория — не удаляется"
                          className="text-pink-400/80"
                        >
                          <Lock size={14} />
                        </span>
                      )}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
                  {!editingCategoryId && (
                    <>
                      <button
                        onClick={() => initiateEditCategory(cat)}
                        className="p-2 hover:bg-blue-600/20 rounded-md text-gray-400 hover:text-blue-400 transition-colors"
                        title="Изменить имя"
                      >
                        <Edit2 size={18} />
                      </button>
                      {/* Кнопка удаления — только если это НЕ дессертная категория. */}
                      {!isDessert && (
                        <button
                          onClick={() => handleDeleteCategory(cat.id)}
                          className="p-2 hover:bg-red-900/30 rounded-md text-gray-400 hover:text-red-400 transition-colors"
                          title="Удалить категорию"
                        >
                          <Trash2 size={18} />
                        </button>
                      )}
                      <div className="w-px h-6 bg-gray-700 mx-1"></div>
                    </>
                  )}

                  <button
                    onClick={() => moveCategory(index, 'UP')}
                    disabled={index === 0}
                    className="p-2 bg-gray-700 hover:bg-gray-600 rounded-md disabled:opacity-30 disabled:hover:bg-gray-700 text-white transition-colors"
                  >
                    <ArrowUp size={16} />
                  </button>
                  <button
                    onClick={() => moveCategory(index, 'DOWN')}
                    disabled={index === categories.length - 1}
                    className="p-2 bg-gray-700 hover:bg-gray-600 rounded-md disabled:opacity-30 disabled:hover:bg-gray-700 text-white transition-colors"
                  >
                    <ArrowDown size={16} />
                  </button>
                </div>
              </div>

              {/* Панель авто-парковки — только для дессертной категории.
                  Тумблер ON/OFF + поле минут. При ВКЛ правило срабатывает
                  только для дессертов, у которых официант в кассе поставил
                  модификатор из списка `slicer_settings.dessert_trigger_modifier_patterns`
                  (default: «Готовить%», «Ждать%»). Без модификатора десерт идёт
                  в очередь сразу, как обычное блюдо. См. миграции 017+019 и
                  server/src/routes/orders.ts → GET /api/orders. */}
              {isDessert && (
                <div className="bg-pink-950/20 border-t border-pink-900/30 px-3 py-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2 text-pink-200/80 text-sm font-medium">
                    <PauseCircle size={16} className="text-pink-400" />
                    <span>Авто-парковка на</span>
                    <input
                      type="number"
                      min={1}
                      max={240}
                      value={dessertMinutesDraft !== '' ? dessertMinutesDraft : autoParkMinutes}
                      onChange={(e) => setDessertMinutesDraft(e.target.value)}
                      onBlur={() => {
                        if (dessertMinutesDraft !== '') {
                          commitDessertMinutes(dessertMinutesDraft);
                          setDessertMinutesDraft('');
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          commitDessertMinutes(dessertMinutesDraft || String(autoParkMinutes));
                          setDessertMinutesDraft('');
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                      className="bg-gray-900 border border-pink-800/50 text-white font-mono font-bold w-16 text-center py-1 rounded focus:border-pink-400 outline-none"
                    />
                    <span>минут после заказа</span>
                  </div>

                  {/* Тумблер ВКЛ/ВЫКЛ — стилистически как в SystemSettingsTab */}
                  <div className="flex items-center bg-gray-900 rounded-lg p-1 border border-gray-700 shrink-0">
                    <button
                      onClick={() => patchDessertSettings({ dessertAutoParkEnabled: false })}
                      className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${!autoParkOn
                        ? 'bg-red-900/80 text-red-100 shadow-[0_0_8px_rgba(153,27,27,0.4)]'
                        : 'text-gray-500 hover:text-gray-300'
                        }`}
                    >
                      ВЫКЛ
                    </button>
                    <button
                      onClick={() => patchDessertSettings({ dessertAutoParkEnabled: true })}
                      className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${autoParkOn
                        ? 'bg-pink-600 text-white shadow-[0_0_8px_rgba(219,39,119,0.4)]'
                        : 'text-gray-500 hover:text-gray-300'
                        }`}
                    >
                      ВКЛ
                    </button>
                  </div>
                  </div>
                  {/* Подсказка: правило триггерится модификатором в кассе. */}
                  <p className="text-[11px] text-pink-200/50 italic leading-snug">
                    Только для десертов с модификатором «Готовить позже» или «Ждать разъяснений».
                    Если модификатор «Готовить к HH.00» — парковка до указанного часа.
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <ConfirmModal
        isOpen={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        title="Удалить категорию?"
        description="Вы уверены, что хотите удалить эту категорию? Блюда, связанные с ней, могут сбить фильтры и сортировку."
        onConfirm={async () => {
          if (!confirmDeleteId) return;
          const targetId = confirmDeleteId;
          setConfirmDeleteId(null);
          // Оптимистично убираем категорию из локального стейта
          setCategories(categories.filter(c => c.id !== targetId));
          try {
            await deleteCategory(targetId);
          } catch (err) {
            console.error('[CategoriesTab] Ошибка удаления:', err);
            await reloadFromServer();
          }
        }}
      />
    </div>
  );
};
