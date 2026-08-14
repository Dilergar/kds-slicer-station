import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Category, Dish, IngredientBase, PriorityLevel } from '../../types';
import { Plus, X, ArrowDown, AlertOctagon, Ban, Check, Edit2, Trash2, Camera, Save, Link2, Link2Off, Snowflake, Search } from 'lucide-react';
import { ConfirmModal } from '../ui/ConfirmModal';
import { fetchDishAliases, linkDishToAlias, unlinkDishAlias, DishAlias } from '../../services/dishAliasesApi';
import { updateRecipe } from '../../services/recipesApi';
import { updateDishCategories, updateDishPriority, clearDishSlicerData, updateDishDefrost } from '../../services/dishesApi';
import { uploadDishImage, deleteDishImage } from '../../services/dishImagesApi';
import { blurOnWheel } from '../../utils';
import { ClampedNumberInput } from '../ui/ClampedNumberInput';

/**
 * Локальная заглушка для блюд без фото.
 *
 * Раньше здесь стоял внешний via.placeholder.com. В базе всего 2 фото на 299
 * настроенных блюд, то есть почти каждая карточка тянула запрос в интернет:
 * на кухонном планшете без внешней сети это сотни «битых картинок» и подвисание
 * при открытии категории. Inline-SVG в data URI не требует ни сети, ни файла на
 * диске и рисуется мгновенно.
 */
