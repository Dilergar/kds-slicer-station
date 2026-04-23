/**
 * API-клиент для настроек модуля (slicer_settings).
 */
import { apiFetch } from './client';
import { SystemSettings } from '../types';

/** Получить настройки */
export const fetchSettings = (): Promise<SystemSettings> =>
  apiFetch('/settings');

/** Обновить настройки (partial update) */
export const updateSettings = (data: Partial<SystemSettings>): Promise<SystemSettings> =>
  apiFetch('/settings', { method: 'PUT', body: JSON.stringify(data) });
