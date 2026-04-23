/**
 * constants.ts — Начальные данные для инициализации приложения
 *
 * Содержит:
 * - INITIAL_CATEGORIES — категории меню (Vip, Soups, Salads, Горячее, Десерты)
 * - INITIAL_INGREDIENTS — справочник ингредиентов (родители и разновидности)
 * - INITIAL_DISHES — справочник блюд с рецептурой
 * - INITIAL_ORDERS — начальные заказы для демо
 *
 * В продакшене эти данные должны загружаться из базы данных через API.
 */

import { Category, Dish, IngredientBase, Order, PriorityLevel, ViewMode } from "./types";

// ======================================================================
// Матрица доступа: роль (из чужой таблицы `roles`) → вкладки модуля.
// Имена ролей должны совпадать с `roles.name` в БД заказчика.
// У юзера может быть несколько ролей — на фронте объединяем разрешения.
// Роли, НЕ перечисленные здесь, получают пустой набор — экран-заглушку
// «Нет доступа» и только кнопку «Выйти». Так делают `Кухня`, `Хостес`,
// `Кассир` по требованию заказчика.
// ======================================================================
export const ROLE_ACCESS: Record<string, ViewMode[]> = {
  'admin': ['KDS', 'STOPLIST', 'ADMIN', 'DASHBOARD'],
  'Администратор': ['KDS', 'STOPLIST', 'ADMIN', 'DASHBOARD'],
  'Заведующий производством': ['KDS', 'STOPLIST', 'ADMIN', 'DASHBOARD'],
  'Официант': ['KDS'],
  'Просмотр отчётов': ['DASHBOARD'],
};

/**
 * Объединение прав всех ролей юзера. Если ни одна роль не в ROLE_ACCESS —
 * пустой массив (юзер залогинен, но увидит заглушку «Нет доступа»).
 */
export function getAllowedViews(roles: string[]): ViewMode[] {
  const merged = new Set<ViewMode>();
  for (const role of roles) {
    const views = ROLE_ACCESS[role];
    if (views) views.forEach(v => merged.add(v));
  }
  return Array.from(merged);
}

// ======================================================================
// Категории меню — определяют порядок приоритета на KDS-доске
// sort_index: 0 = наивысший приоритет (VIP всегда сверху)
// ======================================================================
export const INITIAL_CATEGORIES: Category[] = [
  { id: 'c_vip', name: 'Vip', sort_index: 0 },
  { id: 'c1', name: 'Soups', sort_index: 1 },
  { id: 'c2', name: 'Salads', sort_index: 2 },
  { id: 'c3', name: 'Горячее', sort_index: 3 },
  { id: 'c4', name: 'Десерты', sort_index: 4 },
];

