/* What the voice says: short sentences for the board on screen (so the voice
   always matches the slide) or one summary, in the chosen language and style.
   Pure. Hindi is Devanagari so a hi-IN voice says it right; names stay as the
   CRM spells them. Periods are the ones the screen is showing. */
import { crmBoard, salesBoard, salesPrevious } from '../payload.js';

const CRM_WHEN = {
  hi: {
    today: 'आज', weekly: 'पिछले सात दिनों में', monthly: 'पिछले तीस दिनों में',
    quarterly: 'पिछले तीन महीनों में', halfyearly: 'पिछले छह महीनों में', yearly: 'पिछले एक साल में',
  },
  en: {
    today: 'today', weekly: 'over the last 7 days', monthly: 'over the last 30 days',
    quarterly: 'over the last 3 months', halfyearly: 'over the last 6 months', yearly: 'over the last year',
  },
};
/* The CRM MIS page's periods (the board's keys since the TV follows that page). */
const CRM_WHEN_MIS = {
  hi: { 'this-week': 'इस हफ़्ते', 'last-week': 'पिछले हफ़्ते', 'this-month': 'इस महीने', 'last-month': 'पिछले महीने', custom: 'चुनी हुई तारीख़ों में' },
  en: { 'this-week': 'this week', 'last-week': 'last week', 'this-month': 'this month', 'last-month': 'last month', custom: 'in the chosen dates' },
};
/* The CRM's MIS engine counts IST calendar periods (This week, This month…) under the same keys. */
const CRM_WHEN_CALENDAR = {
  hi: {
    today: 'आज', weekly: 'इस हफ़्ते', monthly: 'इस महीने',
    quarterly: 'इस तिमाही में', halfyearly: 'इस छमाही में', yearly: 'इस साल',
  },
  en: {
    today: 'today', weekly: 'this week', monthly: 'this month',
    quarterly: 'this quarter', halfyearly: 'this half-year', yearly: 'this year',
  },
};
const SALES_WHEN = {
  hi: { today: 'आज', week: 'इस हफ़्ते', month: 'इस महीने' },
  en: { today: 'today', week: 'this week', month: 'this month' },
};
const ORDINALS = {
  hi: ['पहले', 'दूसरे', 'तीसरे', 'चौथे', 'पाँचवें'],
  en: ['first', 'second', 'third', 'fourth', 'fifth'],
};
/* The board's delay label is "2d 4h" / "3h 15m" / "45m" (d = 8-hour working day). */
const DELAY_UNITS = {
  hi: { d: ['दिन', 'दिन'], h: ['घंटा', 'घंटे'], m: ['मिनट', 'मिनट'] },
  en: { d: ['day', 'days'], h: ['hour', 'hours'], m: ['minute', 'minutes'] },
};

/* Grade letters spelled out for the Hindi voice. */
const GRADE_WORDS = { hi: { A: 'ए', B: 'बी', C: 'सी', D: 'डी', E: 'ई', F: 'एफ़' } };
const WORDS = { hi: { minus: 'माइनस', percent: 'प्रतिशत', grade: 'ग्रेड' }, en: { minus: 'minus', percent: 'percent', grade: 'grade' } };

const money = (label) => label.replace(/\s*·\s*/g, ', ');
const plural = (n, one, many) => (n === 1 ? one : many);
const oneDecimal = (v) => Math.round(v * 10) / 10;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/* The CRM's MIS engine scores a signed miss %, 0% best, with a grade: read it as the screen shows it. */
const isMis = (board) => Boolean(board && board.engine === 'mis');
const isCalendar = (board) => /^(this|today)\b/i.test((board && board.period && board.period.label) || '');
const crmWhen = (lang, board, key) => CRM_WHEN_MIS[lang][key] || (isCalendar(board) ? CRM_WHEN_CALENDAR : CRM_WHEN)[lang][key] || '';
/* Sound cues between the lines (speech.js): a fanfare for the top and the runner-up, a push for the last. */
const CONGRATS = { cue: 'congrats' };
const PUSH = { cue: 'push' };
const gradeWord = (lang, grade) => (GRADE_WORDS[lang] && GRADE_WORDS[lang][grade]) || grade;
/** "माइनस 24.6 प्रतिशत, ग्रेड सी" / "minus 24.6 percent, grade C". */
function misScoreWords(lang, score, grade) {
  const w = WORDS[lang];
  const said = `${score < 0 ? `${w.minus} ` : ''}${oneDecimal(Math.abs(score))} ${w.percent}`;
  return grade ? `${said}, ${w.grade} ${gradeWord(lang, grade)}` : said;
}
/** A person on an MIS board with their score in words, so every score line reads it like the screen. */
const spokenMis = (lang, p) => (isNum(p.score) ? { ...p, score: misScoreWords(lang, p.score, p.grade) } : p);

