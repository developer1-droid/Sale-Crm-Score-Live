// Voice: settings cleaning/validation, schedule, and what is said for each board.
// Run: npm test (node --test).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VOICE_DEFAULTS, sanitizeVoice, voiceErrors } from '../public/js/voice/voiceModel.js';
import { GRACE_MS, dueSlot, scheduleLabel } from '../public/js/voice/schedule.js';
import { boardLines, personLines, summaryLines } from '../public/js/voice/script.js';
import { DEFAULT_SETTINGS, normalize } from '../lib/settings.js';

const voiceWith = (patch) => sanitizeVoice(patch);

describe('voice settings', () => {
  it('fills the defaults when nothing is saved yet', () => {
    assert.deepEqual(sanitizeVoice(undefined), { ...VOICE_DEFAULTS });
  });

  it('keeps times in the order they were entered and drops repeats', () => {
    assert.deepEqual(voiceWith({ times: ['16:30', '09:00', '16:30'] }).times, ['16:30', '09:00']);
  });

  it('reports bad values instead of saving them', () => {
    assert.equal(voiceErrors({ times: ['9am'] }).length, 1);
    assert.equal(voiceErrors({ volume: 3 }).length, 1);
    assert.equal(voiceErrors({ sections: { jokes: true } }).length, 1);
    assert.deepEqual(voiceErrors({ enabled: true, mode: 'summary', times: ['09:30'] }), []);
  });

  it('is part of the shared settings the server stores', () => {
    const { settings, errors } = normalize({ voice: { enabled: true, times: ['09:30'] } });
    assert.deepEqual(errors, []);
    assert.equal(settings.voice.enabled, true);
    assert.deepEqual(settings.voice.times, ['09:30']);
  });

  it('keeps the saved voice when an update is invalid', () => {
    const { settings, errors } = normalize({ voice: { times: ['9am'] } });
    assert.match(errors[0], /^voice\.times/);
    assert.deepEqual(settings.voice.times, VOICE_DEFAULTS.times);
  });

  it('gives settings saved before the voice existed the default voice', () => {
    const { voice, ...older } = DEFAULT_SETTINGS;
    assert.deepEqual(normalize({}, older).settings.voice, voice);
  });

  it('needs at least one thing to say', () => {
    const allOff = Object.fromEntries(Object.keys(VOICE_DEFAULTS.sections).map((k) => [k, false]));
    assert.deepEqual(normalize({ voice: { sections: allOff } }).errors, ['voice must say at least one thing']);
  });
});

describe('voice schedule', () => {
  const daily = voiceWith({ enabled: true, times: ['16:30', '10:00'] });
  // weekday 1 = Monday 2026-10-05, 4 = Thursday 2026-10-08 (Date#getDay numbering)
  const at = (weekday, h, m) => new Date(2026, 9, 4 + weekday, h, m);

  it('plays a time from its minute until the grace window ends, once per screen', () => {
    assert.equal(dueSlot(daily, at(1, 10, 0)), '2026-10-05 10:00');
    assert.equal(dueSlot(daily, new Date(at(1, 10, 0).getTime() + GRACE_MS - 1)), '2026-10-05 10:00');
    assert.equal(dueSlot(daily, new Date(at(1, 10, 0).getTime() + GRACE_MS)), null);
    assert.equal(dueSlot(daily, at(1, 10, 2), ['2026-10-05 10:00']), null);
  });

  it('stays quiet when off and on days a weekly schedule skips', () => {
    assert.equal(dueSlot({ ...daily, enabled: false }, at(1, 10, 0)), null);
    const weekly = { ...daily, frequency: 'weekly', weekdays: [4] };
    assert.equal(dueSlot(weekly, at(1, 10, 0)), null);
    assert.equal(dueSlot(weekly, at(4, 10, 0)), '2026-10-08 10:00');
  });

  it('keeps to the office IST clock even on a screen whose own time zone is not IST', () => {
    // 04:32 UTC = 10:02 IST on Monday 5 Oct 2026, whatever TZ this process runs in.
    assert.equal(dueSlot(daily, new Date('2026-10-05T04:32:00Z')), '2026-10-05 10:00');
    assert.equal(dueSlot(daily, new Date('2026-10-05T10:00:00Z')), null); // 15:30 IST: nothing due
    const weekly = { ...daily, frequency: 'weekly', weekdays: [1] };
    assert.equal(dueSlot(weekly, new Date('2026-10-04T23:00:00Z')), null); // Sun 23:00 UTC is Mon 04:30 IST: no 10:00 yet
  });

  it('describes the schedule in time order', () => {
    assert.equal(scheduleLabel(daily), 'Every day at 10:00, 16:30 IST');
    assert.equal(scheduleLabel({ ...daily, frequency: 'weekly', weekdays: [1, 4] }), 'Mon, Thu at 10:00, 16:30 IST');
  });
});

