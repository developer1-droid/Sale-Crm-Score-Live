/* Under a board: the steps that miss most and the delay reasons written most
   (lib/mis/insights.js boardInsights, sent by the CRM with the board). Built
   once; each update repaints the lists. Hidden when the period had nothing late. */
import { el } from './dom.js';

const SHOWN = 3;
const PCT = 100;
const SEGMENTS = [['onTime', 'on'], ['late', 'late'], ['notDone', 'open']];

function column(title) {
  const root = el('div', 'insight-col');
  const head = el('div', 'insight-head', title);
  const note = el('span', 'insight-note');
  head.appendChild(note);
  const list = el('ol', 'insight-list');
  root.append(head, list);
  return { root, list, note };
}

/* A bar of shares: each [width %, class] a segment. */
function bar(parts) {
  const track = el('span', 'insight-bar');
  parts.forEach(([width, cls]) => {
    if (width <= 0) return;
    const seg = el('i', cls);
    seg.style.width = `${width}%`;
    track.appendChild(seg);
  });
  return track;
}

function stepItem(row) {
  const li = el('li');
  const name = el('span', 'insight-name');
  name.append(el('b', null, row.code));
  if (row.label && row.label !== row.code) name.append(el('span', 'sub', row.label));
  const due = row.onTime + row.late + row.notDone;
  const parts = SEGMENTS.map(([key, cls]) => [due > 0 ? (row[key] / due) * PCT : 0, cls]);
  const value = el('span', 'insight-val tone-bad', `${row.missed}/${row.planned}`);
  li.append(name, bar(parts), value);
  return li;
}

function reasonItem(row) {
  const li = el('li');
  const name = el('span', `insight-name${row.isMissing ? ' tone-warn' : ''}`, row.isMissing || row.isOther ? row.reason : `“${row.reason}”`);
  const value = el('span', 'insight-val', `${row.count} · ${row.share}%`);
  li.append(name, bar([[row.share, row.isMissing ? 'late' : 'share']]), value);
  return li;
}

export function createInsightsView() {
  const root = el('section', 'insights');
  const missed = column('Most missed steps');
  const reasons = column('Delay reasons');
  root.append(missed.root, reasons.root);
  root.hidden = true;
  return {
    root,
    /** insights = the board's findings, or null/undefined when the board sent none. */
    update(insights) {
      const has = Boolean(insights && (insights.steps.length > 0 || insights.reasons.length > 0));
      root.hidden = !has;
      if (!has) return;
      const more = insights.moreSteps + Math.max(0, insights.steps.length - SHOWN);
      missed.note.textContent = more > 0 ? `+${more} more` : '';
      missed.list.replaceChildren(...insights.steps.slice(0, SHOWN).map(stepItem));
      reasons.note.textContent = `${insights.delayed} delayed`;
      reasons.list.replaceChildren(...insights.reasons.slice(0, SHOWN).map(reasonItem));
    },
  };
}