const LINES = {
  hi: {
    intro: { friendly: 'नमस्ते टीम, स्कोर लाइव का अपडेट सुनिए।', formal: 'स्कोर लाइव अपडेट।', energetic: 'चलो टीम! आज का स्कोर सुनिए!' },
    outro: { friendly: 'धन्यवाद, ऐसे ही अच्छा काम करते रहिए!', formal: 'धन्यवाद।', energetic: 'चलो टीम, आज का दिन हमारा है!' },
    praise: { friendly: 'बहुत बढ़िया!', formal: '', energetic: 'शानदार काम!' },
    noData: 'अभी स्कोर बोर्ड का डेटा नहीं आया है।',
    crmLeaders: (when, list) => `सी आर एम एग्ज़िक्यूटिव में ${when} सबसे आगे: ${list}।`,
    crmPerson: (p) => `${p.name}, स्कोर ${p.score}`,
    crmSpot: (when, p) => `सी आर एम में ${when} नंबर एक: ${p.name}, स्कोर ${p.score}${p.onTimePct != null ? `, ${p.onTimePct} प्रतिशत काम समय पर` : ''}।`,
    delayIntro: { friendly: 'इन पर ध्यान दीजिए।', formal: 'देरी वाले स्टेप।', energetic: 'ये काम आज ही ख़त्म करने हैं!' },
    crmDelay: (p, delay) => `${p.name} के ${p.overdue} स्टेप समय से पीछे हैं${delay ? `, औसत देरी ${delay}` : ''}${p.pending ? `, और ${p.pending} पेंडिंग हैं` : ''}।`,
    noDelay: 'अच्छी ख़बर, कोई भी स्टेप समय से पीछे नहीं है।',
    crmBottom: {
      friendly: (p) => `${p.name}, आपका स्कोर ${p.score} है, थोड़ा और ज़ोर लगाइए, आप कर सकते हैं।`,
      formal: (p) => `${p.name} का स्कोर ${p.score} है, इसमें सुधार ज़रूरी है।`,
      energetic: (p) => `${p.name}, स्कोर ${p.score}! आज पूरा दम लगाओ, ऊपर आना है!`,
    },
    salesLeaders: (when, list) => `सेल्स में ${when}: ${list}।`,
    salesPlace: (ordinal, name) => `${ordinal} नंबर पर ${name}`,
    salesSpot: (when, c) => `सेल्स में ${when} नंबर एक: ${c.name}${c.qualityPct != null ? `, क्वालिटी ${oneDecimal(c.qualityPct)} प्रतिशत` : ''}${c.reward === 'cash' ? ', कैश रिवॉर्ड के साथ' : ''}।`,
    salesBottom: {
      friendly: (when, c) => `${c.name}, सेल्स में ${when} आपका नंबर ${c.overallRank} है, थोड़ा और पुश कीजिए।`,
      formal: (when, c) => `सेल्स में ${when} ${c.name} का नंबर ${c.overallRank} है।`,
      energetic: (when, c) => `${c.name}, ${when} नंबर ${c.overallRank}! चलो, ऊपर चढ़ना है!`,
    },
    lastMonth: (list) => `पिछले महीने का नतीजा: ${list}।`,
    crmTeam: (when, s) => `${when} सी आर एम टीम ने ${s.doneTotal} स्टेप पूरे किए${s.onTimePct != null ? `, ${s.onTimePct} प्रतिशत समय पर` : ''}।`,
    crmTeamMis: (when, s, score) => `${when} सी आर एम टीम के ${s.steps} स्टेप ड्यू थे, ${s.onTimeDone} समय पर हुए; टीम का स्कोर ${score}।`,
    misTop: (when, p, delay) => `${when} सबसे आगे ${p.name}, स्कोर ${p.score}${delay ? `, औसत देरी ${delay}` : ''}।`,
    misNext: (list) => `उसके बाद ${list}।`,
    misLast: {
      friendly: (p, delay) => `सबसे पीछे ${p.name}, स्कोर ${p.score}${delay ? `, औसत देरी ${delay}` : ''}। थोड़ा और ज़ोर लगाइए, आप कर सकते हैं!`,
      formal: (p, delay) => `सबसे पीछे ${p.name}, स्कोर ${p.score}${delay ? `, औसत देरी ${delay}` : ''}। इसमें सुधार ज़रूरी है।`,
      energetic: (p, delay) => `सबसे पीछे ${p.name}, स्कोर ${p.score}${delay ? `, औसत देरी ${delay}` : ''}! चलो, पूरा दम लगाओ, ऊपर आना है!`,
    },
    peopleIntro: 'अब एक-एक करके सबका स्कोर और देरी।',
    person: (p, delay) => `नंबर ${p.rank}, ${p.name}: स्कोर ${p.score}${delay ? `, औसत देरी ${delay}` : ''}${p.overdue ? `, ${p.overdue} स्टेप बाकी` : ''}${p.worstStep ? `, सबसे ज़्यादा देरी ${p.worstStep.code} में` : ''}।`,
    personTop: { friendly: 'शाबाश, सबसे आगे!', formal: 'सबसे आगे।', energetic: 'ज़बरदस्त, नंबर वन!' },
    personRunnerUp: { friendly: 'बहुत अच्छे, दूसरे नंबर पर!', formal: 'दूसरे नंबर पर।', energetic: 'शानदार, नंबर दो!' },
    personLast: { friendly: 'थोड़ा और ज़ोर लगाइए, आप कर सकते हैं!', formal: 'सुधार की ज़रूरत है।', energetic: 'चलो, पूरा दम लगाओ, ऊपर आना है!' },
    missedStep: (row) => `सबसे ज़्यादा छूटने वाला स्टेप ${row.code}${row.label && row.label !== row.code ? `, ${row.label}` : ''}: ${row.planned} में से ${row.missed} छूटे।`,
    salesTeam: (when, o) => `सेल्स टीम ने ${when} ${o.completed} स्टेप पूरे किए।`,
    advance: (s) => `एडवांस बाकी: ${s.advanceDue} पी आई${s.advanceDueAmountLabel ? `, कुल ${money(s.advanceDueAmountLabel)}` : ''}।`,
    balance: (s) => `बैलेंस बाकी: ${s.balanceDue} पी आई${s.balanceDueAmountLabel ? `, कुल ${money(s.balanceDueAmountLabel)}` : ''}।`,
  },
  en: {
    intro: { friendly: 'Hello team, here is your Score Live update.', formal: 'Score Live update.', energetic: "Let's go team! Here's the score!" },
    outro: { friendly: 'Thank you, keep up the great work!', formal: 'Thank you.', energetic: "Let's make today count!" },
    praise: { friendly: 'Great work!', formal: '', energetic: 'Fantastic!' },
    noData: 'The score board has no data yet.',
    crmLeaders: (when, list) => `CRM Executives leading ${when}: ${list}.`,
    crmPerson: (p) => `${p.name}, score ${p.score}`,
    crmSpot: (when, p) => `CRM number one ${when}: ${p.name}, score ${p.score}${p.onTimePct != null ? `, ${p.onTimePct} percent on time` : ''}.`,
    delayIntro: { friendly: 'A few things need attention.', formal: 'Delayed steps.', energetic: "Let's clear these today!" },
    crmDelay: (p, delay) => `${p.name} has ${p.overdue} ${plural(p.overdue, 'step', 'steps')} past the deadline${delay ? `, ${delay} late on average` : ''}${p.pending ? `, and ${p.pending} pending` : ''}.`,
    noDelay: 'Good news, no step is past its deadline.',
    crmBottom: {
      friendly: (p) => `${p.name}, your score is ${p.score}. A little more push and you will be up there.`,
      formal: (p) => `${p.name} is at ${p.score} and needs to improve.`,
      energetic: (p) => `${p.name}, score ${p.score}! Give it everything today!`,
    },
    salesLeaders: (when, list) => `Sales ${when}: ${list}.`,
    salesPlace: (ordinal, name) => `${name} is ${ordinal}`,
    salesSpot: (when, c) => `Sales number one ${when}: ${c.name}${c.qualityPct != null ? `, quality ${oneDecimal(c.qualityPct)} percent` : ''}${c.reward === 'cash' ? ', earning the cash reward' : ''}.`,
    salesBottom: {
      friendly: (when, c) => `${c.name}, you are number ${c.overallRank} in sales ${when}. Keep pushing!`,
      formal: (when, c) => `${c.name} is number ${c.overallRank} in sales ${when}.`,
      energetic: (when, c) => `${c.name}, number ${c.overallRank} ${when}! Time to climb!`,
    },
    lastMonth: (list) => `Last month's final standings: ${list}.`,
    crmTeam: (when, s) => `The CRM team finished ${s.doneTotal} steps ${when}${s.onTimePct != null ? `, ${s.onTimePct} percent on time` : ''}.`,
    crmTeamMis: (when, s, score) => `The CRM team had ${s.steps} steps due ${when}, ${s.onTimeDone} on time; team score ${score}.`,
    misTop: (when, p, delay) => `Top ${when}: ${p.name}, score ${p.score}${delay ? `, ${delay} late on average` : ''}.`,
    misNext: (list) => `Then ${list}.`,
    misLast: {
      friendly: (p, delay) => `Last: ${p.name}, score ${p.score}${delay ? `, ${delay} late on average` : ''}. A little more push and you will be up there!`,
      formal: (p, delay) => `Last: ${p.name}, score ${p.score}${delay ? `, ${delay} late on average` : ''}. This needs to improve.`,
      energetic: (p, delay) => `Last: ${p.name}, score ${p.score}${delay ? `, ${delay} late on average` : ''}! Give it everything, time to climb!`,
    },
    peopleIntro: "Now everyone's score and delay, one by one.",
    person: (p, delay) => `Number ${p.rank}, ${p.name}: score ${p.score}${delay ? `, ${delay} late on average` : ''}${p.overdue ? `, ${p.overdue} ${plural(p.overdue, 'step', 'steps')} still open` : ''}${p.worstStep ? `, most delay on ${p.worstStep.code}` : ''}.`,
    personTop: { friendly: 'Well done, number one!', formal: 'Number one.', energetic: 'Fantastic, number one!' },
    personRunnerUp: { friendly: 'Great job, runner-up!', formal: 'Runner-up.', energetic: 'Brilliant, number two!' },
    personLast: { friendly: 'A little more push, you can do it!', formal: 'This needs to improve.', energetic: 'Come on, time to climb!' },
    missedStep: (row) => `Most missed step: ${row.code}${row.label && row.label !== row.code ? `, ${row.label}` : ''}, ${row.missed} of ${row.planned} missed.`,
    salesTeam: (when, o) => `The sales team finished ${o.completed} steps ${when}.`,
    advance: (s) => `Advance due on ${s.advanceDue} P I${s.advanceDueAmountLabel ? `, ${money(s.advanceDueAmountLabel)} in total` : ''}.`,
    balance: (s) => `Balance due on ${s.balanceDue} P I${s.balanceDueAmountLabel ? `, ${money(s.balanceDueAmountLabel)} in total` : ''}.`,
  },
};

