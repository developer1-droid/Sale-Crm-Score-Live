/* Leader spotlight interstitial + the two models that feed it. */
import { el, isNum, fmtInt, fmtPct, fmtDec, dash, band, setNumber, medal, setMedal, ON_TIME_BANDS, REWARD_CASH } from './dom.js';
import { motionOff } from './motion.js';
import { flame } from './mascot.js';
import { coordPartners, coordQuality, coordFormula, catByKey, byOverallRank } from './salesView.js';

export function createSpotView() {
  const root = el('div', 'view');
  const spot = el('section', 'spot');
  const main = el('div', 'spot-main');
  const kicker = el('div', 'spot-kicker');
  const rule = el('div', 'spot-rule');
  const mask = el('div', 'spot-name-mask');
  const name = el('div', 'spot-name');
  mask.appendChild(name);
  const sub = el('div', 'spot-sub');
  const facts = el('div', 'spot-facts');
  // The leader is on fire.
  main.append(flame('spot-flame'), kicker, rule, mask, sub, facts);
  const side = el('div', 'spot-side');
  const bigLabel = el('div', 'spot-big-label');
  const big = el('div', 'spot-big');
  const bigNote = el('div', 'spot-big-note');
  const chasers = el('div', 'chasers');
  side.append(bigLabel, big, bigNote, chasers);
  spot.append(main, side);
  root.appendChild(spot);
  let bigValue = null;

  return {
    root,
    replay() {
      big._num = null;
      if (!isNum(bigValue)) return;
      if (motionOff()) { big.textContent = fmtInt(bigValue); return; }
      big._num = bigValue > 1 ? 0 : bigValue;
      setNumber(big, bigValue, fmtInt, true);
    },
    update(model) {
      kicker.textContent = model.kicker;
      name.textContent = model.name;
      sub.textContent = model.sub;
      facts.replaceChildren(...model.facts.map((f) => {
        const box = el('div', 'fact');
        box.append(el('div', 'fact-label', f.label), el('div', `fact-value${f.tone ? ` tone-${f.tone}` : ''}`, f.value));
        return box;
      }));
      bigLabel.textContent = model.bigLabel;
      // A text score (the MIS engine's signed %, as the CRM sends it) is shown as sent, never counted up.
      bigValue = model.bigText ? null : model.big;
      big._num = null;
      big.textContent = model.bigText || (isNum(model.big) ? fmtInt(model.big) : '—');
      bigNote.textContent = model.bigNote;
      chasers.replaceChildren(...model.chasers.map((ch) => {
        const row = el('div', 'chaser');
        const m = medal();
        setMedal(m, ch.rank);
        row.append(m, el('span', 'name', ch.name), el('span', 'chaser-val', ch.value));
        return row;
      }));
    },
  };
}

export function crmSpotModel(board) {
  if (!board) return null;
  const people = (board.people || []).filter((p) => isNum(p.rank)).sort((a, b) => a.rank - b.rank);
  const lead = people[0];
  if (!lead) return null;
  return {
    kicker: `${board.title || 'CRM Executive'} · No. 1`,
    name: lead.name,
    sub: `Top score${board.period && board.period.label ? ` · ${board.period.label}` : ''}`,
    facts: [
      { label: 'On-time', value: dash(lead.onTimePct, fmtPct), tone: isNum(lead.onTimePct) ? band(lead.onTimePct, ON_TIME_BANDS) : null },
      { label: 'Steps', value: dash(lead.steps, fmtInt) },
      { label: 'Late', value: dash(lead.late, fmtInt), tone: isNum(lead.late) && lead.late > 0 ? 'warn' : null },
      { label: 'Overdue', value: dash(lead.overdue, fmtInt), tone: isNum(lead.overdue) && lead.overdue > 0 ? 'bad' : null },
    ],
    bigLabel: 'Score',
    big: lead.score,
    // On the MIS engine the score is a signed % with a grade, 0% best (board.engine === 'mis').
    bigText: lead.scoreText || '',
    bigNote: lead.scoreText ? `Grade ${lead.grade} · 0% is best` : 'out of 100',
    chasers: people.slice(1, 3).map((p) => ({ rank: p.rank, name: p.name, value: p.scoreText || dash(p.score, fmtInt) })),
  };
}

export function salesSpotModel(sales) {
  if (!sales) return null;
  const list = byOverallRank(sales.coordinators);
  const lead = list[0];
  if (!lead) return null;
  const partners = coordPartners(lead);
  const q = coordQuality(lead);
  const factFor = (key, label) => {
    const cat = catByKey(lead, key);
    return cat ? { label, value: cat.na ? 'N/A' : dash(cat.value, fmtPct) } : null;
  };
  const isCash = lead.reward === REWARD_CASH;
  const facts = [factFor('stability', 'CRM'), factFor('tickets', 'Tickets'), factFor('feedback', 'Client feedback'),
    { label: 'Quality', value: isNum(q) ? `${fmtDec(q)}%` : '—' },
    { label: 'Reward', value: isCash ? 'Cash' : '—', tone: isCash ? 'gold' : null }]
    .filter((f) => f && f.value !== '—');
  return {
    kicker: 'Sales Coordinator · No. 1',
    name: lead.name || lead.email,
    sub: [partners.length ? `With CRM ${partners.join(', ')}` : null, sales.period && sales.period.label].filter(Boolean).join(' · '),
    facts,
    bigLabel: 'Rank score',
    big: lead.rankScore,
    bigNote: `${coordFormula(lead) || '—'} · lowest wins`,
    chasers: list.slice(1, 3).map((c) => ({ rank: c.overallRank, name: c.name || c.email, value: dash(c.rankScore, fmtInt) })),
  };
}
