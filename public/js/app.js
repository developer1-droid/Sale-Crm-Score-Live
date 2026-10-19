/* Score Live TV board: wires data, settings, period filters and rotation together. */
import { $, el, keyOf } from "./dom.js";
import { setMotion } from "./motion.js";
import { createTheme } from "./theme.js";
import {
  CRM_PERIODS,
  SALES_PERIODS,
  sanitizeSettings,
} from "./settingsModel.js";
import { createSettingsStore, PinError } from "./settingsStore.js";
import {
  crmBoard,
  salesBoard,
  salesPrevious,
  periodLabel,
  hasRows,
} from "./payload.js";
import { createCrmView } from "./crmView.js";
import { createPeopleView, rankedPeopleOf } from "./peopleView.js";
import { createAnnouncerHost } from "./mascot.js";
import { createSalesView } from "./salesView.js";
import { createSpotView, crmSpotModel, salesSpotModel } from "./spotView.js";
import { createRotation } from "./rotation.js";
import { createFilterBar } from "./filterBar.js";
import { createTicker } from "./ticker.js";
import { createControls } from "./controls.js";
import { createStatus } from "./status.js";
import { startLive, startMock } from "./source.js";
import { createAnnouncer } from "./voice/announcer.js";
import { rememberScores } from "./voice/local.js";
import { onSpeech } from "./voice/speech.js";

const params = new URLSearchParams(location.search);
const IS_MOCK = params.get("mock") === "1";
const RESIZE_DEBOUNCE_MS = 200;
const FIRST_RELAYOUT_MS = 1500;
const crmKeys = CRM_PERIODS.map((p) => p.key);
const salesKeys = SALES_PERIODS.map((p) => p.key);

const store = createSettingsStore({ mock: IS_MOCK });
let settings = store.cached();
let data = null;
/* A chip click overrides the shared default on this screen only, until "Set as default". */
let crmOverride = crmKeys.includes(params.get("crm"))
  ? params.get("crm")
  : null;
let salesOverride = salesKeys.includes(params.get("sales"))
  ? params.get("sales")
  : null;
const crmKey = () => {
  const key = crmOverride || settings.crmPeriod;
  return key === "custom" && !hasCustom() ? "this-week" : key;
};
const salesKey = () => salesOverride || settings.salesPeriod;

const theme = createTheme({
  urlTheme: params.get("theme"),
  shared: settings.theme,
});
setMotion(settings.animation);
const status = createStatus(IS_MOCK ? "demo" : "connecting");
const announcer = createAnnouncer({
  getData: () => data,
  getPeriods: () => ({ crm: crmKey(), sales: salesKey() }),
  onBlockedChange: () => renderChrome(),
});
announcer.setVoice(settings.voice);
// Whenever the voice speaks, the cartoon announcer comes in from the side with what it says.
const announcerHost = createAnnouncerHost(document.body);
onSpeech((event) => announcerHost.handle(event));

/* ---------------- views ---------------- */
const crmView = createCrmView();
const peopleView = createPeopleView({
  onPerson: (board, index) => announcer.personShown(board, index),
});
const salesView = createSalesView();
const prevView = createSalesView();
const crmSpot = createSpotView();
const salesSpot = createSpotView();
const emptyRoot = el("div", "view");
emptyRoot.appendChild(
  el("div", "empty", "Waiting for the first scores from the CRM"),
);

const chipLabel = (list, key) =>
  (list.find((p) => p.key === key) || { chip: key }).chip;
/* The chips follow the CRM's own period names; the custom chip shows its dates ("1 – 15 Oct"). */
const MAX_CHIP_LABEL = 14;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayMonth = (ymd) => {
  const [, m, d] = String(ymd).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
};
const shortRange = (from, to) => (from === to ? dayMonth(from) : `${dayMonth(from)} – ${dayMonth(to)}`);
const customBoard = () => (data && data.crm && data.crm.byPeriod ? data.crm.byPeriod.custom || null : null);
function crmChipLabels() {
  const periods = data && data.crm && data.crm.periods;
  if (!Array.isArray(periods)) return null;
  const labels = {};
  periods.forEach((p) => {
    if (p && p.label && p.label.length <= MAX_CHIP_LABEL) labels[p.key] = p.label;
  });
  const custom = customBoard();
  if (custom && custom.period && custom.period.from) labels.custom = shortRange(custom.period.from, custom.period.to);
  return labels;
}
const crmChip = (key) => (crmChipLabels() || {})[key] || chipLabel(CRM_PERIODS, key);
/* No custom dates chosen: the Custom chip is hidden and a screen set to it shows This week. */
const hasCustom = () => !data || Boolean(customBoard());
const crmLabel = () => periodLabel("crm", data, crmKey());
const salesLabel = () => periodLabel("sales", data, salesKey());
const prevLabel = () => {
  const p = salesPrevious(data);
  return (p && p.period && p.period.label) || "Last month";
};