describe('what the voice says', () => {
  const coordinators = [
    { name: 'Sulochana', overallRank: 2, qualityPct: 18.26 },
    { name: 'Manmeet Kaur', overallRank: 1, qualityPct: 22.44, reward: 'cash' },
    { name: 'Idle', overallRank: null, noWorkDone: true },
  ];
  const data = {
    crm: {
      byPeriod: {
        today: {
          summary: { doneTotal: 40, onTimePct: 80, advanceDue: 11, advanceDueAmountLabel: 'USD 215,652', balanceDue: 0 },
          people: [
            { name: 'Asha', rank: 1, score: 92, onTimePct: 95, overdue: 0, pending: 1 },
            { name: 'Ravi', rank: 2, score: 70, overdue: 3, pending: 2, avgDelayLabel: '1d 4h' },
            { name: 'Amit', rank: 3, score: 40, overdue: 1, pending: 0, avgDelayLabel: '45m' },
          ],
        },
      },
    },
    sales: {
      byPeriod: { month: { overall: { completed: 87 }, coordinators } },
      previous: { coordinators },
    },
  };
  const periods = { crm: 'today', sales: 'month' };
  const english = voiceWith({ language: 'en', style: 'formal', topCount: 2, sections: { bottom: true } });

  it('reads the CRM board: leaders (with a fanfare), who is late and by how much, the last one (with a push), totals', () => {
    assert.deepEqual(boardLines('crm', data, periods, english), [
      { cue: 'congrats' },
      'CRM Executives leading today: Asha, score 92; Ravi, score 70.',
      'Delayed steps.',
      'Ravi has 3 steps past the deadline, 1 day 4 hours late on average, and 2 pending.',
      'Amit has 1 step past the deadline, 45 minutes late on average.',
      { cue: 'push' },
      'Amit is at 40 and needs to improve.',
      'The CRM team finished 40 steps today, 80 percent on time.',
      'Advance due on 11 P I, USD 215,652 in total.',
    ]);
  });

  it('reads the Sales board with nothing about the CRM', () => {
    assert.deepEqual(boardLines('sales', data, periods, english), [
      'Sales this month: Manmeet Kaur is first, Sulochana is second.',
      'The sales team finished 87 steps this month.',
    ]);
  });

  it('reads each spotlight and last month', () => {
    assert.deepEqual(boardLines('crm-leader', data, periods, english), [{ cue: 'congrats' }, 'CRM number one today: Asha, score 92, 95 percent on time.']);
    assert.deepEqual(boardLines('sales-leader', data, periods, english), ['Sales number one this month: Manmeet Kaur, quality 22.4 percent, earning the cash reward.']);
    assert.deepEqual(boardLines('sales-previous', data, periods, english), ["Last month's final standings: Manmeet Kaur is first, Sulochana is second."]);
  });

  it('speaks Hindi in Devanagari, in the chosen style', () => {
    const lines = boardLines('crm', data, periods, voiceWith({ style: 'energetic' }));
    assert.equal(lines[2], 'शानदार काम!');
    assert.ok(lines.includes('Ravi के 3 स्टेप समय से पीछे हैं, औसत देरी 1 दिन 4 घंटे, और 2 पेंडिंग हैं।'));
  });

  it('builds one summary, opened and closed in the chosen style', () => {
    const lines = summaryLines(data, periods, english);
    assert.equal(lines[0], 'Score Live update.');
    assert.equal(lines.at(-1), 'Thank you.');
    assert.ok(lines.includes('Sales this month: Manmeet Kaur is first, Sulochana is second.'));
  });

  it('says so when there is no board yet', () => {
    assert.deepEqual(summaryLines(null, periods, english), ['The score board has no data yet.']);
    assert.deepEqual(boardLines('crm', null, periods, english), []);
  });
});

