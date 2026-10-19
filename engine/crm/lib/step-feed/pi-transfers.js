// VERBATIM COPY of CRM lib/step-feed/pi-transfers.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/step-feed/pi-transfers.js
//
// Who held a PI when. app/api/pi-transfer/route.js records every transfer in
// activityLogs — action 'pi.transfer', the PI as `target`, the CRM it left
// and the CRM it went to (details.fromCrmEmail, details.toCrmEmail), when
// (`timestamp`) and by whom (`userEmail`) — and those records, read back as
// each PI's history, let a step stay with whoever held the PI when it fell due
// (owner decision 12, OWNER_KIND.PI_OWNER_AT_DUE). A PI never transferred has
// no history and stays with its current CRM.
//
// Pure.

import { normPi } from '../pending-chase.js';

/** The activityLogs action of a PI transfer, written by the route and read here. */
export const PI_TRANSFER_ACTION = 'pi.transfer';

const text = (value) => String(value ?? '').trim();
const emailOf = (value) => text(value).toLowerCase();

/** A Firestore Timestamp, a Date, ISO text or epoch ms as a Date; null for anything unreadable. */
function toDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  return date instanceof Date && Number.isFinite(date.getTime()) ? date : null;
}

/**
 * @typedef {{ piNo: string, from: string, to: string, at: Date, by: string }} PiTransfer
 *   `from` and `to` are lower-case emails, '' when the record has none.
 */

/**
 * The transfers in activityLogs documents' data. A record of another action,
 * or with no PI or no readable time, says nothing about who held a PI when,
 * and is left out.
 *
 * @param {object[]} logs
 * @returns {PiTransfer[]}
 */
export function transfersFromLogs(logs) {
  return (Array.isArray(logs) ? logs : []).flatMap((log) => {
    const piNo = text(log?.target);
    const at = toDate(log?.timestamp);
    if (log?.action !== PI_TRANSFER_ACTION || !piNo || !at) return [];
    return [{
      piNo,
      from: emailOf(log.details?.fromCrmEmail),
      to: emailOf(log.details?.toCrmEmail),
      at,
      by: emailOf(log.userEmail),
    }];
  });
}

/**
 * Each PI's transfers, oldest first, keyed by normalised PI number (normPi,
 * the key the feed reads a PI by).
 *
 * @param {PiTransfer[]} transfers
 * @returns {Map<string, PiTransfer[]>}
 */
export function transferHistory(transfers) {
  const byPi = new Map();
  (Array.isArray(transfers) ? transfers : []).forEach((transfer) => {
    const key = normPi(transfer?.piNo);
    if (!key || !(transfer.at instanceof Date)) return;
    byPi.set(key, [...(byPi.get(key) || []), transfer]);
  });
  byPi.forEach((list) => list.sort((a, b) => a.at - b.at));
  return byPi;
}

/**
 * Who held the PI at `at`, by email: the CRM the first transfer after `at`
 * moved it from (or, when that record names nobody, the CRM the transfer
 * before it moved it to). '' when the PI moved on no later than `at` — its
 * current CRM holds it — when there is no time to ask about, or when the
 * records cannot say.
 *
 * @param {Map<string, PiTransfer[]>} history  transferHistory.
 * @param {string} piNo
 * @param {Date|null} at
 * @returns {string}
 */
export function holderAt(history, piNo, at) {
  const list = history?.get(normPi(piNo));
  if (!list || !(at instanceof Date)) return '';
  const next = list.findIndex((transfer) => transfer.at > at);
  if (next === -1) return '';
  return list[next].from || list[next - 1]?.to || '';
}
