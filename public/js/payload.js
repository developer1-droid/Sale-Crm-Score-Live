/* Reading the /api/scores payload (v3: byPeriod; a v2 payload is one period). */
import { CRM_PERIODS, SALES_PERIODS } from './settingsModel.js';

function pick(section, key) {
  if (!section) return null;
  if (section.byPeriod) return section.byPeriod[key] || null;
  return section.period && section.period.key === key ? section : null;
}

export const crmBoard = (data, key) => pick(data && data.crm, key);
export const salesBoard = (data, key) => {
  const sales = data && data.sales;
  if (sales && !sales.byPeriod && sales.period && sales.period.mode === key) return sales;
  return pick(sales, key);
};
export const salesPrevious = (data) => (data && data.sales && data.sales.previous) || null;

const chipOf = (list, key) => (list.find((p) => p.key === key) || {}).chip || key;

/** The long label ("This week · 12 – 18 Oct 2026", as the CRM MIS page heads it): from the board, the payload's period list, or the chip. */
export function periodLabel(kind, data, key) {
  const board = kind === 'crm' ? crmBoard(data, key) : salesBoard(data, key);
  const period = board && board.period;
  if (period && period.label && period.dates && period.dates !== period.label) return `${period.label} · ${period.dates}`;
  if (period && period.label) return period.label;
  const section = data && data[kind];
  const listed = section && Array.isArray(section.periods) ? section.periods.find((p) => p.key === key) : null;
  return (listed && listed.label) || chipOf(kind === 'crm' ? CRM_PERIODS : SALES_PERIODS, key);
}

export const hasRows = (board, field) => Boolean(board && (board[field] || []).length);
