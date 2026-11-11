import {
  DEAL_TYPES, DOW, MONTHS, NEARBY, OUR_CLAUSE, SEASON_YEAR, TIERS, VENUE, activeHolds, addDays, applyActs,
  builderShow, builderSummary, clampState, confirmedOn, dealMemo, decodeState, dow, encodeState, fmtInt, fmtMoney, makeBook, manifest,
  milesTo, openChallenge, parseActs, pct, radiusConflicts, rankLabel, rankOf, settle, simulateSeason,
} from "./settle.js";

const $ = (id) => document.getElementById(id);
const SVG_NS = "http://www.w3.org/2000/svg";

let st = decodeState(location.hash);
let base = null; // { seed, book, routing }
let B = null; // book after the desk actions
let errors = [];
let SEASON = null;

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "text") node.textContent = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  node.append(...children.filter((c) => c != null));
  return node;
}
function svg(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
}
const narrow = () => matchMedia("(max-width: 640px)").matches;
const money = (x) => fmtMoney(x);
const cents = (x) => fmtMoney(x, true);
const fmtDate = (iso, opts = { weekday: "short", month: "short", day: "numeric" }) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
const fmtDateY = (iso) => fmtDate(iso, { month: "short", day: "numeric", year: "numeric" });
const tipRow = (a, b) => el("div", { class: "tip-row" }, [el("span", { text: a }), el("b", { text: b })]);
const sign = (x) => (x > 0 ? "good" : x < 0 ? "bad" : "");

function placeTip(tip, box, e) {
  tip.hidden = false;
  const left = e.clientX - box.left, w = tip.offsetWidth;
  let x = left > box.width / 2 ? left - w - 12 : left + 12;
  x = Math.max(0, Math.min(box.width - w, x));
  tip.style.left = `${x}px`;
  tip.style.top = `${Math.max(0, e.clientY - box.top + 14)}px`;
}

// ---------------------------------------------------------------------------
// State

function writeHash() {
  const h = encodeState(st);
  if (location.hash.slice(1) !== h) history.replaceState(null, "", h ? `#${h}` : location.pathname + location.search);
}

function rebuild() {
  if (!base || base.seed !== st.seed) base = { seed: st.seed, ...makeBook(st.seed) };
  ({ book: B, errors } = applyActs(base.book, parseActs(st.acts)));
  SEASON = simulateSeason(B, base.routing, st.seed);
}

function pushAct(a) {
  st = clampState({ ...st, acts: st.acts ? `${st.acts}.${a}` : a });
  rebuild();
  render();
}

function setView(v) {
  st = { ...st, view: v };
  render();
  window.scrollTo({ top: 0 });
}

document.querySelector(".views").addEventListener("click", (e) => {
  const b = e.target.closest("[data-view]");
  if (b) setView(b.dataset.view);
});

function render() {
  for (const t of document.querySelectorAll(".view-tab")) t.setAttribute("aria-selected", String(t.dataset.view === st.view));
  for (const v of ["calendar", "deal", "sheet", "season"]) $(`v-${v}`).hidden = st.view !== v;
  if (st.view === "calendar") drawCalendar();
  if (st.view === "deal") drawDeal();
  if (st.view === "sheet") drawSheet();
  if (st.view === "season") drawSeason();
  writeHash();
}

// ---------------------------------------------------------------------------
// Holds book

function dateState(date) {
  const conf = confirmedOn(B, date);
  const holds = activeHolds(B, date);
  const ch = openChallenge(B, date);
  const rad = holds.some((h) => radiusConflicts(h, base.routing).length);
  return { conf, holds, ch, rad };
}

const rankClass = (r) => (r === 1 ? "k-r1" : r === 2 ? "k-r2" : "k-r3");