// ======================================================================
// Справочник ингредиентов
// Двухуровневая иерархия:
//   Родители (p_*) — основные категории (Potatoes, Meat, Greens...)
//   Дети (i_*) — конкретные разновидности (Raw Potato, Chicken Breast...)
// Связь через поле parentId
// ======================================================================
export const INITIAL_INGREDIENTS: IngredientBase[] = [
  // Родительские ингредиенты (основные категории)
  { id: 'p_potatoes', name: 'Potatoes', is_stopped: false, imageUrl: 'https://images.unsplash.com/photo-1518977676601-b53f82aba655?auto=format&fit=crop&w=150&q=80' },
  { id: 'p_greens', name: 'Greens', is_stopped: false, imageUrl: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=150&q=80' },
  { id: 'p_meat', name: 'Meat', is_stopped: false, imageUrl: 'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?auto=format&fit=crop&w=150&q=80' },
  { id: 'p_veg', name: 'Vegetables', is_stopped: false, imageUrl: 'https://images.unsplash.com/photo-1597362925123-77861d3fbac7?auto=format&fit=crop&w=150&q=80' },
  { id: 'p_djusay', name: 'Джусай', is_stopped: false, imageUrl: '/images/ingredients/djusay_main.png' },
  { id: 'p_zelen', name: 'Зелень', is_stopped: false, imageUrl: '/images/ingredients/zelen_main.png' },
  { id: 'p_perec_polugorkiy', name: 'Перец Полугорький', is_stopped: false, imageUrl: '/images/ingredients/perec_polugorkiy_main.png' },
  { id: 'p_kapusta_basay', name: 'Капуста Басай', is_stopped: false, imageUrl: '/images/ingredients/kapusta_basay_main.png' },
  { id: 'p_govyadina_marinov', name: 'Говядина маринованное', is_stopped: false, imageUrl: '/images/ingredients/govyadina_marinov_main.png' },

  // Дочерние ингредиенты (конкретные разновидности, используемые в рецептах)
  { id: 'i1', name: 'Raw Potato', parentId: 'p_potatoes', is_stopped: false, imageUrl: 'https://images.unsplash.com/photo-1518977676601-b53f82aba655?auto=format&fit=crop&w=150&q=80' },
  { id: 'i2', name: 'Romaine Lettuce', parentId: 'p_greens', is_stopped: false, imageUrl: 'https://images.unsplash.com/photo-1556801712-76c8eb07bab9?auto=format&fit=crop&w=150&q=80' },
  { id: 'i3', name: 'Chicken Breast', parentId: 'p_meat', is_stopped: false, imageUrl: 'https://images.unsplash.com/photo-1604503468506-a8da13d82791?auto=format&fit=crop&w=150&q=80' },
  { id: 'i4', name: 'Tomatoes', parentId: 'p_veg', is_stopped: false, imageUrl: 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?auto=format&fit=crop&w=150&q=80' },
  { id: 'i5', name: 'Cucumber', parentId: 'p_veg', is_stopped: false, imageUrl: 'https://images.unsplash.com/photo-1449300079323-02e209d9d3a6?auto=format&fit=crop&w=150&q=80' },
  { id: 'i6', name: 'Carrots', parentId: 'p_veg', is_stopped: false, imageUrl: 'https://images.unsplash.com/photo-1598170845058-32b9d6a5da37?auto=format&fit=crop&w=150&q=80' },
  { id: 'i_djusay_solomka', name: 'Джусай Соломка', parentId: 'p_djusay', is_stopped: false, imageUrl: '/images/ingredients/djusay_solomka.png' },
  { id: 'i_djusay_melkiy', name: 'Джусай Мелкий', parentId: 'p_djusay', is_stopped: false, imageUrl: '/images/ingredients/djusay_melkiy.png' },
  { id: 'i_bobovye_rostki', name: 'Бобовые ростки', parentId: 'p_zelen', is_stopped: false, imageUrl: '/images/ingredients/bobovye_rostki.png' },
  { id: 'i_broccoli', name: 'Брокколи', parentId: 'p_zelen', is_stopped: false, imageUrl: '/images/ingredients/broccoli.png' },
  { id: 'i_perec_rombik', name: 'Перец Гор. РОМБИК', parentId: 'p_perec_polugorkiy', is_stopped: false, imageUrl: '/images/ingredients/perec_rombik.png' },
  { id: 'i_perec_bolshoy_kubik', name: 'Перец Гор. БОЛЬШОЙ КУБИК', parentId: 'p_perec_polugorkiy', is_stopped: false, imageUrl: '/images/ingredients/perec_bolshoy_kubik.png' },
  { id: 'i_perec_plastik', name: 'Перец Гор. ПЛАСТИК', parentId: 'p_perec_polugorkiy', is_stopped: false, imageUrl: '/images/ingredients/perec_plastik.png' },
  { id: 'i_perec_solomka', name: 'Перец Гор. СОЛОМКА', parentId: 'p_perec_polugorkiy', is_stopped: false, imageUrl: '/images/ingredients/perec_solomka.png' },
  { id: 'i_basay_plastik', name: 'Басай ПЛАСТИК', parentId: 'p_kapusta_basay', is_stopped: false, imageUrl: '/images/ingredients/basay_plastik.png' },
  { id: 'i_basay_bolshoy_plastik', name: 'Басай БОЛЬШОЙ ПЛАСТИК', parentId: 'p_kapusta_basay', is_stopped: false, imageUrl: '/images/ingredients/basay_bolshoy_plastik.png' },
  { id: 'i_gov_marinov_plastik', name: 'Гов.Маринов. ПЛАСТИК', parentId: 'p_govyadina_marinov', is_stopped: false, imageUrl: '/images/ingredients/gov_marinov_plastik.png' },
];

// ======================================================================
// Справочник блюд (рецепты)
// Каждое блюдо содержит:
//   - category_ids: привязка к категориям (может быть несколько)
//   - priority_flag: уровень приоритета (NORMAL или ULTRA)
//   - ingredients: массив ингредиентов с количествами на 1 порцию
//   - grams_per_portion: общий вес порции (авто-расчёт из ингредиентов)
// ======================================================================
export const INITIAL_DISHES: Dish[] = [
  {
    id: 'd1',
    name: '№51 Салат Тигр',
    category_ids: ['c2'],
    priority_flag: PriorityLevel.NORMAL,

    grams_per_portion: 250,
    ingredients: [
      { id: 'i2', quantity: 50 },
      { id: 'i3', quantity: 150 },
      { id: 'i4', quantity: 50 }
    ],
    image_url: 'https://picsum.photos/200/200?random=1',
    is_stopped: false,
    stop_reason: ''
  },
  {
    id: 'd2',
    name: '№68 Говядина с древесными грибами',
    category_ids: ['c3'],
    priority_flag: PriorityLevel.NORMAL,

    grams_per_portion: 150,
    ingredients: [
      { id: 'i1', quantity: 150 }
    ],
    image_url: 'https://picsum.photos/200/200?random=2',
    is_stopped: false,
    stop_reason: ''
  },
  {
    id: 'd3',
    name: '№202 Суп Кунг-фу',
    category_ids: ['c1'],
    priority_flag: PriorityLevel.NORMAL,

    grams_per_portion: 300,
    ingredients: [
      { id: 'i1', quantity: 100 },
      { id: 'i6', quantity: 100 },
      { id: 'i5', quantity: 100 }
    ],
    image_url: 'https://picsum.photos/200/200?random=3',
    is_stopped: false,
    stop_reason: ''
  },
  {
    id: 'd4',
    name: '№539 Манты на пару',
    category_ids: ['c3'],
    priority_flag: PriorityLevel.NORMAL,

    grams_per_portion: 350,
    ingredients: [
      { id: 'i2', quantity: 50 },
      { id: 'i3', quantity: 200 },
      { id: 'i4', quantity: 100 }
    ],
    image_url: 'https://picsum.photos/200/200?random=4',
    is_stopped: false,
    stop_reason: ''
  },
  {
    id: 'd5',
    name: '№62 Гостеприимство',
    category_ids: ['c2'],
    priority_flag: PriorityLevel.NORMAL,

    grams_per_portion: 220,
    ingredients: [
      { id: 'i_djusay_solomka', quantity: 100 },
      { id: 'i_bobovye_rostki', quantity: 100 },
      { id: 'i_perec_solomka', quantity: 20 }
    ],
    image_url: '/images/dishes/gostepriimstvo.png',
    is_stopped: false,
    stop_reason: ''
  },
  {
    id: 'd6',
    name: '№3 Бифштекс по китайский',
    category_ids: ['c3'],
    priority_flag: PriorityLevel.NORMAL,

    grams_per_portion: 280,
    ingredients: [
      { id: 'i_broccoli', quantity: 30 },
      { id: 'i_gov_marinov_plastik', quantity: 250 }
    ],
    image_url: '/images/dishes/bifshteks_kitayskiy.png',
    is_stopped: false,
    stop_reason: ''
  },
  {
    id: 'd7',
    name: '№69 Мясо по-сычуаньски',
    category_ids: ['c1'],
    priority_flag: PriorityLevel.NORMAL,

    grams_per_portion: 630,
    ingredients: [
      { id: 'i_basay_plastik', quantity: 280 },
      { id: 'i_gov_marinov_plastik', quantity: 350 }
    ],
    image_url: '/images/dishes/myaso_sychuansky.png',
    is_stopped: false,
    stop_reason: ''
  },
  {
    id: 'd8',
    name: 'Тапанджи',
    category_ids: ['c3'],
    priority_flag: PriorityLevel.ULTRA,

    grams_per_portion: 585,
    ingredients: [
      { id: 'i_basay_bolshoy_plastik', quantity: 50 },
      { id: 'i1', quantity: 150 },
      { id: 'i3', quantity: 300 },
      { id: 'i_perec_bolshoy_kubik', quantity: 45 },
      { id: 'i4', quantity: 15 },
      { id: 'i6', quantity: 25 }
    ],
    image_url: '/images/dishes/tapandji.png',
    is_stopped: false,
    stop_reason: ''
  }
];

// ======================================================================
// Начальные заказы для демонстрации
// quantity_stack: [2, 1] означает 2 + 1 = 3 порции (стек не объединён)
// table_stack: [[8, 5], [51]] — столы 8,5 для первого блока, стол 51 для второго
// ======================================================================
export const INITIAL_ORDERS: Order[] = [
  {
    id: 'o1',
    dish_id: 'd1',
    quantity_stack: [2, 1],
    table_stack: [[8, 5], [51]],
    created_at: Date.now() - 1000 * 60 * 5, // 5 mins ago
    updated_at: Date.now(),
    status: 'ACTIVE'
  },
  {
    id: 'o2',
    dish_id: 'd3',
    quantity_stack: [1],
    table_stack: [[12]],
    created_at: Date.now() - 1000 * 60 * 2, // 2 mins ago
    updated_at: Date.now(),
    status: 'ACTIVE'
  }
];