const delayWords = (label, lang) => label.replace(/(\d+(?:\.\d+)?)([dhm])/g, (_, n, unit) => {
  const [one, many] = DELAY_UNITS[lang][unit];
  return `${n} ${plural(Number(n), one, many)}`;
});

const rankedPeople = (people = []) => people.filter((p) => p.rank != null).sort((a, b) => a.rank - b.rank);
const rankedCoordinators = (list = []) =>
  list.filter((c) => c.overallRank != null && !c.noWorkDone).sort((a, b) => a.overallRank - b.overallRank);

/* ---------- one board each (falsy entries are dropped later) ---------- */
/* On the MIS engine the team line is steps due and on time, with the team's score. */
function crmTeamLine(L, board, when, voice) {
  const s = board.summary || {};
  if (!isMis(board)) return s.doneTotal != null && L.crmTeam(when, s);
  return isNum(s.steps) && isNum(s.score) && L.crmTeamMis(when, s, misScoreWords(voice.language, s.score, s.grade));
}

const delayOf = (p, lang) => (p.avgDelayLabel ? delayWords(p.avgDelayLabel, lang) : '');

/* On the MIS engine: who is top and how late they run (with a fanfare), then the next ones. */
function misLeaderLines(L, ranked, when, voice) {
  const [top, ...rest] = ranked;
  const next = rest.slice(0, Math.max(0, voice.topCount - 1));
  return [
    CONGRATS,
    L.misTop(when, top, delayOf(top, voice.language)),
    next.length ? L.misNext(next.map(L.crmPerson).join('; ')) : null,
    L.praise[voice.style],
  ];
}

