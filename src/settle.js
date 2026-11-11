// Show Settle engine. No DOM code.
//
// A made-up 1,200 capacity independent room, Larkspur Hall, and its booking desk: the holds book
// with ranked holds, challenges, and confirmations; radius clauses against nearby rooms; the deal
// for each show; the settlement sheet the promoter and the tour manager sign at the end of the
// night; and a seeded season of about 120 shows with the venue's P&L by month and deal type.
//
// Money is in dollars, rounded to cents at every line so the sheet adds up the way a printed one does.

// ---------------------------------------------------------------------------
// Randomness

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gauss(rand) {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

const pick = (rand, xs) => xs[Math.floor(rand() * xs.length)];
function pickWeighted(rand, weights) {
  const entries = Object.entries(weights);
  let u = rand() * entries.reduce((a, [, w]) => a + w, 0);
  for (const [k, w] of entries) {
    u -= w;
    if (u <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

export const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

// ---------------------------------------------------------------------------
// Dates as ISO strings, UTC math so time zones never move a show.

const DAY = 86400000;
const toMs = (iso) => Date.parse(`${iso}T00:00:00Z`);
export const addDays = (iso, n) => new Date(toMs(iso) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((toMs(b) - toMs(a)) / DAY); // b minus a
export const dow = (iso) => new Date(toMs(iso)).getUTCDay(); // 0 Sunday
export const monthOf = (iso) => Number(iso.slice(5, 7)) - 1;
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const shortDate = (iso) => `${MONTHS[monthOf(iso)]} ${Number(iso.slice(8))}`;

// ---------------------------------------------------------------------------
// The room and its neighbors. Coordinates in miles from the hall.

export const VENUE = {
  name: "Larkspur Hall",
  capacity: 1200,
  floor: 950, // general admission floor
  balcony: 250, // reserved balcony seats
  earlyBirdCap: 150, // first 150 floor tickets at the early bird price
  facilityFee: 2.0, // per paid ticket, kept by the venue, inside the ticket price
  onlineFee: 4.25, // ticketing service fee per online ticket, inside the ticket price
  onlineRebate: 1.25, // share of the online fee the ticketing company pays back to the venue
  boxFee: 1.0, // box office handling fee on day of show sales, kept by the venue
  taxRate: 0.07, // admissions and merch sales tax, included in the price
  depositShare: 0.5, // deposit paid against a guarantee before the show
};

// Our standard radius clause: the artist may not play within 50 miles from 60 days before our
// show to 30 days after, without our written approval.
export const OUR_CLAUSE = { miles: 50, daysBefore: 60, daysAfter: 30 };

export const NEARBY = {
  wren: { name: "The Wren", cap: 350, x: 2, y: -1, clause: { miles: 25, daysBefore: 30, daysAfter: 14 } },
  copper: { name: "Copperline Theatre", cap: 2400, x: 9, y: 4, clause: { miles: 50, daysBefore: 60, daysAfter: 30 } },
  harbor: { name: "Harbor Pavilion", cap: 7500, x: 31, y: 18, clause: { miles: 100, daysBefore: 90, daysAfter: 45 } },
  millrace: { name: "Millrace Ballroom", cap: 900, x: 58, y: -20, clause: { miles: 40, daysBefore: 45, daysAfter: 21 } },
  eastgate: { name: "Eastgate Arena", cap: 12000, x: 88, y: 10, clause: { miles: 75, daysBefore: 60, daysAfter: 30 } },
};
export const milesTo = (id) => Math.round(Math.hypot(NEARBY[id].x, NEARBY[id].y) * 10) / 10;

// ---------------------------------------------------------------------------
// Artist sizes. Prices are all in (fees and tax inside): early bird, advance, day of show, balcony.

export const TIERS = {
  local: {
    label: "Local", sub: "draws 150 to 350", draw: 240, sd: 0.32, prices: [15, 18, 22, 25], walk: 0.45, guests: 10,
    marketing: 600, hosp: 250, crewIn: 0, houseNut: 1500, houseCost: 2000, soundUp: 0, lightsUp: 0, merchPH: 5, barPH: 18, cameraKill: false, barricade: false,
    deals: { door: 0.75, versus: 0.25 }, doorPct: 0.6,
  },
  developing: {
    label: "Developing", sub: "draws 350 to 700", draw: 520, sd: 0.3, prices: [22, 25, 30, 35], walk: 0.3, guests: 20,
    marketing: 1500, hosp: 500, crewIn: 2, houseNut: 2500, houseCost: 2600, soundUp: 0, lightsUp: 400, merchPH: 8, barPH: 16, cameraKill: false, barricade: false,
    deals: { door: 0.3, versus: 0.6, flat: 0.1 }, doorPct: 0.75,
  },
  mid: {
    label: "Mid level", sub: "draws 700 to 1,100", draw: 880, sd: 0.28, prices: [30, 35, 40, 50], walk: 0.2, guests: 30,
    marketing: 3000, hosp: 900, crewIn: 6, houseNut: 3500, houseCost: 3200, soundUp: 1200, lightsUp: 800, merchPH: 11, barPH: 15, cameraKill: true, barricade: false,
    deals: { versus: 0.5, plus: 0.35, flat: 0.15 }, doorPct: 0.8,
  },
  established: {
    label: "Established", sub: "sells out most rooms this size", draw: 1250, sd: 0.26, prices: [42, 48, 55, 69], walk: 0.1, guests: 40,
    marketing: 5000, hosp: 1800, crewIn: 8, houseNut: 3500, houseCost: 3400, soundUp: 2400, lightsUp: 1800, merchPH: 15, barPH: 14, cameraKill: true, barricade: true,
    deals: { plus: 0.5, flat: 0.35, versus: 0.15 }, doorPct: 0.85,
  },
};

export const DEAL_TYPES = {
  flat: { label: "Flat guarantee", short: "Flat" },
  door: { label: "Door deal", short: "Door" },
  versus: { label: "Guarantee vs percentage", short: "Versus" },
  plus: { label: "Guarantee plus backend", short: "Plus backend" },
};

const BAL_SHARE = 0.22; // share of advance buyers who want a balcony seat

// Made-up artists and agencies.
const ARTISTS = {
  local: ["Glass Coyote", "The Drywall Saints", "Pennywhistle Riot", "Lake Effect Choir", "Static Orchard", "Hollis & the Low Tide",
    "June Varga", "Bad Lantern", "The Tin Parade", "Moth Radio", "Saltgrass", "Cassidy Wren Trio"],
  developing: ["Marlow Vance", "The Quiet Arcades", "Neon Heron", "Copper & Clay", "Dune Atlas", "The Velvet Orchards",
    "Fern Halloway", "Signal Hill Kids", "Ivory Kestrel", "The Spare Rooms", "Low Noon", "Ada Pell"],
  mid: ["Harbor Lights Collective", "The Midnight Ferns", "Kite Theory", "Odessa Rue", "The Long Weekends", "Pale Meridian",
    "Juniper Static", "Wolf & Wren", "The Paper Moons", "Cobalt Days"],
  established: ["The Ashgrove Band", "Silver Tidal", "Rosa Delmar", "The Northern Lanterns", "Golden Hour Club", "Mercer Lane"],
};
const AGENTS = ["Northline Artists", "Tall Pine Agency", "Blue Hour Talent", "Fieldwork Booking", "Common Ground Agency"];

export function artistPool() {
  const out = [];
  for (const [tier, names] of Object.entries(ARTISTS)) names.forEach((name, i) => out.push({ name, tier, agent: AGENTS[(name.length + i) % AGENTS.length] }));
  return out;
}

// ---------------------------------------------------------------------------
// Radius clauses. `routing` is the artist's other announced or held dates in the market.
// Ours: the artist may not play within OUR_CLAUSE.miles from daysBefore our show to daysAfter.
// Theirs: the other room's own clause may block our date in the same way.

export function radiusConflicts(hold, routing, clause = OUR_CLAUSE) {
  const out = [];
  for (const r of routing) {
    if (r.artist !== hold.artist) continue;
    const v = NEARBY[r.venue], miles = milesTo(r.venue);
    const dd = daysBetween(hold.date, r.date); // their date minus ours
    if (miles <= clause.miles && dd >= -clause.daysBefore && dd <= clause.daysAfter) {
      out.push({ kind: "ours", venue: r.venue, venueName: v.name, date: r.date, miles, days: dd,
        text: `${hold.artist} plays ${v.name} (${miles} mi) on ${shortDate(r.date)}, ${Math.abs(dd)} days ${dd < 0 ? "before" : "after"} our date. Our clause is ${clause.miles} mi, ${clause.daysBefore} days before and ${clause.daysAfter} after.` });
    }
    const c = v.clause;
    if (miles <= c.miles && -dd >= -c.daysBefore && -dd <= c.daysAfter) {
      out.push({ kind: "theirs", venue: r.venue, venueName: v.name, date: r.date, miles, days: dd,
        text: `${v.name}'s clause (${c.miles} mi, ${c.daysBefore} days before, ${c.daysAfter} after) covers our date: their show is ${shortDate(r.date)}.` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The holds book.
//
// Holds on a date rank in the order they were placed: first hold, second hold, and so on. Only the
// first hold can confirm. A lower hold that is ready to confirm can challenge: the hold ahead of it
// gets `challengeDays` to confirm or release. If it releases, or lets the deadline pass, the holds
// move up. When the challenger reaches first, it confirms. If another hold is still ahead of it, that
// hold gets its own window. A confirmation releases every other hold on the date.

export const RANKS = ["1st", "2nd", "3rd", "4th", "5th", "6th"];
export const rankLabel = (n) => RANKS[n - 1] ?? `${n}th`;

const cloneBook = (b) => ({ ...b, holds: b.holds.map((h) => ({ ...h })), challenges: b.challenges.map((c) => ({ ...c })), log: [...b.log] });

export function emptyBook(desk = "2026-11-10", challengeDays = 3) {
  return { desk, challengeDays, nextId: 1, holds: [], challenges: [], log: [] };
}

export const activeHolds = (book, date) => book.holds.filter((h) => h.date === date && h.status === "hold").sort((a, b) => a.seq - b.seq);
export const confirmedOn = (book, date) => book.holds.find((h) => h.date === date && h.status === "confirmed") ?? null;
export const openChallenge = (book, date) => book.challenges.find((c) => c.date === date && c.status === "open") ?? null;
export function rankOf(book, id) {
  const h = book.holds.find((x) => x.id === id);
  if (!h || h.status !== "hold") return null;
  return activeHolds(book, h.date).findIndex((x) => x.id === id) + 1;
}

function fail(msg) {
  const e = new Error(msg);
  e.booking = true;
  throw e;
}

export function placeHold(book, { date, artist, tier = "developing", agent = "", placed = book.desk }) {
  if (confirmedOn(book, date)) fail(`${date} is already confirmed`);
  if (activeHolds(book, date).some((h) => h.artist === artist)) fail(`${artist} already holds ${date}`);
  const b = cloneBook(book);
  const id = b.nextId++;
  b.holds.push({ id, seq: id, date, artist, tier, agent, placed, status: "hold" });
  b.log.push({ day: placed, date, text: `${artist} placed a ${rankLabel(activeHolds(b, date).length)} hold` });
  return b;
}

function doConfirm(b, h, day, why) {
  h.status = "confirmed";
  h.confirmedOn = day;
  b.log.push({ day, date: h.date, text: `${h.artist} confirmed${why ? `, ${why}` : ""}` });
  for (const o of b.holds) {
    if (o.date === h.date && o.status === "hold") {
      o.status = "released";
      o.releasedOn = day;
      o.reason = `cleared by ${h.artist} confirming`;
    }
  }
  for (const c of b.challenges) {
    if (c.date === h.date && c.status === "open") {
      c.status = c.by === h.id ? "won" : "lost";
      c.closed = day;
    }
  }
}

// After a release on a date with an open challenge: the challenger confirms if it is now first,
// otherwise the challenge moves to whoever is now ahead of it, with a fresh window.
function cascade(b, date, day) {
  const c = b.challenges.find((x) => x.date === date && x.status === "open");
  if (!c) return;
  const holds = activeHolds(b, date);
  const by = holds.find((h) => h.id === c.by);
  if (!by) {
    c.status = "void";
    c.closed = day;
    return;
  }
  const rank = holds.indexOf(by) + 1;
  if (rank === 1) {
    doConfirm(b, by, day, "challenge won");
    return;
  }
  const target = holds[rank - 2];
  if (target.id !== c.against) {
    c.against = target.id;
    c.deadline = addDays(day, b.challengeDays);
    b.log.push({ day, date, text: `challenge moves to ${target.artist} (${rankLabel(rank - 1)}), answer by ${shortDate(c.deadline)}` });
  }
}

export function challenge(book, id) {
  const b = cloneBook(book);
  const h = b.holds.find((x) => x.id === id);
  if (!h || h.status !== "hold") fail("only an active hold can challenge");
  const holds = activeHolds(b, h.date), rank = holds.indexOf(h) + 1;
  if (rank === 1) fail("the first hold confirms, it does not challenge");
  if (openChallenge(b, h.date)) fail(`${h.date} already has an open challenge`);
  const target = holds[rank - 2];
  const c = { id: b.challenges.length + 1, date: h.date, by: h.id, against: target.id, issued: b.desk, deadline: addDays(b.desk, b.challengeDays), status: "open" };
  b.challenges.push(c);
  b.log.push({ day: b.desk, date: h.date, text: `${h.artist} (${rankLabel(rank)}) challenged ${target.artist} (${rankLabel(rank - 1)}), answer by ${shortDate(c.deadline)}` });
  return b;
}

export function confirm(book, id) {
  const b = cloneBook(book);
  const h = b.holds.find((x) => x.id === id);
  if (!h || h.status !== "hold") fail("only an active hold can confirm");
  if (activeHolds(b, h.date)[0].id !== h.id) fail(`${h.artist} is not the first hold, it has to challenge`);
  doConfirm(b, h, b.desk, openChallenge(b, h.date) ? "answering the challenge" : "");
  return b;
}

export function release(book, id, reason = "released by the agent") {
  const b = cloneBook(book);
  const h = b.holds.find((x) => x.id === id);
  if (!h || h.status !== "hold") fail("only an active hold can release");
  h.status = "released";
  h.releasedOn = b.desk;
  h.reason = reason;
  b.log.push({ day: b.desk, date: h.date, text: `${h.artist} released` });
  cascade(b, h.date, b.desk);
  return b;
}

// Move the desk date forward. A challenged hold that has not answered by the end of its deadline
// day is released, and the challenge cascades.
export function advance(book, days = 1) {
  let b = cloneBook(book);
  b.desk = addDays(b.desk, days);
  for (let guard = 0; guard < 100; guard++) {
    const late = b.challenges.filter((c) => c.status === "open" && c.deadline < b.desk).sort((x, y) => (x.deadline < y.deadline ? -1 : 1))[0];
    if (!late) break;
    const h = b.holds.find((x) => x.id === late.against);
    const day = addDays(late.deadline, 1);
    h.status = "released";
    h.releasedOn = day;
    h.reason = "did not answer the challenge";
    b.log.push({ day, date: h.date, text: `${h.artist} did not answer the challenge and was released` });
    cascade(b, h.date, day);
  }
  return b;
}

// Actions are stored in the URL as a short list: c12 challenge hold 12, f12 confirm, r12 release, a3 advance 3 days.
export function parseActs(s) {
  return String(s ?? "").split(/[,.]/).map((t) => t.trim()).filter((t) => /^[cfra]\d+$/.test(t)).map((t) => ({ op: t[0], n: Number(t.slice(1)) }));
}

export function applyActs(book, acts) {
  let b = book;
  const errors = [];
  for (const a of acts) {
    try {
      if (a.op === "c") b = challenge(b, a.n);
      else if (a.op === "f") b = confirm(b, a.n);
      else if (a.op === "r") b = release(b, a.n);
      else if (a.op === "a") b = advance(b, Math.min(a.n, 400));
    } catch (e) {
      if (!e.booking) throw e;
      errors.push(`${a.op}${a.n}: ${e.message}`);
    }
  }
  return { book: b, errors };
}

// ---------------------------------------------------------------------------
// A generated book for the 2027 season, as of the desk date. Holds land mostly on Thursday to
// Saturday. Early months are mostly confirmed, later months mostly still on hold.

export const SEASON_YEAR = 2027;
const DOW_HOLD_P = [0.28, 0.08, 0.24, 0.36, 0.62, 0.8, 0.8];
const CONFIRMED_BY_MONTH = [0.85, 0.75, 0.6, 0.5, 0.35, 0.25, 0.2, 0.15, 0.1, 0.08, 0.05, 0.05];

export function makeBook(seed = 7) {
  const rand = mulberry32(seed * 7919 + 13);
  const pool = artistPool();
  const tierW = { local: 0.28, developing: 0.34, mid: 0.26, established: 0.12 };
  const routing = [];
  // Other dates in the market for about half the artists: one or two shows at nearby rooms.
  for (const a of pool) {
    if (rand() < 0.45) {
      const n = 1 + (rand() < 0.3 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        routing.push({ artist: a.name, venue: pick(rand, Object.keys(NEARBY)), date: addDays(`${SEASON_YEAR}-01-01`, Math.floor(rand() * 365)) });
      }
    }
  }
  let book = emptyBook("2026-11-10", 3);
  const held = new Map(); // artist -> dates held
  for (let d = 0; d < 365; d++) {
    const date = addDays(`${SEASON_YEAR}-01-01`, d);
    if (rand() >= DOW_HOLD_P[dow(date)]) continue;
    const n = 1 + (rand() < 0.6 ? 1 : 0) + (rand() < 0.3 ? 1 : 0) + (rand() < 0.1 ? 1 : 0);
    for (let k = 0, tries = 0; k < n && tries < 30; tries++) {
      const tier = pickWeighted(rand, tierW);
      const a = pick(rand, pool.filter((x) => x.tier === tier));
      if ((held.get(a.name) ?? []).some((x) => Math.abs(daysBetween(x, date)) < 45)) continue;
      if (activeHolds(book, date).some((h) => h.artist === a.name)) continue;
      const placed = addDays(book.desk, -Math.floor(5 + rand() * 120));
      book = placeHold(book, { date, artist: a.name, tier: a.tier, agent: a.agent, placed });
      held.set(a.name, [...(held.get(a.name) ?? []), date]);
      k++;
    }
    // Some dates are already confirmed: the first hold that is clear of radius conflicts.
    if (rand() < CONFIRMED_BY_MONTH[monthOf(date)]) {
      const holds = activeHolds(book, date);
      const ok = holds.findIndex((h) => radiusConflicts(h, routing).length === 0 && rand() < 0.8);
      if (ok >= 0) {
        const desk = book.desk, latest = holds.map((h) => h.placed).sort().pop();
        const when = addDays(desk, -Math.floor(rand() * 25));
        book = { ...book, desk: when < latest ? latest : when };
        for (let i = 0; i < ok; i++) book = release(book, holds[i].id, "passed on the date");
        book = confirm(book, holds[ok].id);
        book = { ...book, desk };
      }
    }
  }
  // A few open challenges on later dates, issued in the last two days.
  const later = [...new Set(book.holds.filter((h) => h.status === "hold").map((h) => h.date))].filter((d) => activeHolds(book, d).length >= 2);
  for (let i = 0; i < 4 && later.length; i++) {
    const date = later.splice(Math.floor(rand() * later.length), 1)[0];
    const h = activeHolds(book, date)[1];
    const desk = book.desk;
    book = { ...book, desk: addDays(desk, -Math.floor(rand() * 3)) };
    book = challenge(book, h.id);
    book = { ...book, desk };
  }
  book.log = book.log.filter((l) => l.day >= addDays(book.desk, -30)).sort((x, y) => (x.day < y.day ? -1 : x.day > y.day ? 1 : 0));
  return { book, routing };
}

// ---------------------------------------------------------------------------
// Deals.
//
//   flat:   the artist gets the guarantee.
//   door:   the artist gets pct of net box office (NBOR). No guarantee; the venue carries expenses.
//   versus: the artist gets the guarantee or pct of NBOR after show expenses, whichever is greater.
//   plus:   the artist gets the guarantee, plus pct of NBOR over the split point. The split point is
//           expenses + guarantee + promoter profit, and promoter profit is ppPct of (expenses + guarantee).

export function artistPayout(deal, nbor, expenses) {
  const G = deal.guarantee ?? 0, p = deal.pct ?? 0;
  if (deal.type === "flat") return { payout: r2(G), guaranteeSide: r2(G), pctSide: 0, splitPoint: null, won: "guarantee" };
  if (deal.type === "door") return { payout: r2(p * nbor), guaranteeSide: 0, pctSide: r2(p * nbor), splitPoint: 0, won: "percentage" };
  if (deal.type === "versus") {
    const pctSide = r2(p * Math.max(0, nbor - expenses));
    const won = pctSide > G ? "percentage" : "guarantee";
    return { payout: Math.max(r2(G), pctSide), guaranteeSide: r2(G), pctSide, splitPoint: p > 0 ? r2(expenses + G / p) : null, won };
  }
  if (deal.type === "plus") {
    const promoterProfit = r2((deal.ppPct ?? 0.15) * (expenses + G));
    const splitPoint = r2(expenses + G + promoterProfit);
    const backend = r2(p * Math.max(0, nbor - splitPoint));
    return { payout: r2(G + backend), guaranteeSide: r2(G), pctSide: backend, splitPoint, promoterProfit, won: backend > 0 ? "percentage" : "guarantee" };
  }
  throw new Error(`unknown deal type ${deal.type}`);
}

export function dealMemo(deal, tierKey) {
  const t = TIERS[tierKey], pc = (x) => `${Math.round(x * 1000) / 10}%`, $ = (x) => fmtMoney(x);
  const terms = deal.type === "flat" ? `${$(deal.guarantee)} flat guarantee`
    : deal.type === "door" ? `${pc(deal.pct)} of net box office receipts, no guarantee`
      : deal.type === "versus" ? `${$(deal.guarantee)} guarantee versus ${pc(deal.pct)} of net box office after documented show expenses, whichever is greater`
        : `${$(deal.guarantee)} guarantee plus ${pc(deal.pct)} of net box office over the split point (show expenses, guarantee, and ${pc(deal.ppPct ?? 0.15)} promoter profit)`;
  return [
    ["Terms", terms],
    ["Deposit", deal.type === "door" ? "None" : `${pc(VENUE.depositShare)} of the guarantee, due 30 days before the show`],
    ["Ticket prices", `$${t.prices[0]} early bird (first ${VENUE.earlyBirdCap}), $${t.prices[1]} advance, $${t.prices[2]} day of show, $${t.prices[3]} balcony. All in: fees and tax inside.`],
    ["Per ticket deductions", `$${VENUE.facilityFee.toFixed(2)} facility fee, $${VENUE.onlineFee.toFixed(2)} online ticket fee or $${VENUE.boxFee.toFixed(2)} box office fee, then ${pc(VENUE.taxRate)} sales tax`],
    ["Show expenses", `House nut ${$(t.houseNut)} flat. Marketing capped at ${$(t.marketing)}. Hospitality buyout ${$(t.hosp)}. Production rental at cost, capped at quote. Undocumented items at the deal memo estimate.`],
    ["Merch", "Artist sells. Venue takes 20% of soft goods and 10% of hard goods, after sales tax."],
    ["Comps", `${t.guests} artist guest list, venue and promo comps at the promoter's discretion. Comps carry no revenue.`],
    ["Radius", `${OUR_CLAUSE.miles} miles, ${OUR_CLAUSE.daysBefore} days before and ${OUR_CLAUSE.daysAfter} days after, without written approval.`],
  ];
}

// ---------------------------------------------------------------------------
// Inventory: kills come off the manifest for production, comps hold seats without revenue, and paid
// demand fills the early bird, then advance, then day of show at the box office.

export function manifest(tierKey) {
  const t = TIERS[tierKey];
  const kills = [{ label: "FOH mix riser", area: "floor", n: 24 }];
  if (t.cameraKill) kills.push({ label: "Camera and spot position", area: "balcony", n: 10 });
  if (t.barricade) kills.push({ label: "Barricade and pit", area: "floor", n: 20 });
  const venueComps = Math.round(t.guests * 0.6);
  const comps = [{ label: "Artist guest list", area: "floor", n: t.guests }, { label: "Venue and promo comps", area: "balcony", n: venueComps }];
  const areaSum = (xs, area) => sum(xs.filter((x) => x.area === area).map((x) => x.n));
  const floorSell = VENUE.floor - areaSum(kills, "floor") - areaSum(comps, "floor");
  const balSell = VENUE.balcony - areaSum(kills, "balcony") - areaSum(comps, "balcony");
  return { kills, comps, floorSell, balSell, sellable: floorSell + balSell };
}

export function allocate(adv, walk, m) {
  let floor = m.floorSell, bal = m.balSell;
  const early = Math.min(adv, VENUE.earlyBirdCap, floor);
  floor -= early;
  let a = adv - early;
  let balSold = Math.min(Math.round(a * BAL_SHARE), bal);
  bal -= balSold;
  a -= balSold;
  const advSold = Math.min(a, floor);
  floor -= advSold;
  a -= advSold;
  const spill = Math.min(a, bal);
  balSold += spill;
  bal -= spill;
  a -= spill;
  const dos = Math.min(walk, floor);
  floor -= dos;
  let w = walk - dos;
  const balWalk = Math.min(w, bal);
  w -= balWalk;
  return { early, adv: advSold, dos, bal: balSold + balWalk, turnedAway: a + w };
}

export function levelsFor(prices, alloc) {
  return [
    { id: "early", label: "GA floor, early bird", price: prices[0], fee: VENUE.onlineFee, rebate: VENUE.onlineRebate, sold: alloc.early },
    { id: "adv", label: "GA floor, advance", price: prices[1], fee: VENUE.onlineFee, rebate: VENUE.onlineRebate, sold: alloc.adv },
    { id: "dos", label: "GA floor, day of show", price: prices[2], fee: VENUE.boxFee, rebate: VENUE.boxFee, sold: alloc.dos },
    { id: "bal", label: "Balcony reserved", price: prices[3], fee: VENUE.onlineFee, rebate: VENUE.onlineRebate, sold: alloc.bal },
  ];
}

// Show expense lines. kind "flat" lines carry an actual; kind "pct" lines are a rate of gross or NBOR
// and settle() computes them. charge "house" marks the house nut.
export function expenseBudget(tierKey, drop, { rider = {} } = {}) {
  const t = TIERS[tierKey];
  const guards = Math.max(4, Math.ceil(drop / 75));
  const hands = t.crewIn + (rider.extraHands ?? 0);
  const soundUp = rider.soundUp ?? t.soundUp, lightsUp = rider.lightsUp ?? t.lightsUp, hosp = rider.hosp ?? t.hosp;
  const lines = [
    { key: "sound", label: "Sound: house engineer and system", budget: 650, kind: "flat", tip: "House FOH engineer, monitor tech, and the house PA" },
    { key: "lights", label: "Lights: house LD and rig", budget: 450, kind: "flat" },
    { key: "security", label: `Security: ${guards} guards x 6 hrs`, budget: guards * 6 * 28, kind: "flat", tip: "One guard per 75 in the room, at least four, $28 an hour" },
    { key: "hands", label: `Stagehands: ${hands} x 8 hrs`, budget: hands * 8 * 32, kind: "flat", tip: "Load in and load out, $32 an hour, 8 hour minimum call" },
    { key: "box", label: "Box office and ticket takers", budget: 420, kind: "flat" },
    { key: "hosp", label: "Hospitality: rider buyout", budget: hosp, cap: hosp, kind: "flat", tip: "Catering and dressing room per the hospitality rider, capped at the buyout" },
    { key: "marketing", label: "Marketing and advertising", budget: t.marketing, cap: t.marketing, kind: "flat", tip: "Social, print, and radio. Capped at the deal memo; the venue eats any overage" },
    { key: "insurance", label: "Event insurance", budget: r2(drop * 0.4), kind: "flat", tip: "$0.40 a head" },
    { key: "cc", label: "Credit card processing, 2.9% of gross", rate: 0.029, base: "gross", kind: "pct" },
    { key: "pro", label: "ASCAP, BMI, SESAC, 1.5% of NBOR", rate: 0.015, base: "nbor", kind: "pct", tip: "Performing rights licenses, charged as a share of net box office" },
    { key: "house", label: "House nut", budget: t.houseNut, kind: "flat", charge: "house", tip: "Flat charge for the room: house staff, utilities, rent, cleaning. Negotiated, no receipts" },
  ];
  if (hands === 0) lines.splice(lines.findIndex((l) => l.key === "hands"), 1);
  if (soundUp > 0) lines.splice(1, 0, { key: "soundUp", label: "Production rider: PA and console rental", budget: soundUp, cap: soundUp, kind: "flat", tip: "Rented to meet the production rider, at cost, capped at the quote" });
  if (lightsUp > 0) lines.splice(lines.findIndex((l) => l.key === "lights") + 1, 0, { key: "lightsUp", label: "Production rider: lighting rental", budget: lightsUp, cap: lightsUp, kind: "flat" });
  if (t.barricade) lines.splice(lines.findIndex((l) => l.key === "security") + 1, 0, { key: "barricade", label: "Barricade rental", budget: 600, kind: "flat" });
  for (const l of lines) if (l.kind === "flat") { l.actual = l.budget; l.documented = true; }
  return lines;
}

// ---------------------------------------------------------------------------
// Settlement. Order of operations, top to bottom of the sheet:
//   gross = price x sold by level (prices are all in)
//   less facility fees (per paid ticket), less ticket fees (per ticket, by channel)
//   less sales tax, which is inside what is left: tax = remainder x rate / (1 + rate)
//   = net box office receipts (NBOR)
//   less show expenses as charged (documented actuals, capped; undocumented per policy)
//   artist payout under the deal; the rest is the promoter's show result as settled
// Then merch, the deposit, and the balance due to the artist that night. The venue's own P&L adds
// back what it keeps outside the settlement: facility fees, ticket fee rebates, merch commission,
// the difference between the house nut and the real house cost, and the bar.

export function settle(show) {
  const policy = show.policy ?? "budget";
  const levels = show.levels.map((l) => ({ ...l, gross: r2(l.sold * l.price), facility: r2(l.sold * VENUE.facilityFee), ticketFee: r2(l.sold * l.fee), rebate: r2(l.sold * l.rebate) }));
  const paid = sum(levels.map((l) => l.sold));
  const gross = r2(sum(levels.map((l) => l.gross)));
  const facility = r2(sum(levels.map((l) => l.facility)));
  const ticketFees = r2(sum(levels.map((l) => l.ticketFee)));
  const taxable = r2(gross - facility - ticketFees);
  const tax = r2((taxable * VENUE.taxRate) / (1 + VENUE.taxRate));
  const nbor = r2(taxable - tax);

  const expenses = show.expenses.map((l) => {
    const actual = l.kind === "pct" ? r2(l.rate * (l.base === "nbor" ? nbor : gross)) : r2(l.actual);
    const documented = l.kind === "pct" || l.charge === "house" ? true : l.documented !== false;
    let allowed = actual, note = "";
    if (!documented) {
      allowed = policy === "strike" ? 0 : policy === "allow" ? actual : Math.min(actual, l.budget);
      note = policy === "strike" ? "No backup, struck" : policy === "allow" ? "No backup, allowed" : "No backup, held to estimate";
    }
    let charged = allowed;
    if (l.cap != null && charged > l.cap) {
      charged = l.cap;
      note = note ? `${note}, capped` : "Capped";
    }
    charged = r2(charged);
    return { ...l, actual, documented, charged, note, eaten: r2(actual - charged) };
  });
  const showExpenses = r2(sum(expenses.map((e) => e.charged)));
  const actualExpenses = r2(sum(expenses.map((e) => e.actual)));
  const deal = artistPayout(show.deal, nbor, showExpenses);
  const showNet = r2(nbor - showExpenses - deal.payout);

  const m = show.merch ?? { soft: 0, hard: 0 };
  const mTax = (g) => r2((g * VENUE.taxRate) / (1 + VENUE.taxRate));
  const merch = {
    softGross: r2(m.soft), hardGross: r2(m.hard), softTax: mTax(m.soft), hardTax: mTax(m.hard),
    softPct: show.merchPct?.soft ?? 0.2, hardPct: show.merchPct?.hard ?? 0.1,
  };
  merch.softNet = r2(merch.softGross - merch.softTax);
  merch.hardNet = r2(merch.hardGross - merch.hardTax);
  merch.venueSoft = r2(merch.softNet * merch.softPct);
  merch.venueHard = r2(merch.hardNet * merch.hardPct);
  merch.venue = r2(merch.venueSoft + merch.venueHard);
  merch.tax = r2(merch.softTax + merch.hardTax);
  merch.gross = r2(merch.softGross + merch.hardGross);
  merch.artist = r2(merch.softNet + merch.hardNet - merch.venue);

  const deposit = r2(show.deal.type === "door" ? 0 : (show.deal.guarantee ?? 0) * VENUE.depositShare);
  // The artist sold merch for cash, so the venue nets the merch tax (it remits it) and its commission.
  const balance = r2(deal.payout - deposit - merch.tax - merch.venue);

  const rebates = r2(sum(levels.map((l) => l.rebate)));
  const house = expenses.find((e) => e.charge === "house");
  const houseCharged = house ? house.charged : 0;
  const houseCost = show.houseCost ?? (show.tier ? TIERS[show.tier].houseCost : 0);
  const eaten = r2(sum(expenses.filter((e) => e.charge !== "house").map((e) => e.eaten)));
  const promoterNet = r2(showNet - eaten + houseCharged - houseCost + facility + rebates + merch.venue);
  const bar = show.bar ?? { gross: 0, cost: 0 };
  const barNet = r2(bar.gross - bar.cost);
  const venueNet = r2(promoterNet + barNet);

  const comps = sum((show.comps ?? []).map((c) => c.n));
  const kills = sum((show.kills ?? []).map((k) => k.n));
  return {
    levels, paid, comps, kills, unsold: VENUE.capacity - paid - comps - kills, gross, facility, ticketFees, taxable, tax, nbor,
    expenses, showExpenses, actualExpenses, eaten, deal, showNet, merch, deposit, balance, rebates, houseCharged, houseCost,
    promoterNet, barNet, bar, venueNet, artistTotal: r2(deal.payout + merch.artist),
  };
}

// ---------------------------------------------------------------------------
// Deal builder: project a show at a given paid attendance, all expenses at estimate and documented.

export const BUILDER_DEFAULTS = { tier: "mid", type: "versus", guarantee: 6000, pct: 85, ppPct: 15, p0: 30, p1: 35, p2: 40, p3: 50, merchPH: 11, barPH: 15 };

export function builderShow(b, paid) {
  const t = TIERS[b.tier], m = manifest(b.tier);
  paid = Math.max(0, Math.min(m.sellable, Math.round(paid)));
  const walk = Math.round(paid * t.walk);
  const alloc = allocate(paid - walk, walk, m);
  const drop = Math.round(paid * 0.96 + (m.sellable ? sum(m.comps.map((c) => c.n)) * 0.8 : 0));
  const soft = r2(drop * b.merchPH * 0.72), hard = r2(drop * b.merchPH * 0.28);
  return {
    deal: { type: b.type, guarantee: b.type === "door" ? 0 : b.guarantee, pct: b.pct / 100, ppPct: b.ppPct / 100 },
    levels: levelsFor([b.p0, b.p1, b.p2, b.p3], alloc), comps: m.comps, kills: m.kills,
    expenses: expenseBudget(b.tier, drop), merch: { soft, hard }, bar: barFor(drop, b.barPH), drop, tier: b.tier,
  };
}

export function barFor(drop, perHead) {
  const gross = r2(drop * perHead);
  const bartenders = Math.max(3, Math.ceil(drop / 120));
  return { gross, cost: r2(gross * 0.26 + bartenders * 7 * 22), bartenders };
}

export function breakEven(b, measure = "promoterNet") {
  const m = manifest(b.tier);
  for (let n = 0; n <= m.sellable; n++) if (settle(builderShow(b, n))[measure] >= 0) return n;
  return null;
}

export function builderSummary(b) {
  const m = manifest(b.tier);
  const full = settle(builderShow(b, m.sellable));
  const curve = [];
  const step = Math.max(1, Math.round(m.sellable / 60));
  for (let n = 0; n <= m.sellable; n += step) curve.push({ n, ...pickCurve(settle(builderShow(b, n))) });
  if (curve[curve.length - 1].n !== m.sellable) curve.push({ n: m.sellable, ...pickCurve(full) });
  return {
    sellable: m.sellable, walkout: full.deal.payout, grossPotential: full.gross, nborPotential: full.nbor, full,
    breakEvenShow: breakEven(b, "showNet"), breakEvenPromoter: breakEven(b, "promoterNet"), breakEvenVenue: breakEven(b, "venueNet"), curve,
  };
}
const pickCurve = (s) => ({ payout: s.deal.payout, showNet: s.showNet, promoterNet: s.promoterNet, venueNet: s.venueNet });

// ---------------------------------------------------------------------------
// Season simulation.

const DOW_DEMAND = [0.8, 0.7, 0.75, 0.85, 1.0, 1.12, 1.12];
const MONTH_DEMAND = [0.85, 0.88, 1.02, 1.05, 1.05, 0.95, 0.9, 0.92, 1.05, 1.08, 1.04, 0.9];

const round250 = (x) => Math.max(250, Math.round(x / 250) * 250);

// The offer the talent buyer would make, from an expected draw and estimated expenses.
export function makeOffer(tierKey, type, rand) {
  const t = TIERS[tierKey], m = manifest(tierKey);
  const expPaid = Math.min(m.sellable, t.draw);
  const walk = Math.round(expPaid * t.walk);
  const est = settle({
    deal: { type: "flat", guarantee: 0 }, levels: levelsFor(t.prices, allocate(expPaid - walk, walk, m)), expenses: expenseBudget(tierKey, expPaid), tier: tierKey,
  });
  const net = Math.max(0, est.nbor - est.showExpenses);
  if (type === "door") return { type, guarantee: 0, pct: t.doorPct };
  if (type === "flat") return { type, guarantee: round250(net * (0.7 + 0.3 * rand())) };
  if (type === "versus") return { type, guarantee: round250(net * (0.35 + 0.3 * rand())), pct: 0.85 };
  return { type, guarantee: round250(net * (0.68 + 0.27 * rand())), pct: 0.85, ppPct: 0.15 };
}

export function simulateShow(date, artist, tierKey, seed) {
  const rand = mulberry32(seed);
  const t = TIERS[tierKey], m = manifest(tierKey);
  const type = pickWeighted(rand, t.deals);
  const deal = makeOffer(tierKey, type, rand);
  const demand = Math.max(20, Math.round(t.draw * DOW_DEMAND[dow(date)] * MONTH_DEMAND[monthOf(date)] * Math.exp(t.sd * gauss(rand) - (t.sd * t.sd) / 2)));
  const walkShare = Math.min(0.8, Math.max(0.02, t.walk * (1 + 0.3 * gauss(rand))));
  const walk = Math.round(demand * walkShare);
  const alloc = allocate(demand - walk, walk, m);
  const levels = levelsFor(t.prices, alloc);
  const paid = sum(levels.map((l) => l.sold));
  const comps = sum(m.comps.map((c) => c.n));
  const drop = Math.round(paid * (0.93 + 0.05 * rand()) + comps * 0.8);
  const expenses = expenseBudget(tierKey, drop);
  for (const l of expenses) {
    if (l.kind !== "flat" || l.charge === "house") continue;
    if (l.key === "marketing") l.actual = r2(l.budget * (0.85 + 0.4 * rand()));
    else if (l.key === "hosp") l.actual = r2(l.budget * (0.9 + 0.3 * rand()));
    else if (l.key === "hands") l.actual = r2(l.budget * (rand() < 0.3 ? 1.125 : 1)); // load out ran an hour long
    else l.actual = r2(l.budget * (1 + 0.08 * gauss(rand)));
    l.documented = rand() > 0.07;
  }
  const merchPH = t.merchPH * Math.exp(0.25 * gauss(rand));
  const softShare = 0.65 + 0.15 * rand();
  const show = {
    date, artist, tier: tierKey, deal, levels, comps: m.comps, kills: m.kills, expenses, drop, demand, turnedAway: alloc.turnedAway,
    merch: { soft: r2(drop * merchPH * softShare), hard: r2(drop * merchPH * (1 - softShare)) },
    bar: barFor(drop, t.barPH * Math.exp(0.15 * gauss(rand))), houseCost: r2(t.houseCost * (1 + 0.06 * gauss(rand))), policy: "budget",
  };
  return { ...show, result: settle(show) };
}

// Resolve the book into the season: confirmed dates play; open dates go down the holds in order,
// each confirming with probability `confirmP` unless a radius clause blocks it.
export function resolveSeason(book, routing, seed = 7, confirmP = 0.55) {
  const rand = mulberry32(seed * 104729 + 3);
  const dates = [...new Set(book.holds.map((h) => h.date))].sort();
  const out = [];
  for (const date of dates) {
    const c = confirmedOn(book, date);
    if (c) {
      out.push({ date, artist: c.artist, tier: c.tier, confirmed: true });
      continue;
    }
    for (const h of activeHolds(book, date)) {
      const u = rand();
      if (radiusConflicts(h, routing).length) continue;
      if (u < confirmP) {
        out.push({ date, artist: h.artist, tier: h.tier, confirmed: false });
        break;
      }
    }
  }
  return out;
}

export function simulateSeason(book, routing, seed = 7) {
  const plays = resolveSeason(book, routing, seed);
  const shows = plays.map((p, i) => ({ ...simulateShow(p.date, p.artist, p.tier, seed * 1000003 + i * 7919 + daysBetween("2027-01-01", p.date)), confirmed: p.confirmed }));
  return { shows, report: seasonReport(shows) };
}

export function seasonReport(shows) {
  const months = MONTHS.map((label, i) => ({ month: i, label, shows: 0, paid: 0, gross: 0, nbor: 0, payout: 0, showNet: 0, promoterNet: 0, barNet: 0, venueNet: 0 }));
  const types = Object.keys(DEAL_TYPES).map((type) => ({ type, label: DEAL_TYPES[type].label, shows: 0, paid: 0, sellable: 0, gross: 0, payout: 0, guarantees: 0, promoterNet: 0, venueNet: 0, losing: 0, lost: 0, losingVenue: 0, worst: 0, pctWon: 0, sellouts: 0 }));
  const tiers = Object.keys(TIERS).map((tier) => ({ tier, label: TIERS[tier].label, shows: 0, promoterNet: 0, venueNet: 0, losing: 0 }));
  for (const s of shows) {
    const r = s.result, mo = months[monthOf(s.date)], ty = types.find((x) => x.type === s.deal.type), ti = tiers.find((x) => x.tier === s.tier);
    mo.shows++;
    mo.paid += r.paid;
    for (const k of ["gross", "nbor", "showNet", "promoterNet", "barNet", "venueNet"]) mo[k] = r2(mo[k] + r[k]);
    mo.payout = r2(mo.payout + r.deal.payout);
    ty.shows++;
    ty.paid += r.paid;
    ty.sellable += manifest(s.tier).sellable;
    ty.gross = r2(ty.gross + r.gross);
    ty.payout = r2(ty.payout + r.deal.payout);
    ty.guarantees = r2(ty.guarantees + (s.deal.guarantee ?? 0));
    ty.promoterNet = r2(ty.promoterNet + r.promoterNet);
    ty.venueNet = r2(ty.venueNet + r.venueNet);
    if (r.promoterNet < 0) { ty.losing++; ty.lost = r2(ty.lost + r.promoterNet); }
    if (r.venueNet < 0) ty.losingVenue++;
    ty.worst = Math.min(ty.worst, r.promoterNet);
    if (r.deal.won === "percentage" && s.deal.type !== "door") ty.pctWon++;
    if (r.paid >= manifest(s.tier).sellable) ty.sellouts++;
    ti.shows++;
    ti.promoterNet = r2(ti.promoterNet + r.promoterNet);
    ti.venueNet = r2(ti.venueNet + r.venueNet);
    if (r.promoterNet < 0) ti.losing++;
  }
  const tot = (k) => r2(sum(shows.map((s) => (k === "payout" ? s.result.deal.payout : s.result[k]))));
  return {
    months, types, tiers,
    totals: {
      shows: shows.length, paid: sum(shows.map((s) => s.result.paid)), gross: tot("gross"), nbor: tot("nbor"), payout: tot("payout"),
      showNet: tot("showNet"), promoterNet: tot("promoterNet"), barNet: tot("barNet"), venueNet: tot("venueNet"),
      losing: shows.filter((s) => s.result.promoterNet < 0).length,
    },
  };
}

// ---------------------------------------------------------------------------
// Formatting and URL state.

export function fmtMoney(x, cents = false) {
  const neg = x < 0, v = Math.abs(x);
  const s = cents ? v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.round(v).toLocaleString("en-US");
  return `${neg ? "-" : ""}$${s}`;
}
export const fmtInt = (x) => Math.round(x).toLocaleString("en-US");
export const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;

export const STATE_DEFAULTS = { view: "calendar", m: 0, d: "", seed: 7, acts: "", show: "", src: "show", policy: "budget", ...BUILDER_DEFAULTS, att: 800 };
const NUM_KEYS = ["m", "seed", "guarantee", "pct", "ppPct", "p0", "p1", "p2", "p3", "merchPH", "barPH", "att"];

export function clampState(s) {
  const o = { ...STATE_DEFAULTS, ...s };
  for (const k of NUM_KEYS) {
    const v = Number(o[k]);
    o[k] = Number.isFinite(v) ? v : STATE_DEFAULTS[k];
  }
  if (!["calendar", "deal", "sheet", "season"].includes(o.view)) o.view = "calendar";
  if (!TIERS[o.tier]) o.tier = STATE_DEFAULTS.tier;
  if (!DEAL_TYPES[o.type]) o.type = STATE_DEFAULTS.type;
  if (!["budget", "strike", "allow"].includes(o.policy)) o.policy = "budget";
  if (!["show", "builder"].includes(o.src)) o.src = "show";
  o.m = Math.max(0, Math.min(11, Math.round(o.m)));
  o.seed = Math.max(1, Math.min(99999, Math.round(o.seed)));
  o.pct = Math.max(0, Math.min(100, o.pct));
  o.ppPct = Math.max(0, Math.min(50, o.ppPct));
  o.guarantee = Math.max(0, Math.min(200000, o.guarantee));
  for (const k of ["p0", "p1", "p2", "p3", "merchPH", "barPH"]) o[k] = Math.max(0, Math.min(500, o[k]));
  o.att = Math.max(0, Math.min(VENUE.capacity, Math.round(o.att)));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.d)) o.d = "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.show)) o.show = "";
  o.acts = parseActs(o.acts).map((a) => `${a.op}${a.n}`).join(".");
  return o;
}

export function encodeState(s) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(s)) if (k in STATE_DEFAULTS && v !== STATE_DEFAULTS[k] && v !== "") p.set(k, String(v));
  return p.toString();
}

export function decodeState(hash) {
  const p = new URLSearchParams(String(hash ?? "").replace(/^#/, ""));
  const o = {};
  for (const k of Object.keys(STATE_DEFAULTS)) if (p.has(k)) o[k] = p.get(k);
  return clampState(o);
}