const VIEWS = [
  {
    id: "crm",
    kind: "board",
    group: "crm",
    impl: crmView,
    rail: "CRM Executive",
    ok: () => Boolean(data && data.crm),
    head: () => ({
      kicker: "Leaderboard",
      title: (crmBoard(data, crmKey()) || {}).title || "CRM Executive",
      period: crmLabel(),
    }),
  },
  {
    id: "crm-people",
    kind: "board",
    group: "crm",
    impl: peopleView,
    rail: "Each person",
    ok: () => rankedPeopleOf(crmBoard(data, crmKey())).length > 0,
    head: () => ({
      kicker: "Score & delay · one by one",
      title: "CRM Executive",
      period: crmLabel(),
    }),
  },
  {
    id: "crm-leader",
    kind: "spot",
    group: "crm",
    impl: crmSpot,
    rail: "Leader",
    ok: () => Boolean(crmSpotModel(crmBoard(data, crmKey()))),
    head: () => ({
      kicker: "Spotlight",
      title: "CRM Executive leader",
      period: crmLabel(),
    }),
  },
  {
    id: "sales",
    kind: "board",
    group: "sales",
    impl: salesView,
    rail: "Sales Coordinators",
    ok: () => Boolean(data && data.sales),
    head: () => ({
      kicker: "Leaderboard",
      title: "Sales Coordinators",
      period: salesLabel(),
    }),
  },
  {
    id: "sales-leader",
    kind: "spot",
    group: "sales",
    impl: salesSpot,
    rail: "Leader",
    ok: () => Boolean(salesSpotModel(salesBoard(data, salesKey()))),
    head: () => ({
      kicker: "Spotlight",
      title: "Sales Coordinator leader",
      period: salesLabel(),
    }),
  },
  {
    id: "sales-previous",
    kind: "board",
    group: null,
    impl: prevView,
    rail: "Last month",
    ok: () => hasRows(salesPrevious(data), "coordinators"),
    head: () => ({
      kicker: "Final standings",
      title: "Sales Coordinators",
      period: prevLabel(),
    }),
  },
];

function showHeader(v) {
  announcer.boardShown(v ? v.id : null);
  const h = v
    ? v.head()
    : { kicker: "Leaderboard", title: "Waiting for scores", period: "" };
  $("kicker").textContent = h.kicker;
  $("title").textContent = h.title;
  $("period").textContent = h.period || "";
  document.title = `${h.title} · Shazia Rice`;
  renderChrome();
}

const BOARD_ALIASES = { "sales-prev": "sales-previous" };
const rotation = createRotation({
  stage: $("stage"),
  views: VIEWS,
  emptyRoot,
  wipe: $("wipe"),
  railList: $("segments"),
  getSettings: () => settings,
  onShow: showHeader,
  startId: BOARD_ALIASES[params.get("board")] || params.get("board"),
  startPaused: params.get("paused") === "1",
});

// While the voice reads the slides, it moves them on (each one stays until its lines are said).
announcer.setRotation(rotation);

/* ---------------- filter bar, ticker, rail note ---------------- */
const filterBar = createFilterBar($("filterbar"), {
  onPick: pickPeriod,
  onSaveDefault: saveDefaultPeriods,
});
const ticker = createTicker($("ticker"));

function renderChrome() {
  const current = VIEWS.find((v) => v.id === rotation.current());
  filterBar.render({
    crmKey: crmKey(),
    salesKey: salesKey(),
    focus: current ? current.group : null,
    isDirty:
      crmKey() !== settings.crmPeriod || salesKey() !== settings.salesPeriod,
    visible: settings.showFilterBar,
    crmLabels: crmChipLabels(),
    crmHidden: hasCustom() ? [] : ["custom"],
  });
  const bits = [];
  if (IS_MOCK) bits.push("Demo data");
  if (rotation.isPaused()) bits.push("Paused · space to resume");
  else if (!settings.rotate) bits.push("Single board");
  const sources = Object.entries(
    (data && data.status && data.status.sources) || {},
  );
  const named = (state) =>
    sources.filter(([, x]) => x === state).map(([name]) => name);
  const stale = named("stale");
  const down = named("error");
  if (stale.length) bits.push(`${stale.join(", ")}: using last good data`);
  if (down.length) bits.push(`${down.join(", ")}: unavailable`);
  if (announcer.isBlocked()) bits.push("Sound blocked · click once to allow");
  else if (announcer.isSilentHere()) bits.push("Voice off on this screen · Settings → This screen speaks");
  $("railNote").textContent = bits.join("  ·  ");
}