function crmLines(L, board, when, voice) {
  const on = voice.sections;
  const mis = isMis(board);
  const say = (p) => (mis ? spokenMis(voice.language, p) : p);
  const ranked = rankedPeople(board.people).map(say);
  const late = (board.people || []).filter((p) => p.overdue > 0)
    .sort((a, b) => b.overdue - a.overdue).slice(0, voice.delayCount);
  const s = board.summary || {};
  const delays = late.length
    ? [L.delayIntro[voice.style], ...late.map((p) => L.crmDelay(p, delayOf(p, voice.language)))]
    : [L.noDelay];
  // The CRM's "where work misses": the step missed most this period.
  const missed = board.insights && board.insights.steps && board.insights.steps[0];
  const last = ranked.length > 1 ? ranked.at(-1) : null;
  const leaders = mis
    ? misLeaderLines(L, ranked, when, voice)
    : [CONGRATS, L.crmLeaders(when, ranked.slice(0, voice.topCount).map(L.crmPerson).join('; ')), L.praise[voice.style]];
  return [
    ...(on.leaders && ranked.length ? leaders : []),
    ...(on.delays ? delays : []),
    on.delays && missed && missed.missed > 0 && L.missedStep(missed),
    // The last person, with how late they run, and a push. Named once: not when the leaders already did.
    ...(on.bottom && last && ranked.length > voice.topCount
      ? [PUSH, mis ? L.misLast[voice.style](last, delayOf(last, voice.language)) : L.crmBottom[voice.style](last)]
      : []),
    on.team && crmTeamLine(L, board, when, voice),
    on.payments && s.advanceDue > 0 && L.advance(s),
    on.payments && s.balanceDue > 0 && L.balance(s),
  ];
}