function drawCalendar() {
  const m = st.m, first = `${SEASON_YEAR}-${String(m + 1).padStart(2, "0")}-01`;
  $("m-label").textContent = `${new Date(`${first}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })} ${SEASON_YEAR}`;
  $("m-prev").disabled = m === 0;
  $("m-next").disabled = m === 11;
  $("desk").textContent = fmtDateY(B.desk);
  const cells = DOW.map((d) => el("div", { class: "dow", role: "columnheader", text: narrow() ? d[0] : d }));
  for (let i = 0; i < dow(first); i++) cells.push(el("div", { class: "cell blank" }));
  let shows = 0, held = 0;
  for (let d = first; d.slice(5, 7) === first.slice(5, 7); d = addDays(d, 1)) {
    const s = dateState(d);
    if (s.conf) shows++;
    else if (s.holds.length) held++;
    const chips = s.conf
      ? [el("span", { class: "chip k-conf", title: `Confirmed: ${s.conf.artist}` }, [el("b", { text: "C" }), el("span", { class: "chip-name", text: s.conf.artist })])]
      : s.holds.map((h, i) => el("span", { class: `chip ${rankClass(i + 1)}`, title: `${rankLabel(i + 1)} hold: ${h.artist}` }, [el("b", { text: String(i + 1) }), el("span", { class: "chip-name", text: h.artist })]));
    const flags = [s.ch ? el("i", { class: "flag ch", title: `Open challenge, answer by ${s.ch.deadline}` }) : null, s.rad ? el("i", { class: "flag rad", title: "A hold on this date has a radius conflict" }) : null];
    cells.push(el("button", {
      type: "button", class: `cell${d === st.d ? " sel" : ""}${s.conf ? " has-conf" : ""}`, "data-date": d, role: "gridcell",
      "aria-label": `${fmtDate(d)}: ${s.conf ? `confirmed ${s.conf.artist}` : s.holds.length ? `${s.holds.length} holds` : "open"}`,
    }, [el("span", { class: "cell-top" }, [el("span", { class: "dnum", text: String(Number(d.slice(8))) }), el("span", { class: "flags" }, flags)]), el("span", { class: "chips" }, chips)]));
  }
  $("cal").replaceChildren(...cells);
  $("cal-note").textContent = `${shows} confirmed, ${held} more dates on hold this month. Click a date to work its holds.${errors.length ? ` ${errors.length} saved action${errors.length > 1 ? "s" : ""} no longer apply and were skipped.` : ""}`;
  drawDayPanel();
  drawChallenges();
  drawLog();
}

function drawDayPanel() {
  const p = $("day-panel");
  if (!st.d) {
    p.replaceChildren(el("h2", { text: "Pick a date" }), el("p", { class: "hint", text: "Each date shows its holds in priority order. The first hold can confirm. A lower hold can challenge the hold ahead of it; confirming clears every other hold on the date." }), clauseNote());
    return;
  }
  const d = st.d, s = dateState(d);
  const kids = [el("h2", { text: fmtDate(d, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) })];
  if (s.conf) {
    kids.push(el("div", { class: "hold conf" }, [
      el("span", { class: "rank k-conf", text: "Confirmed" }),
      el("div", { class: "hold-body" }, [el("b", { text: s.conf.artist }), el("small", { text: `${TIERS[s.conf.tier].label}, ${s.conf.agent}${s.conf.confirmedOn ? `, confirmed ${fmtDateY(s.conf.confirmedOn)}` : ""}` })]),
    ]));
  } else if (!s.holds.length) {
    kids.push(el("p", { class: "hint", text: "No holds. The room is dark this night." }));
  }
  s.holds.forEach((h, i) => {
    const r = i + 1;
    const conflicts = radiusConflicts(h, base.routing);
    const isChallenger = s.ch && s.ch.by === h.id, isTarget = s.ch && s.ch.against === h.id;
    const btns = [];
    if (r === 1) btns.push(el("button", { type: "button", class: "small", "data-act": `f${h.id}`, title: "Confirm the date. Every other hold releases", disabled: conflicts.length ? true : null }, ["Confirm"]));
    if (r > 1 && !s.ch) btns.push(el("button", { type: "button", class: "small", "data-act": `c${h.id}`, title: `Challenge ${s.holds[i - 1].artist}: they get ${B.challengeDays} days to confirm or release`, disabled: conflicts.length ? true : null }, ["Challenge"]));
    btns.push(el("button", { type: "button", class: "small ghost", "data-act": `r${h.id}`, title: "The agent releases the date" }, ["Release"]));
    kids.push(el("div", { class: `hold${isTarget ? " target" : ""}${isChallenger ? " challenger" : ""}` }, [
      el("span", { class: `rank ${rankClass(r)}`, text: rankLabel(r) }),
      el("div", { class: "hold-body" }, [
        el("b", { text: h.artist }),
        el("small", { text: `${TIERS[h.tier].label}, ${h.agent}, held ${fmtDateY(h.placed)}` }),
        isTarget ? el("small", { class: "warn-text", text: `Challenged. Confirm or release by ${fmtDateY(s.ch.deadline)}.` }) : null,
        isChallenger ? el("small", { class: "warn-text", text: "Challenging, ready to confirm." }) : null,
        ...conflicts.map((c) => el("small", { class: "bad-text", text: c.text })),
        el("span", { class: "hold-btns" }, btns),
      ]),
    ]));
  });
  const play = SEASON.shows.find((x) => x.date === d);
  if (play) {
    kids.push(el("p", { class: "hint" }, [
      `${play.confirmed ? "Forecast settlement" : "If it confirms as forecast"}: ${play.artist}, ${DEAL_TYPES[play.deal.type].label.toLowerCase()}, ${fmtInt(play.result.paid)} paid. `,
      el("a", { href: "#", "data-sheet": d, text: "Open the settlement sheet" }),
    ]));
  }
  const log = B.log.filter((l) => l.date === d).slice(-6);
  if (log.length) kids.push(el("h3", { text: "On this date" }), el("ul", { class: "log" }, log.map((l) => el("li", {}, [el("span", { class: "log-day", text: fmtDate(l.day, { month: "short", day: "numeric" }) }), l.text]))));
  kids.push(clauseNote());
  p.replaceChildren(...kids);
}

function clauseNote() {
  const list = Object.entries(NEARBY).map(([id, v]) => `${v.name} ${milesTo(id)} mi`).join(", ");
  return el("p", { class: "hint", text: `Our radius clause: ${OUR_CLAUSE.miles} miles, ${OUR_CLAUSE.daysBefore} days before and ${OUR_CLAUSE.daysAfter} after. Nearby rooms: ${list}. Each has its own clause. A hold with a conflict cannot confirm or challenge until it is cleared.` });
}

function drawChallenges() {
  const open = B.challenges.filter((c) => c.status === "open").sort((a, b) => (a.deadline < b.deadline ? -1 : 1));
  const byId = (id) => B.holds.find((h) => h.id === id);
  $("ch-rows").replaceChildren(...(open.length ? open.map((c) => el("tr", { "data-goto": c.date }, [
    el("td", { class: "name", text: fmtDate(c.date) }),
    el("td", {}, [byId(c.by).artist, el("small", { text: rankLabel(rankOf(B, c.by)) })]),
    el("td", {}, [byId(c.against).artist, el("small", { text: rankLabel(rankOf(B, c.against)) })]),
    el("td", { class: "num", text: fmtDate(c.deadline, { month: "short", day: "numeric" }) }),
  ])) : [el("tr", {}, [el("td", { colspan: 4, class: "muted", text: "No open challenges." })])]));
}

function drawLog() {
  const log = B.log.slice(-12).reverse();
  $("log").replaceChildren(...log.map((l) => el("li", {}, [el("span", { class: "log-day", text: fmtDate(l.day, { month: "short", day: "numeric" }) }), el("a", { href: "#", "data-goto": l.date, text: fmtDate(l.date, { month: "short", day: "numeric" }) }), `: ${l.text}`])));
}

function gotoDate(d) {
  st = { ...st, view: "calendar", d, m: Number(d.slice(5, 7)) - 1 };
  render();
}

$("cal").addEventListener("click", (e) => {
  const c = e.target.closest("[data-date]");
  if (!c) return;
  st = { ...st, d: st.d === c.dataset.date ? "" : c.dataset.date };
  drawCalendar();
  writeHash();
  if (narrow() && st.d) $("day-panel").scrollIntoView({ block: "start", behavior: "smooth" });
});
$("day-panel").addEventListener("click", (e) => {
  const a = e.target.closest("[data-act]");
  if (a) return pushAct(a.dataset.act);
  const s = e.target.closest("[data-sheet]");
  if (s) {
    e.preventDefault();
    st = { ...st, view: "sheet", src: "show", show: s.dataset.sheet };
    render();
  }
});
for (const id of ["ch-rows", "log"]) {
  $(id).addEventListener("click", (e) => {
    const g = e.target.closest("[data-goto]");
    if (!g) return;
    e.preventDefault();
    gotoDate(g.dataset.goto);
  });
}
$("m-prev").addEventListener("click", () => { st = { ...st, m: Math.max(0, st.m - 1) }; render(); });
$("m-next").addEventListener("click", () => { st = { ...st, m: Math.min(11, st.m + 1) }; render(); });
$("adv1").addEventListener("click", () => pushAct("a1"));
$("adv7").addEventListener("click", () => pushAct("a7"));

// ---------------------------------------------------------------------------
// Deal builder

const F = (name, label, title, step = 1) => ({ name, label, title, step });
const GROUPS = [
  { legend: "Artist and deal", fields: [
    { name: "tier", label: "Artist size", type: "select", options: Object.fromEntries(Object.entries(TIERS).map(([k, t]) => [k, `${t.label}, ${t.sub}`])), title: "Sets the production rider, guest list, marketing budget, hospitality, kills, and walk-up share" },
    { name: "type", label: "Deal type", type: "select", options: Object.fromEntries(Object.entries(DEAL_TYPES).map(([k, d]) => [k, d.label])) },
    F("guarantee", "Guarantee ($)", "Paid whatever the door. Half is due as a deposit before the show", 250),
    F("pct", "Artist percentage (%)", "Door deal: share of NBOR. Versus: share of NBOR after expenses. Plus backend: share over the split point", 1),
    F("ppPct", "Promoter profit (%)", "Plus backend only. Added to the split point as a share of expenses plus guarantee", 1),
  ] },
  { legend: "Ticket prices, all in", fields: [
    F("p0", "Early bird ($)", `First ${VENUE.earlyBirdCap} floor tickets`, 0.5),
    F("p1", "GA advance ($)", "", 0.5),
    F("p2", "GA day of show ($)", "Walk-up at the box office, $1.00 fee instead of $4.25", 0.5),
    F("p3", "Balcony reserved ($)", "", 0.5),
  ] },
  { legend: "Per head", fields: [
    F("merchPH", "Merch spend ($)", "Gross merch per person in the room, 72% soft goods", 0.5),
    F("barPH", "Bar spend ($)", "Venue only. Never on the settlement", 0.5),
  ] },
];

function field(f) {
  if (f.type === "select") return el("label", { title: f.title || null }, [f.label, el("select", { name: f.name }, Object.entries(f.options).map(([v, t]) => el("option", { value: v, text: t })))]);
  return el("label", { title: f.title || null }, [f.label, el("input", { type: "number", name: f.name, step: f.step, min: 0, inputmode: "decimal" })]);
}

function buildDealForm() {
  const form = $("deal-form");
  form.replaceChildren(...GROUPS.map((g) => {
    const sel = g.fields.filter((f) => f.type === "select"), rest = g.fields.filter((f) => f.type !== "select");
    return el("fieldset", {}, [el("legend", { text: g.legend }), ...sel.map(field), el("div", { class: "grid2" }, rest.map(field))]);
  }), el("p", { class: "hint", text: "Changing the artist size loads that size's usual prices and per head spend." }));
  fillDealForm();
}
function fillDealForm() {
  const form = $("deal-form");
  for (const f of form.elements) if (f.name && f.name in st) f.value = st[f.name];
  form.elements.guarantee.disabled = st.type === "door";
  form.elements.pct.disabled = st.type === "flat";
  form.elements.ppPct.disabled = st.type !== "plus";
}

let dealTimer = 0;
$("deal-form").addEventListener("input", (e) => {
  const f = e.target;
  if (!f.name) return;
  let v = f.value;
  if (f.tagName !== "SELECT") {
    v = Number(f.value);
    if (f.value === "" || !Number.isFinite(v) || v < 0) return;
  }
  const next = { ...st, [f.name]: v };
  if (f.name === "tier") {
    const t = TIERS[v];
    Object.assign(next, { p0: t.prices[0], p1: t.prices[1], p2: t.prices[2], p3: t.prices[3], merchPH: t.merchPH, barPH: t.barPH });
  }
  st = clampState(next);
  if (f.tagName === "SELECT") fillDealForm();
  clearTimeout(dealTimer);
  dealTimer = setTimeout(() => { drawDeal(); writeHash(); }, 120);
});

const builder = () => ({ tier: st.tier, type: st.type, guarantee: st.guarantee, pct: st.pct, ppPct: st.ppPct, p0: st.p0, p1: st.p1, p2: st.p2, p3: st.p3, merchPH: st.merchPH, barPH: st.barPH });
let DS = null;

function card(label, value, sub, cls = "", tip = null) {
  return el("div", { class: "card", title: tip }, [el("span", { class: "card-label", text: label }), el("span", { class: `card-total ${cls}`, text: value }), el("span", { class: "card-sub", text: sub })]);
}

function drawDeal() {
  if (!$("deal-form").elements.length) buildDealForm();
  const b = builder();
  DS = builderSummary(b);
  const att = Math.min(st.att, DS.sellable);
  $("att").max = DS.sellable;
  $("att").value = att;
  $("att-label").textContent = `${fmtInt(att)} of ${fmtInt(DS.sellable)} sellable`;
  const now = settle(builderShow(b, att));
  const be = (n) => (n == null ? "Never" : fmtInt(n));
  const beSub = (n) => (n == null ? "not even at a sellout" : `${pct(n / DS.sellable, 0)} of sellable`);
  $("deal-cards").replaceChildren(
    card("Walkout potential", money(DS.walkout), `artist at a sellout of ${fmtInt(DS.sellable)}`, "", "Artist payout if every sellable ticket sells, with expenses at estimate"),
    card("Gross potential", money(DS.grossPotential), `NBOR ${money(DS.nborPotential)}`, "", "Every sellable ticket at its price level, before fees and tax"),
    card("Break-even, as settled", be(DS.breakEvenShow), beSub(DS.breakEvenShow), "", "Paid tickets where NBOR covers show expenses and the artist payout"),
    card("Break-even, venue", be(DS.breakEvenPromoter), `with fees, rebates, merch. ${be(DS.breakEvenVenue)} with the bar`, "", "Adds the facility fees, ticket fee rebates, and merch commission the venue keeps"),
    card(`Artist at ${fmtInt(att)}`, money(now.deal.payout), now.deal.won === "percentage" && b.type !== "door" ? "percentage side wins" : b.type === "door" ? "share of the door" : "guarantee", "", null),
    card(`Promoter at ${fmtInt(att)}`, money(now.promoterNet), `${money(now.venueNet)} with the bar`, sign(now.promoterNet)),
  );
  const t = TIERS[b.tier];
  const split = now.deal.splitPoint;
  let read = `${DEAL_TYPES[b.type].label} for a ${t.label.toLowerCase()} act. At a sellout the artist walks with ${money(DS.walkout)}. `;
  if (b.type === "versus") read += `The percentage passes the guarantee once NBOR clears ${money(split)}, which is ${splitAttendance(b, "versus")}. `;
  if (b.type === "plus") read += `The backend starts at a split point of ${money(split)} in NBOR, ${splitAttendance(b, "plus")}. `;
  read += DS.breakEvenShow == null ? "The settlement never breaks even: the guarantee is more than this room can gross after expenses. "
    : `The settlement breaks even at ${fmtInt(DS.breakEvenShow)} paid; with the fees, rebates, and merch the venue keeps it is ${be(DS.breakEvenPromoter)}, and the bar brings it to ${be(DS.breakEvenVenue)}. `;
  read += `${t.label} acts here draw about ${fmtInt(Math.min(t.draw, DS.sellable))} on a Thursday to Saturday.`;
  $("deal-read").textContent = read;
  $("memo").replaceChildren(...dealMemo({ type: b.type, guarantee: b.guarantee, pct: b.pct / 100, ppPct: b.ppPct / 100 }, b.tier).flatMap(([k, v]) => [el("dt", { text: k }), el("dd", { text: v })]));
  $("deal-note").textContent = `Expenses at deal memo estimates, all documented. Security and insurance scale with the room; card fees and performing rights with the gross. Walk-up share ${pct(t.walk, 0)}. Hover the chart for the numbers at any attendance.`;
  drawDealChart(att);
}

function splitAttendance(b, type) {
  for (const p of DS.curve) {
    const s = settle(builderShow(b, p.n));
    if ((type === "versus" && s.deal.won === "percentage") || (type === "plus" && s.deal.pctSide > 0)) return `about ${fmtInt(p.n)} paid`;
  }
  return "more than the room holds";
}

let dealGeom = null;
function drawDealChart(att) {
  const W = chartWidth($("c-deal")), H = narrow() ? 260 : 300, P = { l: 52, r: 12, t: 12, b: 30 };
  const c = DS.curve, keys = ["payout", "showNet", "promoterNet", "venueNet"];
  let lo = 0, hi = 0;
  for (const p of c) for (const k of keys) { lo = Math.min(lo, p[k]); hi = Math.max(hi, p[k]); }
  const step = niceStep(hi - lo, 5);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const X = (n) => P.l + (n / DS.sellable) * (W - P.l - P.r);
  const Y = (v) => P.t + (1 - (v - lo) / (hi - lo || 1)) * (H - P.t - P.b);
  const nodes = [];
  for (let v = lo; v <= hi + 1e-6; v += step) {
    nodes.push(svg("line", { x1: P.l, x2: W - P.r, y1: Y(v), y2: Y(v), class: v === 0 ? "zero" : "grid" }));
    nodes.push(svg("text", { x: P.l - 6, y: Y(v) + 4, class: "tick", "text-anchor": "end" }, kfmt(v)));
  }
  const xStep = W < 520 ? 400 : 200;
  for (let n = 0; n <= DS.sellable; n += xStep) nodes.push(svg("text", { x: X(n), y: H - 10, class: "tick", "text-anchor": n === 0 ? "start" : "middle" }, fmtInt(n)));
  nodes.push(svg("text", { x: W - P.r, y: H - 10, class: "tick", "text-anchor": "end" }, "Sellout"));
  for (const [k, n] of [["be1", DS.breakEvenShow], ["be2", DS.breakEvenPromoter]]) {
    if (n != null) nodes.push(svg("line", { x1: X(n), x2: X(n), y1: P.t, y2: H - P.b, class: `marker ${k}` }));
  }
  const cls = { payout: "c-artist", showNet: "c-show", promoterNet: "c-prom", venueNet: "c-venue" };
  for (const k of keys) nodes.push(svg("path", { d: c.map((p, i) => `${i ? "L" : "M"}${X(p.n).toFixed(1)},${Y(p[k]).toFixed(1)}`).join(""), class: `line ${cls[k]}` }));
  nodes.push(svg("line", { x1: X(att), x2: X(att), y1: P.t, y2: H - P.b, class: "crosshair now" }));
  nodes.push(svg("line", { x1: 0, x2: 0, y1: P.t, y2: H - P.b, class: "crosshair hover", visibility: "hidden" }));
  const chart = $("c-deal");
  chart.setAttribute("viewBox", `0 0 ${W} ${H}`);
  chart.replaceChildren(...nodes);
  dealGeom = { W, P, X };
}

// Draw at the on-screen width so text stays 11px on any screen.
const chartWidth = (node) => Math.max(300, Math.round(node.parentElement.clientWidth || 720));

function niceStep(span, n) {
  const raw = span / n || 1, mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * mag) return m * mag;
  return 10 * mag;
}
const kfmt = (v) => (Math.abs(v) >= 1000 ? `${v < 0 ? "-" : ""}$${(Math.abs(v) / 1000).toFixed(Math.abs(v) % 1000 ? 1 : 0)}k` : `$${Math.round(v)}`);

{
  const chart = $("c-deal"), tip = chart.nextElementSibling;
  const nAt = (e) => {
    const b = chart.getBoundingClientRect(), { W, P } = dealGeom;
    const sx = ((e.clientX - b.left) / b.width) * W;
    return Math.max(0, Math.min(DS.sellable, Math.round(((sx - P.l) / (W - P.l - P.r)) * DS.sellable)));
  };
  chart.addEventListener("pointermove", (e) => {
    if (!dealGeom) return;
    const n = nAt(e), s = settle(builderShow(builder(), n));
    const h = chart.querySelector(".hover");
    h.setAttribute("x1", dealGeom.X(n));
    h.setAttribute("x2", dealGeom.X(n));
    h.setAttribute("visibility", "visible");
    tip.replaceChildren(
      el("strong", { text: `${fmtInt(n)} paid` }),
      tipRow("Gross", money(s.gross)), tipRow("NBOR", money(s.nbor)), tipRow("Show expenses", money(s.showExpenses)),
      tipRow("Artist payout", money(s.deal.payout)), tipRow("Promoter, as settled", money(s.showNet)),
      tipRow("Plus fees, rebates, merch", money(s.promoterNet)), tipRow("Plus the bar", money(s.venueNet)),
    );
    placeTip(tip, chart.parentElement.getBoundingClientRect(), e);
  });
  chart.addEventListener("pointerleave", () => { tip.hidden = true; chart.querySelector(".hover")?.setAttribute("visibility", "hidden"); });
  chart.addEventListener("click", (e) => { if (dealGeom) { st = { ...st, att: nAt(e) }; drawDeal(); writeHash(); } });
}
$("att").addEventListener("input", (e) => { st = { ...st, att: Number(e.target.value) }; drawDeal(); writeHash(); });
$("to-sheet").addEventListener("click", () => { st = { ...st, view: "sheet", src: "builder" }; render(); window.scrollTo({ top: 0 }); });

// ---------------------------------------------------------------------------
// Settlement sheet

function currentSheet() {
  if (st.src === "builder") {
    const b = builder();
    const show = builderShow(b, st.att);
    return { title: "Projection from the deal builder", date: null, artist: `${TIERS[b.tier].label} act (projection)`, tier: b.tier, show: { ...show, policy: st.policy } };
  }
  const shows = SEASON.shows;
  const s = shows.find((x) => x.date === st.show) ?? shows.find((x) => x.date >= B.desk) ?? shows[0];
  return { title: null, date: s.date, artist: s.artist, tier: s.tier, confirmed: s.confirmed, show: { ...s, policy: st.policy } };
}

function drawSheetSrc() {
  const sel = $("sheet-src");
  const opts = [el("option", { value: "builder", text: `Deal builder projection, ${fmtInt(st.att)} paid` })];
  for (const s of SEASON.shows) opts.push(el("option", { value: s.date, text: `${fmtDate(s.date)}: ${s.artist} (${DEAL_TYPES[s.deal.type].short})` }));
  sel.replaceChildren(...opts);
  const cur = currentSheet();
  sel.value = st.src === "builder" ? "builder" : cur.date;
  $("policy").value = st.policy;
}

$("sheet-src").addEventListener("change", (e) => {
  const v = e.target.value;
  st = v === "builder" ? { ...st, src: "builder" } : { ...st, src: "show", show: v };
  render();
});
$("policy").addEventListener("change", (e) => { st = clampState({ ...st, policy: e.target.value }); render(); });
$("venue-copy").addEventListener("change", () => drawSheet());
$("print").addEventListener("click", () => window.print());

const row = (cells, cls = null) => el("tr", { class: cls }, cells.map((c) => (c instanceof Node ? c : el("td", typeof c === "object" && c ? c : { text: c ?? "" }))));
const td = (text, cls = "", title = null) => ({ text, class: cls || null, title });

function dealLine(deal) {
  const p = (x) => `${Math.round(x * 1000) / 10}%`;
  if (deal.type === "flat") return `${money(deal.guarantee)} flat guarantee`;
  if (deal.type === "door") return `${p(deal.pct)} of net box office`;
  if (deal.type === "versus") return `${money(deal.guarantee)} vs ${p(deal.pct)} of net after expenses`;
  return `${money(deal.guarantee)} plus ${p(deal.pct)} over split, ${p(deal.ppPct ?? 0.15)} promoter profit`;
}

function drawSheet() {
  drawSheetSrc();
  const cur = currentSheet(), show = cur.show, r = settle(show);
  const m = manifest(cur.tier);
  const deal = show.deal;
  const head = el("header", { class: "sheet-head" }, [
    el("div", {}, [el("div", { class: "sheet-venue", text: `${VENUE.name}` }), el("div", { class: "sheet-kind", text: "Show settlement" })]),
    el("dl", { class: "sheet-meta" }, [
      el("dt", { text: "Date" }), el("dd", { text: cur.date ? fmtDate(cur.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "Projection" }),
      el("dt", { text: "Artist" }), el("dd", { text: cur.artist }),
      el("dt", { text: "Deal" }), el("dd", { text: dealLine(deal) }),
      el("dt", { text: "Capacity" }), el("dd", { text: `${fmtInt(VENUE.capacity)} (${VENUE.floor} GA floor, ${VENUE.balcony} balcony)` }),
    ]),
  ]);

  // 1. Tickets
  const tix = el("table", { class: "sheet-table" }, [
    el("thead", {}, [row([td("Price level"), td("Price", "num"), td("Sold", "num"), td("Gross", "num")].map((x) => el("th", x)))]),
    el("tbody", {}, [
      ...r.levels.map((l) => row([l.label, td(cents(l.price), "num"), td(fmtInt(l.sold), "num"), td(cents(l.gross), "num")])),
      ...show.comps.map((c) => row([td(`Comps: ${c.label}`, "muted"), td("$0.00", "num muted"), td(fmtInt(c.n), "num muted"), td("$0.00", "num muted")])),
      ...show.kills.map((k) => row([td(`Kill: ${k.label}`, "muted", "Seats removed from the manifest for production"), td("", "num"), td(fmtInt(k.n), "num muted"), td("", "num")])),
      row([td("Unsold", "muted"), td("", "num"), td(fmtInt(r.unsold), "num muted"), td("", "num")]),
    ]),
    el("tfoot", {}, [row([td("Paid / gross box office"), td(""), td(fmtInt(r.paid), "num"), td(cents(r.gross), "num")], "total")]),
  ]);
  const online = r.levels.filter((l) => l.id !== "dos").reduce((a, l) => a + l.sold, 0), box = r.levels.find((l) => l.id === "dos").sold;

  // 2. Deductions
  const ded = el("table", { class: "sheet-table" }, [el("tbody", {}, [
    row(["Gross box office receipts", td(cents(r.gross), "num")]),
    row([td(`Less facility fee, ${fmtInt(r.paid)} x ${cents(VENUE.facilityFee)}`, "", "Kept by the venue, built into the ticket price"), td(`(${cents(r.facility)})`, "num")]),
    row([td(`Less ticket fees, ${fmtInt(online)} online x ${cents(VENUE.onlineFee)}, ${fmtInt(box)} box office x ${cents(VENUE.boxFee)}`, "", "Ticketing service fees inside the price. The venue gets a rebate on each online ticket"), td(`(${cents(r.ticketFees)})`, "num")]),
    row([td(`Less sales tax, ${pct(VENUE.taxRate, 0)} inside ${cents(r.taxable)}`, "", "Tax is included in what is left after fees: remainder x rate / (1 + rate)"), td(`(${cents(r.tax)})`, "num")]),
    row([td("Net box office receipts (NBOR)"), td(cents(r.nbor), "num")], "total"),
  ])]);

  // 3. Expenses
  const exp = el("table", { class: "sheet-table exp" }, [
    el("thead", {}, [row([td("Show expense"), td("Estimate", "num", "Deal memo estimate"), td("Actual", "num"), td("Charged", "num"), td("Note")].map((x) => el("th", x)))]),
    el("tbody", {}, r.expenses.map((e) => row([
      td(e.label, "", e.tip ?? null),
      td(e.kind === "pct" ? "" : cents(e.budget), "num muted"),
      td(cents(e.actual), "num"),
      td(cents(e.charged), `num${e.charged !== e.actual ? " flagged" : ""}`),
      td(e.note || (e.cap != null ? `Cap ${money(e.cap)}` : ""), `note${e.note ? " flagged" : " muted"}`),
    ]))),
    el("tfoot", {}, [row([td("Total show expenses"), td(""), td(cents(r.actualExpenses), "num"), td(cents(r.showExpenses), "num"), td(r.eaten ? `${cents(r.eaten)} not charged` : "")], "total")]),
  ]);

  // 4. Artist payout
  const d = r.deal;
  const payRows = [];
  if (deal.type === "flat") payRows.push(row(["Guarantee", td(cents(d.guaranteeSide), "num")]));
  if (deal.type === "door") payRows.push(row([`NBOR x ${pct(deal.pct, 0)}`, td(cents(d.pctSide), "num")]));
  if (deal.type === "versus") {
    payRows.push(
      row(["NBOR less show expenses", td(cents(r.nbor - r.showExpenses), "num")]),
      row([`Percentage side, ${pct(deal.pct, 0)} of net after expenses`, td(cents(d.pctSide), `num${d.won === "percentage" ? " win" : ""}`)]),
      row(["Guarantee side", td(cents(d.guaranteeSide), `num${d.won === "guarantee" ? " win" : ""}`)]),
      row([td("Split point: NBOR where the percentage passes the guarantee", "muted"), td(cents(d.splitPoint), "num muted")]),
    );
  }
  if (deal.type === "plus") {
    payRows.push(
      row(["Show expenses", td(cents(r.showExpenses), "num")]),
      row(["Guarantee", td(cents(deal.guarantee), "num")]),
      row([`Promoter profit, ${pct(deal.ppPct ?? 0.15, 0)} of expenses and guarantee`, td(cents(d.promoterProfit), "num")]),
      row([td("Split point"), td(cents(d.splitPoint), "num")], "sub"),
      row([`Backend, ${pct(deal.pct, 0)} of ${cents(Math.max(0, r.nbor - d.splitPoint))} over split`, td(cents(d.pctSide), `num${d.pctSide > 0 ? " win" : ""}`)]),
    );
  }
  payRows.push(row([td(`Artist payout${deal.type === "versus" ? `, ${d.won} wins` : ""}`), td(cents(d.payout), "num")], "total"));
  const pay = el("table", { class: "sheet-table" }, [el("tbody", {}, payRows)]);

  // 5. Merch
  const mm = r.merch;
  const merch = el("table", { class: "sheet-table merch" }, [
    el("thead", {}, [row([td("Merch, artist sells"), td("Gross", "num"), td("Tax", "num"), td("Net", "num"), td("Venue", "num")].map((x) => el("th", x)))]),
    el("tbody", {}, [
      row([`Soft goods (apparel), venue ${pct(mm.softPct, 0)}`, td(cents(mm.softGross), "num"), td(cents(mm.softTax), "num"), td(cents(mm.softNet), "num"), td(cents(mm.venueSoft), "num")]),
      row([`Hard goods (vinyl, CDs, posters), venue ${pct(mm.hardPct, 0)}`, td(cents(mm.hardGross), "num"), td(cents(mm.hardTax), "num"), td(cents(mm.hardNet), "num"), td(cents(mm.venueHard), "num")]),
    ]),
    el("tfoot", {}, [row([td("Total"), td(cents(mm.gross), "num"), td(cents(mm.tax), "num"), td(cents(mm.softNet + mm.hardNet), "num"), td(cents(mm.venue), "num")], "total"),
      row([td("Artist keeps, net less venue commission"), td(""), td(""), td(""), td(cents(mm.artist), "num")], "sub")]),
  ]);

  // 6. Settlement
  const bal = el("table", { class: "sheet-table" }, [el("tbody", {}, [
    row(["Artist payout", td(cents(d.payout), "num")]),
    row([td(`Less deposit paid${deal.type === "door" ? "" : `, ${pct(VENUE.depositShare, 0)} of guarantee`}`), td(`(${cents(r.deposit)})`, "num")]),
    row([td("Less merch sales tax (artist collected, venue remits)"), td(`(${cents(mm.tax)})`, "num")]),
    row([td("Less venue merch commission"), td(`(${cents(mm.venue)})`, "num")]),
    row([td(r.balance >= 0 ? "Balance due to artist tonight" : "Balance due from artist tonight"), td(cents(Math.abs(r.balance)), "num")], "grand"),
  ])]);

  const sides = el("div", { class: "sides" }, [
    el("div", { class: "side" }, [el("h4", { text: "Artist side" }), el("dl", {}, [
      el("dt", { text: "Payout" }), el("dd", { text: cents(d.payout) }),
      el("dt", { text: "Merch kept, after tax and commission" }), el("dd", { text: cents(mm.artist) }),
      el("dt", { class: "tot", text: "Artist total for the night" }), el("dd", { class: "tot", text: cents(r.artistTotal) }),
    ])]),
    el("div", { class: "side" }, [el("h4", { text: "Promoter side" }), el("dl", {}, [
      el("dt", { text: "NBOR" }), el("dd", { text: cents(r.nbor) }),
      el("dt", { text: "Less show expenses charged" }), el("dd", { text: `(${cents(r.showExpenses)})` }),
      el("dt", { text: "Less artist payout" }), el("dd", { text: `(${cents(d.payout)})` }),
      el("dt", { class: "tot", text: "Show result as settled" }), el("dd", { class: `tot ${sign(r.showNet)}`, text: cents(r.showNet) }),
    ])]),
  ]);

  const signoff = el("div", { class: "signoff" }, [
    ...["For Larkspur Hall, promoter representative", "For the artist, tour manager"].map((who) => el("div", { class: "sig" }, [
      el("div", { class: "sig-line" }), el("div", { class: "sig-label", text: who }),
      el("div", { class: "sig-sub" }, [el("span", { text: "Printed name" }), el("span", { text: "Date" })]),
    ])),
  ]);

  const venue = el("section", { class: "venue-copy", hidden: !$("venue-copy").checked }, [
    el("h3", { text: "Venue copy only: P&L for the night" }),
    el("p", { class: "sheet-hint", text: "Not shown to the artist. What the venue keeps outside the settlement." }),
    el("table", { class: "sheet-table" }, [el("tbody", {}, [
      row(["Show result as settled", td(cents(r.showNet), "num")]),
      row([td("Less expense overages not charged (caps, no backup)", "", "Actual minus charged, on everything but the house nut"), td(r.eaten ? `(${cents(r.eaten)})` : cents(0), "num")]),
      row([td("House nut charged less actual house cost", "", "The house nut is a flat charge; this is what the night really cost the room"), td(cents(r.houseCharged - r.houseCost), "num")]),
      row(["Facility fees kept", td(cents(r.facility), "num")]),
      row([td("Ticket fee rebates and box office fees", "", `${cents(VENUE.onlineRebate)} back on each online ticket, the full ${cents(VENUE.boxFee)} at the box office`), td(cents(r.rebates), "num")]),
      row(["Merch commission", td(cents(mm.venue), "num")]),
      row([td("Promoter net"), td(cents(r.promoterNet), `num ${sign(r.promoterNet)}`)], "total"),
      row([td(`Bar net, ${fmtInt(show.drop)} in the room`, "", "Bar gross less cost of goods and bar labor"), td(cents(r.barNet), "num")]),
      row([td("Venue net for the night"), td(cents(r.venueNet), `num ${sign(r.venueNet)}`)], "grand"),
    ])]),
  ]);

  const sec = (n, title, body, extra = null) => el("section", { class: "sheet-sec" }, [el("h3", { text: `${n}. ${title}` }), body, extra]);
  $("sheet").replaceChildren(
    head,
    sec(1, "Ticket sales", tix, el("p", { class: "sheet-hint", text: `Capacity check: ${fmtInt(r.paid)} paid + ${fmtInt(r.comps)} comps + ${fmtInt(r.kills)} kills + ${fmtInt(r.unsold)} unsold = ${fmtInt(VENUE.capacity)}. Sellable after kills and comps: ${fmtInt(m.sellable)}.` })),
    sec(2, "Box office deductions", ded),
    sec(3, "Show expenses", exp, el("p", { class: "sheet-hint", text: `Undocumented items: ${st.policy === "budget" ? "held to the deal memo estimate" : st.policy === "strike" ? "struck" : "allowed in full"}. Caps per the deal memo.` })),
    sec(4, "Artist payout", pay),
    sec(5, "Merchandise", merch),
    sec(6, "Settlement", bal, sides),
    signoff,
    venue,
  );
}

// ---------------------------------------------------------------------------
// Season

function drawSeason() {
  const { report, shows } = SEASON, T = report.totals;
  const sellable = shows.reduce((a, s) => a + manifest(s.tier).sellable, 0);
  $("season-cards").replaceChildren(
    card("Shows", fmtInt(T.shows), `${shows.filter((s) => s.confirmed).length} confirmed, the rest forecast from holds`),
    card("Paid attendance", fmtInt(T.paid), `${pct(T.paid / sellable, 0)} of sellable`),
    card("Paid to artists", money(T.payout), `${pct(T.payout / T.nbor, 0)} of NBOR`),
    card("Promoter net", money(T.promoterNet), `${T.losing} of ${T.shows} nights lost money`, sign(T.promoterNet)),
    card("Bar net", money(T.barNet), `${money(T.barNet / T.shows)} a night`),
    card("Venue net", money(T.venueNet), "shows, fees, merch, and the bar", sign(T.venueNet)),
  );
  const ty = Object.fromEntries(report.types.map((t) => [t.type, t]));
  const g = report.types.filter((t) => t.type !== "door");
  const gLose = g.reduce((a, t) => a + t.losing, 0), gShows = g.reduce((a, t) => a + t.shows, 0), gLost = g.reduce((a, t) => a + t.lost, 0);
  const worstType = [...g].sort((a, b) => a.lost / Math.max(1, a.shows) - b.lost / Math.max(1, b.shows))[0];
  $("season-read").textContent = `Seed ${st.seed}, ${T.shows} shows. On the shows alone the venue ${T.promoterNet >= 0 ? "makes" : "loses"} ${money(Math.abs(T.promoterNet))}; the bar adds ${money(T.barNet)} for ${money(T.venueNet)}. `
    + `${gLose} of ${gShows} shows with a guarantee lost money, ${money(-gLost)} in all. ${worstType.label} carried the most risk per show (${worstType.losing} of ${worstType.shows} lost, worst night ${money(worstType.worst)}). `
    + `Door deals never risk a guarantee but the venue carries every expense: ${ty.door.losing} of ${ty.door.shows} lost on the show and ${ty.door.shows - ty.door.losingVenue} came out ahead once the bar is counted.`;
  drawMonths();
  $("type-rows").replaceChildren(...report.types.map((t) => el("tr", {}, [
    el("td", { class: "name", text: t.label }),
    el("td", { class: "num", text: fmtInt(t.shows) }),
    el("td", { class: "num", text: t.sellable ? pct(t.paid / t.sellable, 0) : "" }),
    el("td", { class: `num ${sign(t.promoterNet)}`, text: money(t.promoterNet) }),
    el("td", { class: "num" }, [`${t.losing} of ${t.shows}`, el("small", { text: t.lost ? money(t.lost) : "" })]),
    el("td", { class: "num", text: t.shows ? money(t.worst) : "" }),
    el("td", { class: "num", text: t.type === "flat" ? "n/a" : t.type === "door" ? "always" : `${t.pctWon}` }),
    el("td", { class: `num ${sign(t.venueNet)}`, text: money(t.venueNet) }),
  ])));
  $("type-note").textContent = "Promoter net includes the facility fees, ticket fee rebates, merch commission, and the house nut, less the overages the venue ate. Losing shows count nights below zero on that basis, before the bar.";
  $("tier-rows").replaceChildren(...report.tiers.map((t) => el("tr", {}, [
    el("td", { class: "name", text: t.label }), el("td", { class: "num", text: fmtInt(t.shows) }), el("td", { class: "num", text: `${t.losing}` }),
    el("td", { class: `num ${sign(t.promoterNet)}`, text: money(t.promoterNet) }), el("td", { class: `num ${sign(t.venueNet)}`, text: money(t.venueNet) }),
  ])));
  $("show-rows").replaceChildren(...shows.map((s) => el("tr", { "data-show": s.date }, [
    el("td", { class: "name" }, [fmtDate(s.date), el("small", { text: s.confirmed ? "confirmed" : "forecast" })]),
    el("td", {}, [s.artist, el("small", { text: TIERS[s.tier].label })]),
    el("td", {}, [DEAL_TYPES[s.deal.type].short, el("small", { text: s.deal.type === "door" ? pct(s.deal.pct, 0) : money(s.deal.guarantee) })]),
    el("td", { class: "num", text: fmtInt(s.result.paid) }),
    el("td", { class: "num", text: money(s.result.nbor) }),
    el("td", { class: "num", text: money(s.result.deal.payout) }),
    el("td", { class: `num ${sign(s.result.promoterNet)}`, text: money(s.result.promoterNet) }),
    el("td", { class: `num ${sign(s.result.venueNet)}`, text: money(s.result.venueNet) }),
  ])));
}
$("show-rows").addEventListener("click", (e) => {
  const r = e.target.closest("[data-show]");
  if (r) { st = { ...st, view: "sheet", src: "show", show: r.dataset.show }; render(); window.scrollTo({ top: 0 }); }
});

let monthGeom = null;
function drawMonths() {
  const ms = SEASON.report.months;
  const W = chartWidth($("c-months")), H = narrow() ? 240 : 280, P = { l: 52, r: 8, t: 12, b: 28 };
  let lo = 0, hi = 0;
  for (const m of ms) { lo = Math.min(lo, m.promoterNet, m.venueNet); hi = Math.max(hi, m.promoterNet, m.venueNet); }
  const step = niceStep(hi - lo, 5);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const Y = (v) => P.t + (1 - (v - lo) / (hi - lo || 1)) * (H - P.t - P.b);
  const bw = (W - P.l - P.r) / 12, inner = bw * 0.36;
  const nodes = [];
  for (let v = lo; v <= hi + 1e-6; v += step) {
    nodes.push(svg("line", { x1: P.l, x2: W - P.r, y1: Y(v), y2: Y(v), class: v === 0 ? "zero" : "grid" }));
    nodes.push(svg("text", { x: P.l - 6, y: Y(v) + 4, class: "tick", "text-anchor": "end" }, kfmt(v)));
  }
  ms.forEach((m, i) => {
    const x0 = P.l + i * bw + bw / 2;
    for (const [k, dx, cls] of [["promoterNet", -inner - 1, "c-prom"], ["venueNet", 1, "c-venue"]]) {
      const v = m[k], y = Y(Math.max(0, v)), h = Math.max(1, Math.abs(Y(v) - Y(0)));
      nodes.push(svg("rect", { x: x0 + dx, y, width: inner, height: h, class: `bar ${cls}${v < 0 ? " neg" : ""}`, rx: 2 }));
    }
    nodes.push(svg("text", { x: x0, y: H - 9, class: "tick", "text-anchor": "middle" }, W < 520 ? m.label[0] : m.label));
    nodes.push(svg("rect", { x: P.l + i * bw, y: P.t, width: bw, height: H - P.t - P.b, class: "hit", "data-m": i }));
  });
  const chart = $("c-months");
  chart.setAttribute("viewBox", `0 0 ${W} ${H}`);
  chart.replaceChildren(...nodes);
  monthGeom = { W };
  const best = [...ms].sort((a, b) => b.venueNet - a.venueNet)[0], worst = [...ms].sort((a, b) => a.promoterNet - b.promoterNet)[0];
  $("months-note").textContent = `Best month with the bar: ${best.label} (${money(best.venueNet)}, ${best.shows} shows). Worst on the shows alone: ${worst.label} (${money(worst.promoterNet)}). Hover a month for its numbers.`;
}
{
  const chart = $("c-months"), tip = chart.nextElementSibling;
  chart.addEventListener("pointermove", (e) => {
    const h = e.target.closest("[data-m]");
    if (!h) { tip.hidden = true; return; }
    const m = SEASON.report.months[Number(h.dataset.m)];
    tip.replaceChildren(
      el("strong", { text: `${MONTHS[m.month]} ${SEASON_YEAR}, ${m.shows} shows` }),
      tipRow("Paid", fmtInt(m.paid)), tipRow("Gross", money(m.gross)), tipRow("NBOR", money(m.nbor)), tipRow("Artists", money(m.payout)),
      tipRow("Show result as settled", money(m.showNet)), tipRow("Promoter net", money(m.promoterNet)), tipRow("Bar net", money(m.barNet)), tipRow("Venue net", money(m.venueNet)),
    );
    placeTip(tip, chart.parentElement.getBoundingClientRect(), e);
  });
  chart.addEventListener("pointerleave", () => { tip.hidden = true; });
}

// ---------------------------------------------------------------------------

$("reset").addEventListener("click", () => {
  st = clampState({ view: st.view });
  rebuild();
  $("deal-form").replaceChildren();
  render();
});
$("share").addEventListener("click", async () => {
  const btn = $("share");
  try {
    await navigator.clipboard.writeText(location.href);
    btn.textContent = "Link copied";
  } catch {
    btn.textContent = "Copy failed";
  }
  setTimeout(() => (btn.textContent = "Copy share link"), 1500);
});
window.addEventListener("hashchange", () => {
  if (location.hash.slice(1) === encodeState(st)) return;
  st = decodeState(location.hash);
  rebuild();
  $("deal-form").replaceChildren();
  render();
});
let resizeTimer = 0, lastW = window.innerWidth;
window.addEventListener("resize", () => {
  if (window.innerWidth === lastW) return;
  lastW = window.innerWidth;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 150);
});
window.addEventListener("beforeprint", () => { if (st.view !== "sheet") setView("sheet"); });

rebuild();
render();