describe('what the voice says on the CRM MIS board', () => {
  const people = [
    { name: 'Sanskriti', rank: 1, score: -24.6, scoreText: '−24.6%', grade: 'C', onTimePct: 75, overdue: 10, pending: 14, avgDelayLabel: '15h 57m', worstStep: { code: 'SO-3', missed: 6, planned: 6 } },
    { name: 'Shivani Yadav', rank: 2, score: -31.6, scoreText: '−31.6%', grade: 'D', onTimePct: 68, overdue: 6, pending: 8, avgDelayLabel: '15h 20m' },
    { name: 'Shalu Singh', rank: 3, score: -85.7, scoreText: '−85.7%', grade: 'D', onTimePct: 14, overdue: 4, pending: 9, avgDelayLabel: '15h 10m' },
  ];
  const board = {
    engine: 'mis',
    period: { key: 'this-week', label: 'This week', dates: '12 – 18 Oct 2026' },
    summary: { score: -44.3, scoreText: '−44.3%', grade: 'D', steps: 174, onTimeDone: 97 },
    people,
    insights: { steps: [{ code: 'DA-S2', label: 'Design Approval — Buyer Approval', planned: 42, missed: 22 }], moreSteps: 0, reasons: [], delayed: 0 },
  };
  const data = { crm: { engine: 'mis', byPeriod: { 'this-week': board } } };
  const periods = { crm: 'this-week', sales: 'month' };
  const sections = { leaders: true, delays: false, bottom: true, team: true, payments: false };

  it('reads the minus score and grade as the screen shows them, who is top and who is last with their delay', () => {
    const lines = boardLines('crm', data, periods, voiceWith({ language: 'en', style: 'formal', topCount: 2, sections }));
    assert.deepEqual(lines, [
      { cue: 'congrats' },
      'Top this week: Sanskriti, score minus 24.6 percent, grade C, 15 hours 57 minutes late on average.',
      'Then Shivani Yadav, score minus 31.6 percent, grade D.',
      { cue: 'push' },
      'Last: Shalu Singh, score minus 85.7 percent, grade D, 15 hours 10 minutes late on average. This needs to improve.',
      'The CRM team had 174 steps due this week, 97 on time; team score minus 44.3 percent, grade D.',
    ]);
  });

  it('speaks the MIS lines in Hindi with the grade letters spelled out', () => {
    const lines = boardLines('crm', data, periods, voiceWith({ topCount: 2, sections }));
    assert.equal(lines[1], 'इस हफ़्ते सबसे आगे Sanskriti, स्कोर माइनस 24.6 प्रतिशत, ग्रेड सी, औसत देरी 15 घंटे 57 मिनट।');
  });

  it('names the step missed most among the delays', () => {
    const lines = boardLines('crm', data, periods, voiceWith({ language: 'en', sections: { ...sections, delays: true } }));
    assert.ok(lines.includes('Most missed step: DA-S2, Design Approval — Buyer Approval, 22 of 42 missed.'));
  });

  it('reads one card at a time in the walkthrough: a fanfare for the top and the runner-up, a push for the last', () => {
    const english = voiceWith({ language: 'en', style: 'friendly' });
    assert.deepEqual(personLines(board, 0, english), [
      "Now everyone's score and delay, one by one.",
      { cue: 'congrats' },
      'Number 1, Sanskriti: score minus 24.6 percent, grade C, 15 hours 57 minutes late on average, 10 steps still open, most delay on SO-3.',
      'Well done, number one!',
    ]);
    assert.deepEqual(personLines(board, 1, english)[0], { cue: 'congrats' });
    assert.deepEqual(personLines(board, 2, english).slice(0, 1), [{ cue: 'push' }]);
    assert.equal(personLines(board, 2, english).at(-1), 'A little more push, you can do it!');
    assert.deepEqual(personLines(null, 0, english), []);
  });
});

describe('settings saved before the CRM MIS periods', () => {
  it('reads the old CRM period as the nearest MIS period and adds the walkthrough board in its place', () => {
    const old = { crmPeriod: 'monthly', boards: DEFAULT_SETTINGS.boards.filter((b) => b.id !== 'crm-people').map((b) => ({ ...b, dwellSec: 9 })) };
    const { settings, errors } = normalize(old);
    assert.deepEqual(errors, []);
    assert.equal(settings.crmPeriod, 'this-month');
    assert.deepEqual(settings.boards.map((b) => b.id), ['crm', 'crm-people', 'crm-leader', 'sales', 'sales-leader', 'sales-previous']);
    assert.equal(settings.boards.find((b) => b.id === 'sales').dwellSec, 9);
  });

  it('keeps custom CRM dates only as a whole, ordered range', () => {
    assert.deepEqual(normalize({ crmCustom: { from: '2026-10-01', to: '2026-10-15' } }).settings.crmCustom, { from: '2026-10-01', to: '2026-10-15' });
    assert.equal(normalize({ crmCustom: { from: '2026-10-15', to: '2026-10-01' } }).errors.length, 1);
    assert.deepEqual(normalize({ crmCustom: { from: '', to: '' } }).settings.crmCustom, { from: '', to: '' });
  });
});