/**
 * The walkthrough's lines for one person (the CRM board's people, one card each): their place,
 * score and grade, how late they run, what is still open and where they miss most; a fanfare for
 * the top and the runner-up, a push for the last. The first card opens with what is coming.
 */
export function personLines(board, index, voice) {
  const L = LINES[voice.language];
  const ranked = rankedPeople((board && board.people) || []);
  const person = ranked[index];
  if (!person) return [];
  const p = isMis(board) ? spokenMis(voice.language, person) : person;
  const isLast = ranked.length > 2 && index === ranked.length - 1;
  const lead = person.rank === 1 ? [CONGRATS] : person.rank === 2 ? [CONGRATS] : isLast ? [PUSH] : [];
  const tail = person.rank === 1 ? L.personTop[voice.style] : person.rank === 2 ? L.personRunnerUp[voice.style] : isLast ? L.personLast[voice.style] : '';
  return [index === 0 ? L.peopleIntro : '', ...lead, L.person(p, delayOf(person, voice.language)), tail].filter(Boolean);
}

function crmSpotLines(L, board, when, voice) {
  const lead = rankedPeople(board.people)[0];
  if (!voice.sections.leaders || !lead) return [];
  return [CONGRATS, L.crmSpot(when, isMis(board) ? spokenMis(voice.language, lead) : lead), L.praise[voice.style]];
}

