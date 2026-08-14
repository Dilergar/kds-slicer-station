/**
 * HouseTableBadge.tsx — номер стола-домика (миграция 030).
 *
 * Часть посадки ресторана — отдельные домики на улице (по умолчанию столы
 * 30/31/32, список правится в Админке → Общие Настройки). Нарезчику важно
 * видеть это прямо на карточке, поэтому такой номер рисуется кирпичным цветом
 * в рамке в форме домика вместо обычного жёлтого.
 *
 * Компонент общий для доски (OrderCard) и админки (SystemSettingsTab):
 * владелец настраивает список и сразу видит ровно то, что увидит нарезчик.
 *
 * ⚠️ Фиолетовая рамка вокруг номера — ДРУГАЯ метка («стол парковался в течение
 * смены», OrderCard). Домик её не отменяет: если стол и домик, и паркованный —
 * форма и обводка кирпичные, а фиолетовыми остаются заливка и цвет цифры.
 */
import React from 'react';

/**
 * Кирпичный цвет метки.
 *
 * Настоящий кирпич (#B22222) на тёмной доске (#151d2c) даёт контраст ~2.9:1 —
 * цифру не разобрать с трёх метров, а карточку читают именно так. Берём
 * осветлённый терракотовый тон того же семейства (~5:1): на глаз он остаётся
 * «кирпичным» и не спорит ни с жёлтым обычных столов, ни с фиолетовым
 * парковки, ни с красной ULTRA-рамкой.
 */
export const HOUSE_TABLE_COLOR = '#E2725B';

interface HouseTableBadgeProps {
  /** Номер стола */
  num: number;
  /** Стол вдобавок парковался в течение смены (см. комментарий в шапке файла) */
  isParked?: boolean;
}

/**
 * Цифра в контуре домика: стены + двускатная крыша.
 *
 * Почему SVG, а не clip-path: нужен КОНТУР фигуры, а clip-path вырезает
 * залитый силуэт и рамку по нему не даёт. preserveAspectRatio="none"
 * растягивает домик под ширину номера (1–4 цифры), а vector-effect
 * "non-scaling-stroke" не даёт линии стать толще при этом растяжении.
 */
export const HouseTableBadge: React.FC<HouseTableBadgeProps> = ({ num, isParked = false }) => (
  <span
    className="relative inline-flex items-center justify-center px-1.5 pt-2.5 pb-0.5 font-bold leading-none select-none"
    style={{ color: isParked ? '#D8B4FE' : HOUSE_TABLE_COLOR }}
    title={isParked ? `Стол ${num} — домик (парковался)` : `Стол ${num} — домик`}
  >
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      className="absolute inset-0"
    >
      <path
        d="M4 40 L50 5 L96 40 L96 95 L4 95 Z"
        fill={isParked ? 'rgba(147,51,234,0.30)' : 'rgba(226,114,91,0.15)'}
        stroke={HOUSE_TABLE_COLOR}
        strokeWidth="1.5"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
    <span className="relative">{num}</span>
  </span>
);
