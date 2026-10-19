/* Bottom crawl: the headline facts of every board, so a glance from across
   the room tells you who leads. Static (no crawl) when motion is off. */
import { el, isNum, fmtInt, fmtPct } from './dom.js';
import { motionOff, motionSpeed } from './motion.js';
import { byOverallRank } from './salesView.js';

const PX_PER_SEC = 90;

function crmItems(board, label) {
  if (!board || !(board.people || []).length) return [];
  const s = board.summary || {};
  const lead = board.people.find((p) => p.rank === 1);
  return [
    lead ? { tag: `CRM · ${label}`, text: `${lead.name} leads with ${lead.scoreText || fmtInt(lead.score)}` } : null,
    isNum(s.onTimePct) ? { tag: 'CRM', text: `On-time ${fmtPct(s.onTimePct)} · ${fmtInt(s.overdue || 0)} overdue · ${fmtInt(s.pending || 0)} pending` } : null,
    isNum(s.advanceDue) && s.advanceDue > 0 ? { tag: 'Advance due', text: `${fmtInt(s.advanceDue)}${s.advanceDueAmountLabel ? ` · ${s.advanceDueAmountLabel}` : ''}`, tone: 'bad' } : null,
    isNum(s.balanceDue) && s.balanceDue > 0 ? { tag: 'Balance due', text: `${fmtInt(s.balanceDue)}${s.balanceDueAmountLabel ? ` · ${s.balanceDueAmountLabel}` : ''}`, tone: 'bad' } : null,
  ].filter(Boolean);
}

function salesItems(sales, tag) {
  const lead = sales ? byOverallRank(sales.coordinators)[0] : null;
  if (!lead) return [];
  const done = (sales.coordinators || []).reduce((a, c) => a + ((c.counts && c.counts.done) || 0), 0);
  return [
    { tag, text: `${lead.name} leads · rank score ${isNum(lead.rankScore) ? fmtInt(lead.rankScore) : '—'}` },
    { tag, text: `${fmtInt(done)} steps done by the team` },
  ];
}

function itemNode(item) {
  const node = el('span', 'tk-item');
  node.append(el('b', `tk-tag${item.tone ? ` tone-${item.tone}` : ''}`, item.tag), document.createTextNode(item.text));
  return node;
}

export function createTicker(host) {
  const track = el('div', 'tk-track');
  host.replaceChildren(track);
  let sig = '';

  return {
    render({ visible, crm, crmLabel, sales, salesLabel, previous }) {
      host.hidden = !visible;
      if (!visible) return;
      const items = [...crmItems(crm, crmLabel), ...salesItems(sales, `Sales · ${salesLabel}`),
        ...salesItems(previous, 'Last month').slice(0, 1).map((i) => ({ ...i, text: i.text.replace('leads', 'won') }))];
      const nextSig = JSON.stringify([items, motionOff(), motionSpeed()]);
      if (nextSig === sig) return;
      sig = nextSig;
      const run = el('div', 'tk-run');
      run.append(...items.map(itemNode));
      const runs = motionOff() ? [run] : [run, run.cloneNode(true)];
      track.replaceChildren(...runs);
      track.style.animation = 'none';
      track.style.webkitAnimation = 'none';
      if (motionOff() || !items.length) return;
      requestAnimationFrame(() => {
        const secs = Math.max(20, run.scrollWidth / (PX_PER_SEC * motionSpeed()));
        const crawl = `tk-crawl ${secs}s linear infinite`;
        track.style.animation = crawl;
        track.style.webkitAnimation = crawl; // unprefixed only from Chrome 43
      });
    },
  };
}