/* ---------------- applying data ---------------- */
function updateBoards({ periodSwitch = false } = {}) {
  if (!data) return;
  const live = (id) => rotation.current() === id;
  const crm = crmBoard(data, crmKey());
  const sales = salesBoard(data, salesKey());
  const trackMoves = !periodSwitch;
  crmView.update(crm, {
    animate: live("crm"),
    trackMoves,
    periodLabel: crmLabel(),
  });
  peopleView.update(crm);
  salesView.update(sales, {
    animate: live("sales"),
    trackMoves,
    periodLabel: salesLabel(),
  });
  prevView.update(salesPrevious(data), {
    animate: live("sales-previous"),
    trackMoves,
    periodLabel: "last month",
  });
  const crmModel = crmSpotModel(crm);
  if (crmModel) crmSpot.update(crmModel);
  const salesModel = salesSpotModel(sales);
  if (salesModel) salesSpot.update(salesModel);
  ticker.render({
    visible: settings.showTicker,
    crm,
    crmLabel: crmChip(crmKey()),
    sales,
    salesLabel: chipLabel(SALES_PERIODS, salesKey()),
    previous: salesPrevious(data),
  });
}

function applyData(payload) {
  if (!payload || typeof payload !== "object") return;
  data = payload;
  rememberScores(payload);
  status.setData(payload);
  updateBoards();
  rotation.refresh();
  renderChrome();
  if (isFirstData) {
    isFirstData = false;
    setTimeout(() => rotation.relayout(), FIRST_RELAYOUT_MS);
  }
}

function applySettings(next) {
  const prev = settings;
  settings = next;
  if (
    crmOverride === settings.crmPeriod ||
    prev.crmPeriod !== settings.crmPeriod
  )
    crmOverride = null;
  if (
    salesOverride === settings.salesPeriod ||
    prev.salesPeriod !== settings.salesPeriod
  )
    salesOverride = null;
  theme.setShared(settings.theme);
  announcer.setVoice(settings.voice);
  setMotion(settings.animation);
  [crmView, salesView, prevView].forEach((v) =>
    v.list.setRowsPerPage(settings.rowsPerPage),
  );
  updateBoards({ periodSwitch: true });
  rotation.refresh({ reschedule: true });
  renderChrome();
}

/* ---------------- periods ---------------- */
function pickPeriod(kind, key) {
  if (kind === "crm") crmOverride = key === settings.crmPeriod ? null : key;
  else salesOverride = key === settings.salesPeriod ? null : key;
  updateBoards({ periodSwitch: true });
  rotation.refresh();
  const current = VIEWS.find((v) => v.id === rotation.current());
  if (!current || current.group !== kind) rotation.go(kind);
  else showHeader(current);
}

function saveDefaultPeriods() {
  return store
    .save({ crmPeriod: crmKey(), salesPeriod: salesKey() })
    .then(applySettings)
    .catch((err) => {
      throw err instanceof PinError
        ? new Error("PIN needed: open settings (S)")
        : err;
    });
}

/* ---------------- controls ---------------- */
createControls({
  onTheme: () => theme.toggle(),
  onSettings: () => {
    location.href = `settings.html${IS_MOCK ? "?mock=1" : ""}`;
  },
  onKey: (e) => {
    const key = keyOf(e);
    if (key.toLowerCase() === "v") {
      announcer.speakNow();
      return;
    }
    if (key === "ArrowRight") {
      rotation.step(1);
      return;
    }
    if (key === "ArrowLeft") {
      rotation.step(-1);
      return;
    }
    if (key === " ") {
      e.preventDefault();
      rotation.togglePause();
      renderChrome();
      return;
    }
    const n = Number(key);
    if (n >= 1 && n <= crmKeys.length) pickPeriod("crm", crmKeys[n - 1]);
  },
});

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => rotation.relayout(), RESIZE_DEBOUNCE_MS);
});
// A TV can lay the board out before its fonts and screen size settle (rows then overflow and
// look cut off): measure again once they have, and once shortly after the first scores.
window.addEventListener("load", () => rotation.relayout());
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => rotation.relayout()).catch(() => {});
}
let isFirstData = true;

/* ---------------- start ---------------- */
applySettings(settings);
if (IS_MOCK) {
  store.onExternalChange(applySettings);
  startMock({
    onScores: applyData,
    onConn: status.setConn,
    padRows: Number(params.get("rows")) || 0,
    still: params.get("still") === "1",
  });
} else {
  store
    .load()
    .then(applySettings)
    .catch(() => {
      /* keep the cached settings; the socket sends fresh ones */
    });
  startLive({
    onScores: applyData,
    onSettings: (s) =>
      applySettings(store.remember(sanitizeSettings(s, settings))),
    onConn: (state) =>
      status.setConn(
        state === "reconnecting" && !status.hasData() ? "offline" : state,
      ),
  });
}