const NO_PHOTO_PLACEHOLDER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
       <rect width="80" height="80" fill="#1f2937"/>
       <circle cx="40" cy="32" r="13" fill="none" stroke="#4b5563" stroke-width="3"/>
       <path d="M18 66c4-13 12-19 22-19s18 6 22 19" fill="none" stroke="#4b5563" stroke-width="3"/>
     </svg>`
  );

interface RecipeEditorProps {
  categories: Category[];
  dishes: Dish[];
  setDishes: (dishes: Dish[]) => void;
  ingredients: IngredientBase[];
  handleStopClick: (e: React.MouseEvent, dish: Dish) => void;
  onRefreshDishes?: () => Promise<void> | void; // для перезагрузки после изменения алиасов
}

export const RecipeEditor: React.FC<RecipeEditorProps> = ({
  categories,
  dishes,
  setDishes,
  ingredients,
  handleStopClick,
  onRefreshDishes
}) => {
  const [recipeSearchTerm, setRecipeSearchTerm] = useState('');
  const [isEditingDish, setIsEditingDish] = useState(false);
  const [currentDish, setCurrentDish] = useState<Partial<Dish>>({});
  const [formError, setFormError] = useState<string | null>(null);
  // Идёт сохранение — кнопка заблокирована. Без этого сохранение с фото (1–2 сек
  // на планшете) выглядело как «не отреагировало», человек жал второй раз, и
  // уходила вторая серия запросов: два аплоада гонялись, один файл оставался
  // на диске без ссылки.
  const [isSaving, setIsSaving] = useState(false);
  // Ингредиент, только что добавленный кликом по справочнику — только его полю
  // граммовки отдаём фокус (см. autoFocus ниже).
  const [justAddedIngredientId, setJustAddedIngredientId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pending-состояние фото блюда:
  // pendingImageFile — File выбранный пользователем, ещё не загруженный на сервер.
  //                    Загружается в saveDishForm multipart-запросом.
  // imageMarkedForRemoval — пользователь нажал крестик на превью; на сохранении
  //                    отправится DELETE /api/dishes/:id/image. currentDish.image_url
  //                    при этом уже очищен, чтобы превью не мелькало.
  // Превью в диалоге рисуется из currentDish.image_url, куда FileReader кладёт
  // data-URL для мгновенного показа (не летит на сервер — это только для UI).
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);
  const [imageMarkedForRemoval, setImageMarkedForRemoval] = useState(false);
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<string[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // Поиск в панели «Все Ингредиенты» внутри модалки рецепта.
  // Справочник разросся до сотен позиций (сырьё + нарезки), глазами искать нереально.
  // Сбрасывается при каждом открытии/закрытии модалки — иначе список откроется
  // отфильтрованным по прошлому запросу, и покажется что ингредиенты пропали.
  const [ingredientSearchTerm, setIngredientSearchTerm] = useState('');

  // === Состояние для алиасов ===
  const [showAliases, setShowAliases] = useState(false); // Показывать alias-блюда в основном списке
  const [aliases, setAliases] = useState<DishAlias[]>([]); // Все алиасы с бэка
  const [linkModalForDish, setLinkModalForDish] = useState<Dish | null>(null); // Модалка "Связать блюдо"
  const [linkModalSearch, setLinkModalSearch] = useState('');

  // Загружаем алиасы при монтировании и после изменений
  const reloadAliases = async () => {
    try {
      const data = await fetchDishAliases();
      setAliases(data);
    } catch (err) {
      console.error('[RecipeEditor] Ошибка загрузки алиасов:', err);
    }
  };
  useEffect(() => {
    reloadAliases();
  }, []);

  // Map alias_dish_id → primary_dish_id (для быстрого lookup)
  const aliasMap = useMemo(() => {
    const m = new Map<string, string>();
    aliases.forEach(a => m.set(a.alias_dish_id, a.primary_dish_id));
    return m;
  }, [aliases]);

  // Map primary_dish_id → [alias_dish_id, ...] (для отображения связанных)
  const aliasesByPrimary = useMemo(() => {
    const m = new Map<string, string[]>();
    aliases.forEach(a => {
      if (!m.has(a.primary_dish_id)) m.set(a.primary_dish_id, []);
      m.get(a.primary_dish_id)!.push(a.alias_dish_id);
    });
    return m;
  }, [aliases]);

  // Проверка: является ли блюдо алиасом (имеет primary)
  const isAlias = (dishId: string) => aliasMap.has(dishId);

  /**
   * Нормализация строки для поиска ингредиентов: регистр не важен,
   * «ё» приравнивается к «е» (в справочнике встречается и «Свёкла», и «Свекла»,
   * нарезчик набирает как придётся — оба варианта должны находиться).
   */
  const normalizeSearch = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

  /**
   * Совпадение по всем словам запроса (порядок не важен).
   * Поиск пословный, а не по подстроке целиком, чтобы работали запросы
   * «морковь кубик» и «кубик морковь» одинаково — имя разновидности хранится
   * как «Морковь · Кубик», и цельная подстрока «морковь кубик» не совпала бы
   * из-за разделителя.
   *
   * @param haystack — где ищем (имя сырья или «сырьё + нарезка»)
   * @param tokens — уже нормализованные слова запроса
   */
  const matchesSearchTokens = (haystack: string, tokens: string[]) => {
    const normalized = normalizeSearch(haystack);
    return tokens.every(t => normalized.includes(t));
  };

  /**
   * Группы «сырьё → его нарезки» для панели «Все Ингредиенты» с учётом поиска.
   *
   * Правила фильтрации:
   * - пустой запрос — весь справочник как раньше;
   * - совпало имя сырья («ананас») — показываем сырьё и ВСЕ его нарезки,
   *   чтобы можно было сразу выбрать нужный подвид;
   * - совпали только нарезки («кубик») — показываем сырьё как заголовок
   *   (оно остаётся кликабельным) и только подходящие нарезки;
   * - ничего не совпало — группа скрыта целиком.
   *
   * Нарезка ищется по паре «сырьё + собственное имя», а не только по имени:
   * приставка сырья в названии хранится денормализованно (паттерн 3 в CLAUDE.md),
   * но у старых записей её может не быть — склейка страхует запрос «морковь кубик».
   */
  const visibleIngredientGroups = useMemo(() => {
    const tokens = normalizeSearch(ingredientSearchTerm).trim().split(/\s+/).filter(Boolean);

    return ingredients
      .filter(i => !i.parentId)
      .reduce<{ parent: IngredientBase; variations: IngredientBase[]; parentMatched: boolean }[]>((acc, parent) => {
        const variations = ingredients.filter(i => i.parentId === parent.id);

        if (tokens.length === 0) {
          acc.push({ parent, variations, parentMatched: true });
          return acc;
        }

        const parentMatched = matchesSearchTokens(parent.name, tokens);
        const matchedVariations = variations.filter(v =>
          matchesSearchTokens(`${parent.name} ${v.name}`, tokens)
        );

        if (!parentMatched && matchedVariations.length === 0) return acc;

        acc.push({
          parent,
          variations: parentMatched ? variations : matchedVariations,
          parentMatched
        });
        return acc;
      }, []);
  }, [ingredients, ingredientSearchTerm]);

  // Счётчик найденного (показывается только при активном запросе):
  // сырьё считается позицией, только если совпало само, плюс все показанные нарезки.
  const foundIngredientCount = useMemo(
    () => visibleIngredientGroups.reduce(
      (sum, g) => sum + (g.parentMatched ? 1 : 0) + g.variations.length,
      0
    ),
    [visibleIngredientGroups]
  );

  /** Связать блюдо с primary (сделать его алиасом) */
  const handleLinkDish = async (aliasDishId: string, primaryDishId: string) => {
    try {
      await linkDishToAlias(aliasDishId, primaryDishId);
      await reloadAliases();
      if (onRefreshDishes) await onRefreshDishes();
    } catch (err) {
      console.error('[RecipeEditor] Ошибка связывания:', err);
    }
  };

  /** Отвязать блюдо (удалить алиас) */
  const handleUnlinkDish = async (aliasDishId: string) => {
    try {
      await unlinkDishAlias(aliasDishId);
      await reloadAliases();
      if (onRefreshDishes) await onRefreshDishes();
    } catch (err) {
      console.error('[RecipeEditor] Ошибка отвязки:', err);
    }
  };

  const toggleCategory = (catId: string) => {
    setExpandedCategoryIds(prev =>
      prev.includes(catId) ? prev.filter(id => id !== catId) : [...prev, catId]
    );
  };

  const handleEditDish = (dish: Dish) => {
    setCurrentDish({ ...dish });
    setFormError(null);
    setPendingImageFile(null);
    setImageMarkedForRemoval(false);
    setIngredientSearchTerm('');
    setIsEditingDish(true);
  };

  // handleAddDish удалён вместе с кнопкой «Создать Рецепт» (ревью 2026-08-14) —
  // см. комментарий в разметке. Создавать блюда модуль не может и не должен:
  // они живут в чужой ctlg15_dishes.

  const handleDeleteDish = (id: string) => {
    setConfirmDeleteId(id);
  };

  /**
   * Сохраняет рецепт (ингредиенты) и ручное назначение категорий на бэкенд.
   * Рецепт пишется в slicer_recipes на primary-блюдо (если текущее —
   * alias, резолвим через aliasMap). Категории — всегда на оригинальный dishId.
   * После успеха перезагружает блюда из БД (источник правды).
   */
  const saveDishForm = async () => {
    if (isSaving) return; // защита от второго нажатия, пока идёт сохранение

    if (!currentDish.name || !currentDish.category_ids?.length) {
      setFormError('Укажите название и хотя бы одну категорию');
      return;
    }

    // Граммовка обязана быть положительным числом.
    // Раньше пустое поле давало NaN → JSON.stringify превращал его в null →
    // NOT NULL в slicer_recipes → 500 с общим текстом «Ошибка обновления
    // рецепта» без указания, какое поле виновато. При этом категории и
    // приоритет к тому моменту уже сохранялись (шли раньше по коду), и «Отмена»
    // их не откатывала. Теперь проверяем ДО любых запросов и называем ингредиент.
    const invalid = (currentDish.ingredients || []).find(
      i => !Number.isFinite(i.quantity) || i.quantity <= 0
    );
    if (invalid) {
      const name = ingredients.find(i => i.id === invalid.id)?.name ?? 'ингредиент';
      setFormError(`Укажите количество больше нуля: ${name}`);
      return;
    }

    const dishId = currentDish.id!;
    // Для алиаса рецепт пишется в primary (общий рецепт для всех вариантов).
    // Категории — всегда на оригинальный dishId.
    const recipeDishId = aliasMap.get(dishId) ?? dishId;

    // Маппинг поля ingredients: фронт хранит `id`, бэк ждёт `ingredientId`.
    const ingredientsPayload = (currentDish.ingredients || []).map(i => ({
      ingredientId: i.id,
      quantity: i.quantity,
    }));

    setIsSaving(true);
    try {
      // Порядок: СНАЧАЛА рецепт, потом категории и остальное.
      // Рецепт — самая «отказоспособная» часть (валидация количеств, чужие
      // ограничения), и если он падал последним, категории с приоритетом уже
      // лежали в БД, а пользователь видел только ошибку и жал «Отмена».
      // Приоритет сохраняется на оригинальный dishId (не на primary), т.к. у alias
      // и primary в UI отдельные карточки и могут иметь разный priority_flag.
      await updateRecipe(recipeDishId, ingredientsPayload);
      await updateDishCategories(dishId, currentDish.category_ids);
      await updateDishPriority(dishId, currentDish.priority_flag ?? 1);
      // Флаг и per-dish время разморозки (миграции 016, 020) пишем на primary —
      // общие для всех вариантов блюда, как и рецепт. Alias наследует через
      // recipe_source_id. Если минуты не проставлены — бэк подставит дефолт 15.
      await updateDishDefrost(
        recipeDishId,
        currentDish.requires_defrost ?? false,
        currentDish.defrost_duration_minutes
      );

      // Фото: upload или delete в самом конце, чтобы не блокировать
      // сохранение рецепта если upload вдруг упадёт (например, слишком
      // большой файл). Ошибка показывается в форме, но категории/рецепт
      // уже в БД — пользователь может попробовать снова загрузить фото.
      if (pendingImageFile) {
        // Картинку кладём на конкретный dishId (не на primary алиаса) —
        // алиасы могут быть разными блюдами (зал/доставка) с одинаковым
        // рецептом но разным видом. Если нужно — пользователь загрузит
        // фото и для primary отдельно.
        await uploadDishImage(dishId, pendingImageFile);
      } else if (imageMarkedForRemoval) {
        await deleteDishImage(dishId);
      }

      // Перезагружаем блюда из БД — это источник правды после persist.
      if (onRefreshDishes) await onRefreshDishes();

      setIsEditingDish(false);
      setCurrentDish({});
      setPendingImageFile(null);
      setImageMarkedForRemoval(false);
      setIngredientSearchTerm('');
      setFormError(null);
    } catch (err) {
      console.error('[RecipeEditor] Ошибка сохранения рецепта:', err);
      setFormError(err instanceof Error ? err.message : 'Ошибка сохранения рецепта');
    } finally {
      setIsSaving(false);
    }
  };

  const toggleIngredientSelection = (ingId: string) => {
    const currentIngs = currentDish.ingredients || [];
    const exists = currentIngs.find(i => i.id === ingId);

    if (exists) {
      setCurrentDish({ ...currentDish, ingredients: currentIngs.filter(i => i.id !== ingId) });
      if (justAddedIngredientId === ingId) setJustAddedIngredientId(null);
    } else {
      setCurrentDish({ ...currentDish, ingredients: [...currentIngs, { id: ingId, quantity: 0 }] });
      // Фокус в граммовку отдаём ТОЛЬКО этой строке. Раньше autoFocus стоял на
      // каждой строке выбранных ингредиентов, и любая перерисовка списка уводила
      // фокус из поля поиска: набрали «кубик» → выбрали → продолжаете набирать
      // «лук», а буквы уходят в граммовку только что добавленного ингредиента
      // (там они не видны, но значение становится нечисловым).
      setJustAddedIngredientId(ingId);
    }
  };

  /**
   * Обновляет граммовку ингредиента в рецепте.
   * @param ingId — id ингредиента
   * @param raw — сырое значение из поля ввода (может быть пустым или «1,5»)
   */
  const updateIngredientQuantity = (ingId: string, raw: string) => {
    // Запятая как десятичный разделитель — привычка русской раскладки;
    // number-input отдаёт при ней пустую строку, поэтому подстраховываемся.
    const parsed = parseFloat(raw.replace(',', '.'));
    // NaN в стейт не пускаем: он рисуется как пустое поле, а на сохранении
    // превращался в null и ронял запрос (см. проверку в saveDishForm).
    const qty = Number.isFinite(parsed) ? parsed : 0;
    const currentIngs = currentDish.ingredients || [];
    setCurrentDish({
      ...currentDish,
      ingredients: currentIngs.map(i => i.id === ingId ? { ...i, quantity: qty } : i)
    });
  };

  const triggerImageUpload = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  /**
   * Пользователь выбрал файл в диалоге.
   * Файл сохраняется в pendingImageFile (реально уйдёт на сервер при Save),
   * а превью рисуется через FileReader → data-URL в currentDish.image_url
   * (это только для глаз, в БД не попадает).
   * Лимит: 5 МБ — синхронизировано с multer на backend.
   */
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setFormError('Размер фото не должен превышать 5 МБ');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setFormError(null);
    setPendingImageFile(file);
    setImageMarkedForRemoval(false);

    const reader = new FileReader();
    reader.onloadend = () => {
      // data-URL только для превью в диалоге
      setCurrentDish(prev => ({ ...prev, image_url: reader.result as string }));
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    if (!currentDish.ingredients) return;

    const totalWeight = currentDish.ingredients.reduce((acc, dishIng) => {
      const ingDef = ingredients.find(i => i.id === dishIng.id);
      if (!ingDef) return acc;

      if (ingDef.unitType === 'piece') {
        return acc + (dishIng.quantity * (ingDef.pieceWeightGrams || 0));
      } else {
        return acc + dishIng.quantity;
      }
    }, 0);

    setCurrentDish(prev => ({ ...prev, grams_per_portion: totalWeight }));
  }, [currentDish.ingredients, ingredients]);

  return (
    <div className="relative">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept="image/*"
      />
      <div className="flex justify-between items-center mb-6">
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            placeholder="Поиск рецептов..."
            value={recipeSearchTerm}
            onChange={(e) => setRecipeSearchTerm(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 text-white rounded-lg pl-10 pr-4 py-2 focus:border-blue-500 outline-none"
          />
          <div className="absolute left-3 top-2.5 text-gray-400 pointer-events-none">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
          </div>
          {recipeSearchTerm && (
            <button
              onClick={() => setRecipeSearchTerm('')}
              className="absolute right-3 top-2.5 text-gray-500 hover:text-white"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <label className="flex items-center gap-2 ml-4 text-sm text-gray-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showAliases}
            onChange={(e) => setShowAliases(e.target.checked)}
            className="w-4 h-4 accent-blue-500"
          />
          Показать связанные варианты
        </label>

        {/* Кнопки «Создать Рецепт» здесь больше нет (ревью 2026-08-14).
            Блюда живут в чужой ctlg15_dishes и заводятся в кассе заказчика —
            эндпоинта на создание блюда нет и по правилу 3 быть не может.
            Кнопка выдавала выдуманный id вида d1723... и «сохраняла» рецепт,
            категории, приоритет и разморозку на несуществующее блюдо: поля
            dish_id в наших таблицах — обычный текст без внешнего ключа, поэтому
            все четыре запроса проходили успешно. Дальше справочник перечитывался
            из чужой таблицы, карточка исчезала, а мусор оставался навсегда.
            Новые блюда появляются сами — в секции «Без категории» ниже. */}
        <span className="ml-4 text-xs text-gray-500 max-w-xs">
          Новые блюда заводятся в кассе и появляются здесь в секции «Без категории».
        </span>
      </div>

      <div className="space-y-4">
        {categories.map(category => {
          const categoryDishes = dishes.filter(d =>
            d.category_ids?.includes(category.id) &&
            d.name.toLowerCase().includes(recipeSearchTerm.toLowerCase()) &&
            // По умолчанию скрываем alias-блюда (те у кого есть primary)
            (showAliases || !isAlias(d.id))
          );
          if (categoryDishes.length === 0) return null;

          const isSearching = recipeSearchTerm.length > 0;
          const isExpanded = expandedCategoryIds.includes(category.id) || isSearching;
          const hasStopped = categoryDishes.some(d => d.is_stopped);

          const sortedDishes = categoryDishes.sort((a, b) => {
            if (a.is_stopped !== b.is_stopped) return a.is_stopped ? -1 : 1;
            return a.name.localeCompare(b.name);
          });

          return (
            <div
              key={category.id}
              className={`border rounded-lg overflow-hidden transition-all duration-300
                ${hasStopped
                  ? 'border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.25)] bg-red-900/10'
                  : 'border-gray-700 bg-gray-900/30'
                }
              `}
            >
              <button
                onClick={() => toggleCategory(category.id)}
                className={`w-full flex items-center justify-between p-4 transition-colors
                   ${hasStopped ? 'bg-red-900/20 hover:bg-red-900/30' : 'bg-gray-800 hover:bg-gray-700'}
                `}
              >
                <div className="flex items-center gap-3">
                  <span className={`transform transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>
                    <ArrowDown size={20} className={hasStopped ? "text-red-400" : "text-gray-400"} />
                  </span>
                  <h2 className={`text-lg font-bold uppercase tracking-wide flex items-center gap-2 ${hasStopped ? 'text-red-100 drop-shadow-[0_0_8px_rgba(239,68,68,0.5)]' : 'text-gray-200'}`}>
                    {category.name}
                    {hasStopped && <AlertOctagon size={18} className="text-red-500 animate-pulse" />}
                  </h2>
                  <span className={`${hasStopped ? 'bg-red-900/50 text-red-200' : 'bg-blue-900/50 text-blue-300'} text-xs px-2 py-0.5 rounded-full font-mono`}>
                    {sortedDishes.length}
                  </span>
                </div>
              </button>

              {isExpanded && (
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 bg-gray-900/20 border-t border-gray-700">
                  {sortedDishes.map(dish => {
                    const isVip = dish.category_ids?.some(id => categories.find(c => c.id === id)?.name.toLowerCase() === 'vip');
                    return (
                      <div key={dish.id} className={`bg-kds-card rounded-lg p-4 border relative group border-gray-700`}>
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <button
                              onClick={(e) => handleStopClick(e, dish)}
                              className={`w-12 h-7 rounded-full relative transition-colors duration-300 focus:outline-none shrink-0
                                     ${dish.is_stopped ? 'bg-red-900/50' : 'bg-green-900/50'}
                                  `}
                            >
                              <div className={`absolute top-1 w-5 h-5 rounded-full shadow-md transform transition-transform duration-300 flex items-center justify-center
                                        ${dish.is_stopped ? 'translate-x-1 bg-red-500' : 'translate-x-6 bg-green-500'}
                                  `}>
                                {dish.is_stopped ? <Ban size={10} className="text-white" /> : <Check size={10} className="text-white" />}
                              </div>
                            </button>
                            <img src={dish.image_url || NO_PHOTO_PLACEHOLDER} className="w-16 h-16 rounded object-cover bg-gray-800" alt="" />
                            <div>
                              <h3 className="font-bold text-white text-lg leading-tight flex items-center gap-2 flex-wrap">
                                {dish.name}
                                {isVip && (
                                  <span className="text-yellow-400 border-2 border-yellow-400 text-[10px] px-1 rounded-sm -rotate-6 font-black tracking-widest shadow-[0_0_10px_rgba(250,204,21,0.5)] bg-yellow-400/10 select-none">
                                    VIP
                                  </span>
                                )}
                                {dish.priority_flag === PriorityLevel.ULTRA && (
                                  <span className="text-red-500 border border-red-500 text-[10px] px-1 rounded -rotate-6 font-black tracking-widest shadow-[0_0_10px_rgba(239,68,68,0.6)] bg-red-500/10 animate-pulse select-none">
                                    ULTRA
                                  </span>
                                )}
                                {/* Индикатор «требует разморозки» (миграция 016).
                                    Голубая ❄️ рядом с названием блюда — чтобы в
                                    админке сразу видеть какие блюда проходят
                                    через таймер разморозки. */}
                                {dish.requires_defrost && (
                                  <span
                                    title="Требует разморозки"
                                    className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/50 shadow-[0_0_8px_rgba(96,165,250,0.4)]"
                                  >
                                    <Snowflake size={12} strokeWidth={2.5} />
                                  </span>
                                )}
                              </h3>
                              <p className="text-xs text-gray-500 font-mono mt-0.5">{dish.ingredients.length} ингредиентов</p>
                              {dish.is_stopped && (
                                <div className="mt-1">
                                  <span className="text-[10px] text-red-500 font-bold bg-red-900/20 px-1.5 py-0.5 rounded border border-red-900">
                                    СТОП: {dish.stop_reason || 'Ручной'}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-1">
                            {/* Кнопку «Связать» показываем только у основных блюд.
                                На карточке варианта она позволяла собрать цепочку
                                X → Д163 → 163, а резолв везде однохоповый: третье
                                блюдо приезжало нарезчику без ингредиентов, и его
                                рецепт нельзя было отредактировать. Сервер такую
                                связь теперь тоже отклоняет (409). */}
                            {!isAlias(dish.id) && (
                              <button
                                onClick={() => setLinkModalForDish(dish)}
                                title="Связать другое блюдо (алиас)"
                                className="p-2 hover:bg-gray-700 rounded text-gray-400 hover:text-blue-400"
                              >
                                <Link2 size={18} />
                              </button>
                            )}
                            <button
                              onClick={() => handleEditDish(dish)}
                              className="p-2 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
                            >
                              <Edit2 size={18} />
                            </button>
                            <button
                              onClick={() => handleDeleteDish(dish.id)}
                              className="p-2 hover:bg-gray-700 rounded text-gray-400 hover:text-red-400"
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        </div>

                        <div className="bg-gray-800/50 p-3 rounded space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-gray-500">Порция:</span>
                            <span className="text-gray-300 font-mono">{dish.grams_per_portion}g</span>
                          </div>
                          <div>
                            <span className="text-gray-500 block mb-1">Ингредиенты:</span>
                            <div className="flex flex-wrap gap-1">
                              {dish.ingredients.map(dishIng => {
                                const ing = ingredients.find(i => i.id === dishIng.id);
                                return ing ? (
                                  <span key={dishIng.id} className="text-xs bg-gray-700 px-1.5 py-0.5 rounded text-gray-300 flex items-center gap-1">
                                    {ing.name}
                                    <span className="text-blue-400 font-bold">
                                      {dishIng.quantity}{ing.unitType === 'piece' ? 'pcs' : 'g'}
                                    </span>
                                  </span>
                                ) : null;
                              })}
                            </div>
                          </div>

                          {/* Секция связанных вариантов (алиасов) — только для primary-блюд */}
                          {(aliasesByPrimary.get(dish.id)?.length ?? 0) > 0 && (
                            <div className="border-t border-gray-700 pt-2 mt-2">
                              <span className="text-gray-500 block mb-1 text-xs uppercase tracking-wide">
                                Связанные варианты ({aliasesByPrimary.get(dish.id)?.length}):
                              </span>
                              <div className="flex flex-wrap gap-1">
                                {aliasesByPrimary.get(dish.id)!.map(aliasId => {
                                  const aliasDish = dishes.find(d => d.id === aliasId);
                                  if (!aliasDish) return null;
                                  return (
                                    <span key={aliasId} className="text-xs bg-blue-900/40 border border-blue-700/50 px-1.5 py-0.5 rounded text-blue-200 flex items-center gap-1">
                                      {aliasDish.name}
                                      <button
                                        onClick={() => handleUnlinkDish(aliasId)}
                                        title="Отвязать вариант"
                                        className="hover:text-red-300"
                                      >
                                        <Link2Off size={12} />
                                      </button>
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Если это сам алиас — показать к какому primary привязан */}
                          {isAlias(dish.id) && (
                            <div className="border-t border-gray-700 pt-2 mt-2">
                              <span className="text-xs text-blue-300">
                                Алиас → использует рецепт primary-блюда
                              </span>
                              <button
                                onClick={() => handleUnlinkDish(dish.id)}
                                className="ml-2 text-xs text-red-400 hover:text-red-300 underline"
                              >
                                Отвязать
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {(() => {
          const unknownDishes = dishes.filter(d =>
            (!d.category_ids || d.category_ids.length === 0) &&
            d.name.toLowerCase().includes(recipeSearchTerm.toLowerCase()) &&
            (showAliases || !isAlias(d.id))
          );
          if (unknownDishes.length === 0) return null;

          const isExpanded = expandedCategoryIds.includes('unknown');
          const sortedUnknown = unknownDishes.sort((a, b) => {
            if (a.is_stopped !== b.is_stopped) return a.is_stopped ? -1 : 1;
            return a.name.localeCompare(b.name);
          });

          return (
            <div className="border border-gray-700 rounded-lg overflow-hidden bg-gray-900/30 border-dashed">
              <button
                onClick={() => toggleCategory('unknown')}
                className="w-full flex items-center justify-between p-4 bg-gray-800 hover:bg-gray-700 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className={`transform transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>
                    <ArrowDown size={20} className="text-gray-400" />
                  </span>
                  <h2 className="text-lg font-bold text-gray-400 uppercase tracking-wide">
                    Без категории
                  </h2>
                  <span className="bg-gray-700 text-gray-300 text-xs px-2 py-0.5 rounded-full font-mono">
                    {sortedUnknown.length}
                  </span>
                </div>
              </button>

              {isExpanded && (
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 bg-gray-900/20 border-t border-gray-700">
                  {sortedUnknown.map(dish => (
                    <div key={dish.id} className="bg-kds-card rounded-lg p-4 border border-gray-700 relative group opacity-75 hover:opacity-100 transition-opacity">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 bg-gray-800 rounded flex items-center justify-center text-gray-600 font-bold">?</div>
                          <div>
                            <h3 className="font-bold text-white text-lg">{dish.name}</h3>
                            <p className="text-xs text-red-400 font-mono">Нет категории</p>
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <button onClick={() => handleEditDish(dish)} className="p-2 hover:bg-gray-700 rounded text-white"><Edit2 size={18} /></button>
                          <button onClick={() => handleDeleteDish(dish.id)} className="p-2 hover:bg-gray-700 rounded text-red-400"><Trash2 size={18} /></button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {isEditingDish && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto border border-gray-700 shadow-2xl flex flex-col">
            <div className="p-6 border-b border-gray-700 flex justify-between items-center bg-gray-900/50 sticky top-0 z-10 backdrop-blur-md">
              <h2 className="text-2xl font-bold text-white">
                {dishes.find(d => d.id === currentDish.id) ? 'Редактировать Рецепт' : 'Новый Рецепт'}
              </h2>
              <button
                onClick={() => {
                  setIsEditingDish(false);
                  setPendingImageFile(null);
                  setImageMarkedForRemoval(false);
                  setIngredientSearchTerm('');
                }}
                className="text-gray-400 hover:text-white"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="space-y-6">
                <div>
                  <label className="block text-gray-400 text-sm font-bold mb-2">Название Блюда</label>
                  <input
                    type="text"
                    value={currentDish.name || ''}
                    onChange={(e) => setCurrentDish({ ...currentDish, name: e.target.value })}
                    className="w-full bg-gray-900 border border-gray-700 rounded p-3 text-white focus:border-blue-500 outline-none"
                    placeholder="e.g. Caeser Salad"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-gray-400 text-sm font-bold mb-2">Категории (Макс 3)</label>
                    <div className="flex flex-wrap gap-2 mb-2">
                      {currentDish.category_ids?.map(catId => {
                        const cat = categories.find(c => c.id === catId);
                        if (!cat) return null;
                        return (
                          <span key={catId} className="bg-blue-600 text-white px-2 py-1 rounded text-sm flex items-center gap-1">
                            {cat.name}
                            <button
                              onClick={() => setCurrentDish({
                                ...currentDish,
                                category_ids: currentDish.category_ids?.filter(id => id !== catId)
                              })}
                              className="hover:text-red-300"
                            >
                              <X size={14} />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                    {(!currentDish.category_ids || currentDish.category_ids.length < 3) && (
                      <select
                        value=""
                        onChange={(e) => {
                          if (e.target.value) {
                            setCurrentDish({
                              ...currentDish,
                              category_ids: [...(currentDish.category_ids || []), e.target.value]
                            });
                          }
                        }}
                        className="w-full bg-gray-900 border border-gray-700 rounded p-3 text-white focus:border-blue-500 outline-none appearance-none"
                      >
                        <option value="">+ Добавить Категорию</option>
                        {categories
                          .filter(c => !currentDish.category_ids?.includes(c.id))
                          .map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                      </select>
                    )}
                  </div>
                  <select
                    value={currentDish.priority_flag || PriorityLevel.NORMAL}
                    onChange={(e) => setCurrentDish({ ...currentDish, priority_flag: parseInt(e.target.value) })}
                    className="w-full bg-gray-900 border border-gray-700 rounded p-3 text-white focus:border-blue-500 outline-none appearance-none"
                  >
                    <option value={PriorityLevel.NORMAL}>Обычный</option>
                    <option value={PriorityLevel.ULTRA}>ULTRA</option>
                  </select>
                </div>

                {/* Требует разморозки? (миграция 016) + per-dish время (миграция 020).
                    Значения сохраняются на primary-блюдо (recipe_source_id),
                    алиасы наследуют. По умолчанию — Нет / 15 мин. На карточке
                    в KDS Board появится кликабельная ❄️ для запуска разморозки.
                    Поле минут показывается только когда выбрано «Да» — чтобы
                    не путать пользователя неактивным инпутом. */}
                <div>
                  <label className="block text-gray-400 text-sm font-bold mb-2">Требует разморозки?</label>
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex bg-gray-900 rounded border border-gray-700 overflow-hidden w-fit">
                      <button
                        type="button"
                        onClick={() => setCurrentDish({ ...currentDish, requires_defrost: false })}
                        className={`px-5 py-2 text-sm font-bold transition-all ${
                          !(currentDish.requires_defrost ?? false)
                            ? 'bg-slate-700 text-white shadow-inner'
                            : 'text-gray-500 hover:text-gray-300'
                        }`}
                      >
                        Нет
                      </button>
                      <button
                        type="button"
                        onClick={() => setCurrentDish({ ...currentDish, requires_defrost: true })}
                        className={`px-5 py-2 text-sm font-bold transition-all ${
                          currentDish.requires_defrost
                            ? 'bg-blue-600 text-white shadow-[0_0_10px_rgba(59,130,246,0.4)]'
                            : 'text-gray-500 hover:text-gray-300'
                        }`}
                      >
                        Да
                      </button>
                    </div>
                    {currentDish.requires_defrost && (
                      <div className="flex items-center gap-2">
                        {/* Ограничение 1..60 как в CHECK БД, но применяется при
                            уходе из поля: иначе «5» на пути к «50» превращалось
                            бы в значение прямо под пальцем (см. ClampedNumberInput). */}
                        <ClampedNumberInput
                          value={currentDish.defrost_duration_minutes ?? 15}
                          min={1}
                          max={60}
                          fallback={15}
                          aria-label="Время разморозки в минутах"
                          onCommit={(val) => setCurrentDish({ ...currentDish, defrost_duration_minutes: val })}
                          className="w-20 bg-gray-900 border border-gray-700 rounded p-2 text-white text-center font-mono focus:border-blue-500 outline-none"
                        />
                        <span className="text-xs text-gray-400">минут</span>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    На карточке появится <span className="text-blue-400">❄️</span> для запуска таймера разморозки. Время — от 1 до 60 минут.
                  </p>
                </div>

                <div>
                  <label className="block text-gray-400 text-sm font-bold mb-2">Общий Выход Порции (Расчетный)</label>
                  <div className="w-full bg-gray-800 border border-gray-700 rounded p-3 text-blue-400 font-bold font-mono">
                    {currentDish.grams_per_portion || 0} g
                  </div>
                </div>

                <div>
                  <label className="block text-gray-400 text-sm font-bold mb-2">Фотография</label>
                  <div className="flex gap-2 items-center">
                    <button
                      onClick={triggerImageUpload}
                      className={`flex flex-1 items-center justify-center gap-2 p-3 rounded border transition-colors font-bold
                              ${currentDish.image_url
                          ? 'bg-gray-800 border-gray-600 text-white hover:bg-gray-700'
                          : 'bg-blue-600 border-blue-500 text-white hover:bg-blue-500'}
                          `}
                    >
                      <Camera size={20} />
                      {currentDish.image_url ? 'Сменить Фото' : 'Загрузить Фото'}
                    </button>
                  </div>
                  {currentDish.image_url && (
                    <div className="mt-2 relative group">
                      <img src={currentDish.image_url} alt="Preview" className="h-32 w-full object-cover rounded border border-gray-700" />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded">
                        <button
                          onClick={() => {
                            // Помечаем фото как удалённое: на сохранении уйдёт
                            // DELETE /api/dishes/:id/image (если было сохранено ранее).
                            // Если была только pending-загрузка — просто отменяем её.
                            setPendingImageFile(null);
                            setImageMarkedForRemoval(true);
                            setCurrentDish({ ...currentDish, image_url: '' });
                          }}
                          className="text-red-400 hover:text-red-300 flex items-center gap-1 font-bold bg-black/60 px-3 py-1 rounded"
                        >
                          <Trash2 size={16} /> Удалить
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700 flex flex-col h-full">
                <div className="mb-4 flex-1 overflow-y-auto max-h-[250px] border-b border-gray-700 pb-4">
                  <label className="block text-blue-400 text-sm font-bold mb-3 uppercase tracking-wider">
                    Выбранные Ингредиенты ({currentDish.ingredients?.length || 0})
                  </label>
                  {currentDish.ingredients?.length === 0 && <p className="text-gray-500 italic text-sm">Ингредиенты не выбраны.</p>}

                  <div className="space-y-2">
                    {currentDish.ingredients?.map(dishIng => {
                      const ing = ingredients.find(i => i.id === dishIng.id);
                      if (!ing) return null;
                      return (
                        <div key={dishIng.id} className="bg-gray-800 p-2 rounded border border-blue-500/50 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <img src={ing.imageUrl} className="w-8 h-8 rounded object-cover" alt="" />
                            <div>
                              <p className="text-white font-medium text-sm">{ing.name}</p>
                              {ing.unitType === 'piece' && <p className="text-xs text-blue-400">{ing.pieceWeightGrams}g / pc</p>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              placeholder="Кол-во"
                              value={dishIng.quantity || ''}
                              onChange={(e) => updateIngredientQuantity(dishIng.id, e.target.value)}
                              onWheel={blurOnWheel}
                              className="w-20 bg-gray-900 border border-blue-500 text-white p-1 rounded text-right font-mono font-bold outline-none focus:ring-1 ring-blue-500"
                              autoFocus={justAddedIngredientId === dishIng.id}
                            />
                            <span className="text-xs text-gray-400 w-8">{ing.unitType === 'piece' ? 'pcs' : 'g'}</span>
                            <button onClick={() => toggleIngredientSelection(ing.id)} className="p-1 hover:bg-red-900/50 rounded text-red-400">
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex-1 flex flex-col min-h-0 pt-2">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <label className="block text-gray-400 text-sm font-bold uppercase tracking-wider">Все Ингредиенты</label>
                    {ingredientSearchTerm.trim() && (
                      <span className="text-xs font-mono text-blue-300 bg-blue-900/30 border border-blue-800/50 px-2 py-0.5 rounded-full whitespace-nowrap">
                        найдено: {foundIngredientCount}
                      </span>
                    )}
                  </div>

                  {/* Поиск по справочнику: ищет и сырьё, и его нарезки.
                      Escape очищает запрос — быстрее чем целиться в крестик
                      пальцем на планшете. */}
                  <div className="relative mb-3 shrink-0">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                    <input
                      type="text"
                      value={ingredientSearchTerm}
                      onChange={(e) => setIngredientSearchTerm(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          setIngredientSearchTerm('');
                        }
                      }}
                      placeholder="Поиск: «морковь», «кубик», «морковь кубик»…"
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-9 pr-9 py-2 text-white text-sm outline-none focus:border-blue-500"
                    />
                    {ingredientSearchTerm && (
                      <button
                        type="button"
                        onClick={() => setIngredientSearchTerm('')}
                        title="Очистить поиск"
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-white"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-1">
                    {visibleIngredientGroups.length === 0 && (
                      <p className="text-gray-500 italic text-sm text-center py-6">
                        Ничего не найдено по запросу «{ingredientSearchTerm.trim()}».
                      </p>
                    )}
                    {visibleIngredientGroups.map(({ parent, variations }) => {
                      const isSelected = currentDish.ingredients?.some(i => i.id === parent.id);

                      return (
                        <div key={parent.id} className="mb-2">
                          <div
                            className={`p-2 rounded flex items-center justify-between cursor-pointer transition-colors
                                                    ${isSelected
                                ? 'opacity-50 cursor-not-allowed bg-gray-800 border border-gray-700'
                                : 'bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700 hover:border-blue-500'}
                                                `}
                            onClick={() => !isSelected && toggleIngredientSelection(parent.id)}
                          >
                            <div className="flex items-center gap-2">
                              <img src={parent.imageUrl} className="w-8 h-8 rounded object-cover" alt="" />
                              <span className="font-medium">{parent.name}</span>
                            </div>
                            {isSelected ? <span className="text-xs text-green-500">Добавлен</span> : <Plus size={16} />}
                          </div>

                          {variations.length > 0 && (
                            <div className="ml-6 mt-1 space-y-1 border-l-2 border-gray-700 pl-2">
                              {variations.map(v => {
                                const isVarSelected = currentDish.ingredients?.some(i => i.id === v.id);
                                return (
                                  <div
                                    key={v.id}
                                    className={`p-1.5 rounded flex items-center justify-between cursor-pointer text-sm
                                                                    ${isVarSelected
                                        ? 'opacity-50 cursor-not-allowed text-gray-500'
                                        : 'text-gray-400 hover:text-white hover:bg-gray-800'}
                                                                `}
                                    onClick={() => !isVarSelected && toggleIngredientSelection(v.id)}
                                  >
                                    <span>{v.name}</span>
                                    {isVarSelected ? <Check size={12} /> : <Plus size={12} />}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {formError && (
              <div className="mx-8 mb-4 bg-red-500/20 border border-red-500 text-red-100 px-4 py-3 rounded-lg flex items-center shadow-[0_0_15px_rgba(239,68,68,0.2)] animate-pulse">
                <AlertOctagon className="w-5 h-5 mr-3 text-red-500 flex-shrink-0" />
                <span className="font-bold">{formError}</span>
              </div>
            )}

            <div className="flex justify-end space-x-4 mt-6 border-t border-gray-700 p-6">
              <button
                onClick={() => {
                  setIsEditingDish(false);
                  setFormError(null);
                  setPendingImageFile(null);
                  setImageMarkedForRemoval(false);
                  setIngredientSearchTerm('');
                }}
                className="px-6 py-2 text-gray-400 font-bold hover:text-white transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={saveDishForm}
                disabled={isSaving}
                className="px-8 py-3 rounded bg-green-600 hover:bg-green-500 disabled:bg-slate-600 disabled:opacity-70 disabled:cursor-not-allowed text-white font-bold shadow-lg transform active:scale-95 disabled:active:scale-100 transition-all flex items-center gap-2"
              >
                <Save size={20} />
                {isSaving ? 'Сохраняю…' : 'Сохранить Рецепт'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -------------------- МОДАЛКА: СВЯЗАТЬ БЛЮДО С ТЕКУЩИМ (АЛИАС) -------------------- */}
      {linkModalForDish && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col border border-gray-700 shadow-2xl">
            <div className="p-6 border-b border-gray-700 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-white">Связать блюда с этим рецептом</h2>
                <p className="text-sm text-gray-400 mt-1">
                  Primary: <span className="text-blue-300 font-bold">{linkModalForDish.name}</span>
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Выбранные блюда будут использовать рецепт этого блюда. На KDS-доске заказы будут агрегироваться в одну карточку.
                </p>
              </div>
              <button
                onClick={() => { setLinkModalForDish(null); setLinkModalSearch(''); }}
                className="text-gray-400 hover:text-white"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-4 border-b border-gray-700">
              <input
                type="text"
                placeholder="Поиск блюда..."
                value={linkModalSearch}
                onChange={(e) => setLinkModalSearch(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 text-white rounded-lg px-4 py-2 focus:border-blue-500 outline-none"
              />
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-1">
              {dishes
                .filter(d =>
                  d.id !== linkModalForDish.id &&                     // не сам себя
                  !isAlias(d.id) &&                                    // не уже чей-то алиас
                  (aliasesByPrimary.get(d.id)?.length ?? 0) === 0 &&   // не является primary (иначе запутаемся)
                  d.name.toLowerCase().includes(linkModalSearch.toLowerCase())
                )
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(candidate => (
                  <button
                    key={candidate.id}
                    onClick={async () => {
                      await handleLinkDish(candidate.id, linkModalForDish.id);
                    }}
                    className="w-full text-left p-3 rounded bg-gray-900 border border-gray-700 hover:border-blue-500 hover:bg-gray-700 transition-colors flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <img src={candidate.image_url || NO_PHOTO_PLACEHOLDER} className="w-10 h-10 rounded object-cover bg-gray-800" alt="" />
                      <div>
                        <div className="text-white font-medium">{candidate.name}</div>
                        {candidate.code && <div className="text-xs text-gray-500 font-mono">code: {candidate.code}</div>}
                      </div>
                    </div>
                    <Link2 size={18} className="text-blue-400" />
                  </button>
                ))}
              {dishes.filter(d =>
                d.id !== linkModalForDish.id &&
                !isAlias(d.id) &&
                (aliasesByPrimary.get(d.id)?.length ?? 0) === 0 &&
                d.name.toLowerCase().includes(linkModalSearch.toLowerCase())
              ).length === 0 && (
                <p className="text-center text-gray-500 py-8">Нет доступных блюд для связывания.</p>
              )}
            </div>

            <div className="p-4 border-t border-gray-700 flex justify-end">
              <button
                onClick={() => { setLinkModalForDish(null); setLinkModalSearch(''); }}
                className="px-6 py-2 text-gray-400 hover:text-white font-bold"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -------------------- CONFIRM RESET MODAL -------------------- */}
      {/*
        Сброс slicer-данных блюда: чистим рецепт, назначения категорий и алиасы
        через DELETE /api/dishes/:dishId/slicer-data. Само блюдо остаётся в
        ctlg15_dishes и после reload снова появится в секции «Без категории».
      */}
      <ConfirmModal
        isOpen={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        title="Сбросить рецепт?"
        description="Блюдо вернётся в секцию «Без категории». Ингредиенты рецепта, назначения категорий и связи алиасов будут удалены. Само блюдо останется в системе."
        onConfirm={async () => {
          if (!confirmDeleteId) return;
          const targetId = confirmDeleteId;
          setConfirmDeleteId(null);
          try {
            await clearDishSlicerData(targetId);
            if (onRefreshDishes) await onRefreshDishes();
          } catch (err) {
            console.error('[RecipeEditor] Ошибка сброса slicer-данных:', err);
          }
        }}
      />
    </div>
  );
};