function salesPlaces(L, board, voice) {
  return rankedCoordinators(board.coordinators).slice(0, voice.topCount)
    .map((c, i) => L.salesPlace(ORDINALS[voice.language][i], c.name)).join(', ');
}

function salesLines(L, board, when, voice) {
  const on = voice.sections;
  const ranked = rankedCoordinators(board.coordinators);
  return [
    ...(on.leaders && ranked.length ? [L.salesLeaders(when, salesPlaces(L, board, voice)), L.praise[voice.style]] : []),
    on.bottom && ranked.length > voice.topCount && L.salesBottom[voice.style](when, ranked.at(-1)),
    on.team && board.overall?.completed != null && L.salesTeam(when, board.overall),
  ];
}

function salesSpotLines(L, board, when, voice) {
  const lead = rankedCoordinators(board.coordinators)[0];
  return voice.sections.leaders && lead ? [L.salesSpot(when, lead), L.praise[voice.style]] : [];
}

function lastMonthLines(L, board, voice) {
  const hasRanks = rankedCoordinators(board.coordinators).length > 0;
  return voice.sections.leaders && hasRanks ? [L.lastMonth(salesPlaces(L, board, voice)), L.praise[voice.style]] : [];
}

const BOARDS = {
  crm: (L, data, p, voice) => { const b = crmBoard(data, p.crm); return b ? crmLines(L, b, crmWhen(voice.language, b, p.crm), voice) : []; },
  'crm-leader': (L, data, p, voice) => { const b = crmBoard(data, p.crm); return b ? crmSpotLines(L, b, crmWhen(voice.language, b, p.crm), voice) : []; },
  // The walkthrough speaks per person as each card comes up (personLines).
  'crm-people': () => [],
  sales: (L, data, p, voice) => { const b = salesBoard(data, p.sales); return b ? salesLines(L, b, SALES_WHEN[voice.language][p.sales], voice) : []; },
  'sales-leader': (L, data, p, voice) => { const b = salesBoard(data, p.sales); return b ? salesSpotLines(L, b, SALES_WHEN[voice.language][p.sales], voice) : []; },
  'sales-previous': (L, data, p, voice) => { const b = salesPrevious(data); return b ? lastMonthLines(L, b, voice) : []; },
};

/** Lines for the board on screen ([] when it has nothing to say). `periods` = { crm, sales } keys the screen shows. */
export function boardLines(boardId, data, periods, voice) {
  const build = BOARDS[boardId];
  return build && data ? build(LINES[voice.language], data, periods, voice).filter(Boolean) : [];
}

export const introLine = (voice) => LINES[voice.language].intro[voice.style];
export const outroLine = (voice) => LINES[voice.language].outro[voice.style];

/** One combined update: CRM then Sales, opened and closed in the chosen style. */
export function summaryLines(data, periods, voice) {
  const L = LINES[voice.language];
  const crm = data ? crmBoard(data, periods.crm) : null;
  const sales = data ? salesBoard(data, periods.sales) : null;
  if (!crm && !sales) return [L.noData];
  return [
    introLine(voice),
    ...(crm ? crmLines(L, crm, crmWhen(voice.language, crm, periods.crm), voice) : []),
    ...(sales ? salesLines(L, sales, SALES_WHEN[voice.language][periods.sales], voice) : []),
    outroLine(voice),
  ].filter(Boolean);
}
