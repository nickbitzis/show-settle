import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BUILDER_DEFAULTS, OUR_CLAUSE, TIERS, VENUE, activeHolds, addDays, advance, allocate, applyActs, artistPayout, breakEven, builderShow,
  builderSummary, challenge, confirm, confirmedOn, daysBetween, decodeState, emptyBook, encodeState, expenseBudget, makeBook, manifest,
  milesTo, mulberry32, openChallenge, parseActs, placeHold, radiusConflicts, rankOf, release, resolveSeason, settle, simulateSeason,
} from "../src/settle.js";

const close = (a, b, tol = 0.005) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

// A three hold date: A placed first, then B, then C.
function threeHolds() {
  let b = emptyBook("2026-11-10", 3);
  for (const artist of ["A", "B", "C"]) b = placeHold(b, { date: "2027-03-12", artist });
  const [A, B, C] = activeHolds(b, "2027-03-12");
  return { b, A: A.id, B: B.id, C: C.id };
}

// A one level show for hand-worked settlement math.
const level = (price, sold, fee = VENUE.onlineFee, rebate = VENUE.onlineRebate) => ({ id: "x", label: "x", price, sold, fee, rebate });
const flatLine = (key, actual, extra = {}) => ({ key, label: key, budget: actual, actual, kind: "flat", documented: true, ...extra });

// --- Holds, challenges, confirmations ----------------------------------------------

test("holds rank in the order they were placed", () => {
  const { b, A, B, C } = threeHolds();
  assert.deepEqual([rankOf(b, A), rankOf(b, B), rankOf(b, C)], [1, 2, 3]);
  assert.deepEqual(activeHolds(b, "2027-03-12").map((h) => h.artist), ["A", "B", "C"]);
});

test("the same artist cannot hold a date twice, and a confirmed date takes no holds", () => {
  let { b, A } = threeHolds();
  assert.throws(() => placeHold(b, { date: "2027-03-12", artist: "A" }));
  b = confirm(b, A);
  assert.throws(() => placeHold(b, { date: "2027-03-12", artist: "D" }), /confirmed/);
});

test("only the first hold can confirm; lower holds must challenge", () => {
  const { b, B } = threeHolds();
  assert.throws(() => confirm(b, B), /not the first hold/);
});

test("confirming clears every other hold on the date", () => {
  const { b, A, B, C } = threeHolds();
  const after = confirm(b, A);
  assert.equal(confirmedOn(after, "2027-03-12").artist, "A");
  assert.equal(activeHolds(after, "2027-03-12").length, 0);
  for (const id of [B, C]) {
    const h = after.holds.find((x) => x.id === id);
    assert.equal(h.status, "released");
    assert.match(h.reason, /cleared by A/);
  }
  assert.equal(b.holds.find((x) => x.id === A).status, "hold", "the original book is not mutated");
});

test("a first hold cannot challenge, and a date takes one open challenge at a time", () => {
  const { b, A, B, C } = threeHolds();
  assert.throws(() => challenge(b, A), /first hold/);
  const c = challenge(b, B);
  assert.throws(() => challenge(c, C), /already has an open challenge/);
});

test("a challenge gives the hold ahead N days, inclusive of the deadline day", () => {
  const { b, A, B } = threeHolds();
  let c = challenge(b, B);
  const ch = openChallenge(c, "2027-03-12");
  assert.equal(ch.against, A);
  assert.equal(ch.deadline, "2026-11-13");
  c = advance(c, 3); // desk is now the deadline day: still time to answer
  assert.equal(rankOf(c, A), 1);
  assert.equal(openChallenge(c, "2027-03-12").status, "open");
  c = advance(c, 1); // the deadline passed with no answer
  assert.equal(c.holds.find((h) => h.id === A).reason, "did not answer the challenge");
  assert.equal(confirmedOn(c, "2027-03-12").artist, "B", "the challenger moves up and confirms");
  assert.equal(c.challenges[0].status, "won");
});

test("the first hold can answer a challenge by confirming, and the challenger loses", () => {
  const { b, A, B } = threeHolds();
  const c = confirm(challenge(b, B), A);
  assert.equal(confirmedOn(c, "2027-03-12").id, A);
  assert.equal(c.challenges[0].status, "lost");
  assert.equal(c.holds.find((h) => h.id === B).status, "released");
});

test("a third hold's challenge cascades: when the first releases, the second gets its own window", () => {
  const { b, A, B, C } = threeHolds();
  let c = challenge(b, C);
  assert.equal(openChallenge(c, "2027-03-12").against, B, "a challenge goes to the hold directly ahead");
  c = advance(c, 1);
  c = release(c, B);
  // C is now 2nd behind A, and the challenge moves to A with a fresh window from today.
  assert.equal(rankOf(c, C), 2);
  const ch = openChallenge(c, "2027-03-12");
  assert.equal(ch.against, A);
  assert.equal(ch.deadline, addDays(c.desk, 3));
  c = advance(c, 5);
  assert.equal(confirmedOn(c, "2027-03-12").id, C);
});

test("a release by the challenger voids the challenge; the first hold keeps its place", () => {
  const { b, A, B } = threeHolds();
  const c = release(challenge(b, B), B);
  assert.equal(c.challenges[0].status, "void");
  assert.equal(rankOf(c, A), 1);
  assert.equal(confirmedOn(c, "2027-03-12"), null);
});

test("actions replay from the URL and skip invalid steps", () => {
  const { b, A, B } = threeHolds();
  assert.deepEqual(parseActs("c2.a4,f9,x1, r3"), [{ op: "c", n: 2 }, { op: "a", n: 4 }, { op: "f", n: 9 }, { op: "r", n: 3 }]);
  const { book, errors } = applyActs(b, parseActs(`c${B}.f${B}.a4`));
  assert.equal(errors.length, 1, "B cannot confirm while A is first");
  assert.equal(confirmedOn(book, "2027-03-12").id, B);
  assert.equal(book.holds.find((h) => h.id === A).status, "released");
});

// --- Radius clauses ------------------------------------------------------------------

test("our radius clause flags the artist playing a nearby room inside the window", () => {
  const hold = { artist: "X", date: "2027-05-01" };
  assert.ok(milesTo("copper") < OUR_CLAUSE.miles);
  const inside = radiusConflicts(hold, [{ artist: "X", venue: "copper", date: "2027-04-01" }]);
  assert.ok(inside.some((c) => c.kind === "ours" && c.days === -30));
  // Exactly 60 days before is still inside ours; 61 is not. Copperline's own clause only runs 30 days after its show.
  assert.deepEqual(radiusConflicts(hold, [{ artist: "X", venue: "copper", date: addDays("2027-05-01", -60) }]).map((c) => c.kind), ["ours"]);
  assert.equal(radiusConflicts(hold, [{ artist: "X", venue: "copper", date: addDays("2027-05-01", -61) }]).length, 0);
  // 31 days after is outside ours, but inside Copperline's 60 days before its own show.
  assert.deepEqual(radiusConflicts(hold, [{ artist: "X", venue: "copper", date: addDays("2027-05-01", 31) }]).map((c) => c.kind), ["theirs"]);
});

test("distance and artist matter, and the other room's clause can block our date", () => {
  const hold = { artist: "X", date: "2027-05-01" };
  assert.ok(milesTo("millrace") > OUR_CLAUSE.miles);
  assert.equal(radiusConflicts(hold, [{ artist: "X", venue: "millrace", date: "2027-05-10" }]).length, 0, "61 miles away is outside both clauses");
  assert.equal(radiusConflicts(hold, [{ artist: "Y", venue: "copper", date: "2027-05-10" }]).length, 0, "a different artist");
  // Harbor Pavilion (36 mi) has a 100 mile, 90 days before clause: our date 80 days ahead of theirs is blocked by theirs only.
  const c = radiusConflicts(hold, [{ artist: "X", venue: "harbor", date: addDays("2027-05-01", 80) }]);
  assert.deepEqual(c.map((x) => x.kind), ["theirs"]);
});

// --- Deals ---------------------------------------------------------------------------

test("flat guarantee pays the guarantee whatever the door", () => {
  for (const nbor of [0, 5000, 50000]) assert.equal(artistPayout({ type: "flat", guarantee: 7500 }, nbor, 9000).payout, 7500);
});

test("door deal pays its share of net box office, expenses or not", () => {
  const d = artistPayout({ type: "door", pct: 0.7 }, 10000, 6000);
  assert.equal(d.payout, 7000);
  assert.equal(d.won, "percentage");
});

test("versus deal: the guarantee wins on a soft night", () => {
  // $5,000 vs 85% of net after expenses. NBOR $12,000, expenses $8,000: 85% of $4,000 is $3,400.
  const d = artistPayout({ type: "versus", guarantee: 5000, pct: 0.85 }, 12000, 8000);
  assert.equal(d.pctSide, 3400);
  assert.equal(d.payout, 5000);
  assert.equal(d.won, "guarantee");
  close(d.splitPoint, 8000 + 5000 / 0.85);
});

test("versus deal: the percentage wins on a strong night", () => {
  // NBOR $20,000, expenses $8,000: 85% of $12,000 is $10,200, over the $5,000 guarantee.
  const d = artistPayout({ type: "versus", guarantee: 5000, pct: 0.85 }, 20000, 8000);
  assert.equal(d.payout, 10200);
  assert.equal(d.won, "percentage");
  // At the split point the two sides are equal.
  const at = artistPayout({ type: "versus", guarantee: 5000, pct: 0.85 }, d.splitPoint, 8000);
  close(at.pctSide, 5000, 0.01);
});

test("guarantee plus backend: split point is expenses + guarantee + promoter profit", () => {
  // $10,000 + 85% over split. Expenses $8,000, promoter profit 15% of $18,000 = $2,700, split $20,700.
  const deal = { type: "plus", guarantee: 10000, pct: 0.85, ppPct: 0.15 };
  const hi = artistPayout(deal, 30000, 8000);
  assert.equal(hi.promoterProfit, 2700);
  assert.equal(hi.splitPoint, 20700);
  assert.equal(hi.pctSide, 7905); // 85% of $9,300
  assert.equal(hi.payout, 17905);
  const lo = artistPayout(deal, 15000, 8000);
  assert.equal(lo.payout, 10000);
  assert.equal(lo.won, "guarantee");
});

// --- Settlement math -----------------------------------------------------------------

test("order of operations: facility fee and ticket fee come off gross, then tax inside the rest", () => {
  // 100 tickets at $30 all in: gross $3,000, facility $200, ticket fees $425, $2,375 left with 7% tax inside.
  const s = settle({ deal: { type: "flat", guarantee: 0 }, levels: [level(30, 100)], expenses: [] });
  assert.equal(s.gross, 3000);
  assert.equal(s.facility, 200);
  assert.equal(s.ticketFees, 425);
  assert.equal(s.taxable, 2375);
  assert.equal(s.tax, 155.37); // 2375 x 0.07 / 1.07
  assert.equal(s.nbor, 2219.63);
});

test("box office sales carry the lower fee, and the venue keeps the fee rebates", () => {
  const s = settle({ deal: { type: "flat", guarantee: 0 }, levels: [level(30, 100), level(35, 50, VENUE.boxFee, VENUE.boxFee)], expenses: [] });
  assert.equal(s.ticketFees, 100 * VENUE.onlineFee + 50 * VENUE.boxFee);
  assert.equal(s.rebates, 100 * VENUE.onlineRebate + 50 * VENUE.boxFee);
});

test("expense caps: the charge stops at the cap and the venue eats the rest", () => {
  const s = settle({ deal: { type: "flat", guarantee: 0 }, levels: [level(30, 100)], expenses: [flatLine("marketing", 3500, { budget: 3000, cap: 3000 })] });
  const m = s.expenses[0];
  assert.equal(m.charged, 3000);
  assert.equal(m.eaten, 500);
  assert.equal(m.note, "Capped");
  assert.equal(s.showExpenses, 3000);
  assert.equal(s.actualExpenses, 3500);
});

test("undocumented expenses follow the policy: held to estimate, struck, or allowed", () => {
  const line = flatLine("sound", 800, { budget: 650, documented: false });
  const charged = (policy) => settle({ deal: { type: "flat", guarantee: 0 }, levels: [level(30, 10)], expenses: [line], policy }).expenses[0].charged;
  assert.equal(charged("budget"), 650);
  assert.equal(charged("strike"), 0);
  assert.equal(charged("allow"), 800);
  // A capped line with no backup takes the lower of the two.
  const capped = settle({ deal: { type: "flat", guarantee: 0 }, levels: [level(30, 10)], expenses: [{ ...line, cap: 600 }] }).expenses[0];
  assert.equal(capped.charged, 600);
  assert.equal(capped.note, "No backup, held to estimate, capped");
});

test("percentage expense lines are computed from gross and NBOR on the sheet", () => {
  const s = settle({
    deal: { type: "flat", guarantee: 0 }, levels: [level(30, 100)],
    expenses: [{ key: "cc", rate: 0.029, base: "gross", kind: "pct" }, { key: "pro", rate: 0.015, base: "nbor", kind: "pct" }],
  });
  assert.equal(s.expenses[0].charged, 87); // 2.9% of $3,000
  assert.equal(s.expenses[1].charged, 33.29); // 1.5% of $2,219.63
});

test("merch: tax comes out first, then the venue takes 20% of soft and 10% of hard goods", () => {
  const s = settle({ deal: { type: "flat", guarantee: 1000 }, levels: [level(30, 10)], expenses: [], merch: { soft: 1070, hard: 535 } });
  assert.equal(s.merch.tax, 105);
  assert.equal(s.merch.softNet, 1000);
  assert.equal(s.merch.venue, 250); // $200 soft + $50 hard
  assert.equal(s.merch.artist, 1250);
  // Balance due nets the deposit, the merch tax the venue remits, and its commission.
  assert.equal(s.deposit, 500);
  assert.equal(s.balance, 1000 - 500 - 105 - 250);
});

test("door deals carry no deposit", () => {
  const s = settle({ deal: { type: "door", pct: 0.7 }, levels: [level(20, 100)], expenses: [] });
  assert.equal(s.deposit, 0);
  assert.equal(s.balance, s.deal.payout);
});

test("allocation fills the early bird, then advance, then walk-up, and never oversells", () => {
  const m = manifest("mid");
  const a = allocate(400, 100, m);
  assert.equal(a.early, VENUE.earlyBirdCap);
  assert.equal(a.early + a.adv + a.dos + a.bal, 500);
  assert.equal(a.turnedAway, 0);
  const big = allocate(2000, 600, m);
  assert.equal(big.early + big.adv + big.dos + big.bal, m.sellable);
  assert.equal(big.turnedAway, 2600 - m.sellable);
  // Kills and comps come off the 1,200 before anything sells.
  assert.equal(m.sellable + sum(m.kills.map((k) => k.n)) + sum(m.comps.map((c) => c.n)), VENUE.capacity);
});

// --- Deal builder --------------------------------------------------------------------

test("break-even attendance is the first paid count where the promoter is not losing", () => {
  const b = { ...BUILDER_DEFAULTS };
  for (const measure of ["showNet", "promoterNet", "venueNet"]) {
    const n = breakEven(b, measure);
    assert.ok(n > 0 && n < manifest(b.tier).sellable, `${measure} break-even ${n}`);
    assert.ok(settle(builderShow(b, n))[measure] >= 0);
    assert.ok(settle(builderShow(b, n - 1))[measure] < 0);
  }
  // Fees, rebates, and merch lower the break-even; the bar lowers it again.
  assert.ok(breakEven(b, "venueNet") < breakEven(b, "promoterNet"));
  assert.ok(breakEven(b, "promoterNet") < breakEven(b, "showNet"));
});

test("a bigger guarantee raises break-even, and an impossible one has none", () => {
  const b = { ...BUILDER_DEFAULTS, type: "flat" };
  assert.ok(breakEven({ ...b, guarantee: 9000 }, "showNet") > breakEven({ ...b, guarantee: 4000 }, "showNet"));
  assert.equal(breakEven({ ...b, guarantee: 90000 }, "showNet"), null);
});

test("walkout potential is the artist payout at a full sellout", () => {
  const b = { ...BUILDER_DEFAULTS };
  const s = builderSummary(b);
  const full = settle(builderShow(b, s.sellable));
  assert.equal(s.walkout, full.deal.payout);
  assert.equal(s.walkout, Math.max(b.guarantee, Math.round(0.85 * (full.nbor - full.showExpenses) * 100) / 100));
  assert.equal(full.paid, s.sellable);
  // A flat deal walks out with exactly the guarantee.
  assert.equal(builderSummary({ ...b, type: "flat" }).walkout, b.guarantee);
});

// --- Season --------------------------------------------------------------------------

const S7 = (() => { const { book, routing } = makeBook(7); return { book, routing, ...simulateSeason(book, routing, 7) }; })();

test("the book is deterministic from its seed", () => {
  const a = makeBook(7), b = makeBook(7), c = makeBook(8);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.book.holds.map((h) => h.artist), c.book.holds.map((h) => h.artist));
  assert.ok(a.book.challenges.some((x) => x.status === "open"), "the book starts with open challenges");
});

test("every date in the generated book has at most one confirmation and ranked holds", () => {
  const dates = new Set(S7.book.holds.map((h) => h.date));
  for (const d of dates) {
    assert.ok(S7.book.holds.filter((h) => h.date === d && h.status === "confirmed").length <= 1);
    if (confirmedOn(S7.book, d)) assert.equal(activeHolds(S7.book, d).length, 0);
  }
});

test("the season is about 120 shows, one per date, and deterministic", () => {
  assert.ok(S7.shows.length >= 100 && S7.shows.length <= 140, `${S7.shows.length} shows`);
  assert.equal(new Set(S7.shows.map((s) => s.date)).size, S7.shows.length);
  const again = simulateSeason(S7.book, S7.routing, 7);
  assert.deepEqual(again.report, S7.report);
  assert.notDeepEqual(simulateSeason(S7.book, S7.routing, 8).report.totals, S7.report.totals);
});

test("confirmed dates play the confirmed artist, and holds blocked by a radius clause never play", () => {
  const plays = resolveSeason(S7.book, S7.routing, 7);
  for (const p of plays) {
    const c = confirmedOn(S7.book, p.date);
    if (c) assert.equal(p.artist, c.artist);
    else {
      const h = activeHolds(S7.book, p.date).find((x) => x.artist === p.artist);
      assert.equal(radiusConflicts(h, S7.routing).length, 0);
    }
  }
});

test("every settlement balances to the cent", () => {
  for (const s of S7.shows) {
    const r = s.result;
    close(r.gross, r.nbor + r.facility + r.ticketFees + r.tax, 0.011);
    close(r.nbor, r.showExpenses + r.deal.payout + r.showNet, 0.011);
    close(r.deal.payout, r.deposit + r.balance + r.merch.tax + r.merch.venue, 0.011);
    close(r.merch.gross, r.merch.tax + r.merch.venue + r.merch.artist, 0.011);
    assert.equal(r.paid + r.comps + r.kills + r.unsold, VENUE.capacity);
    assert.ok(r.unsold >= 0);
  }
});

test("the venue P&L is cash in minus cash out", () => {
  for (const s of S7.shows) {
    const r = s.result;
    const nonHouse = sum(r.expenses.filter((e) => e.charge !== "house").map((e) => e.actual));
    const cashIn = r.nbor + r.facility + r.rebates + r.merch.venue + r.bar.gross;
    const cashOut = r.deal.payout + nonHouse + r.houseCost + r.bar.cost;
    close(r.venueNet, cashIn - cashOut, 0.05);
    close(r.venueNet, r.promoterNet + r.barNet, 0.011);
  }
});

test("months and deal types add up to the season totals", () => {
  const { months, types, totals } = S7.report;
  assert.equal(sum(months.map((m) => m.shows)), totals.shows);
  assert.equal(sum(types.map((t) => t.shows)), totals.shows);
  for (const k of ["promoterNet", "venueNet", "gross", "payout"]) {
    close(sum(months.map((m) => m[k])), totals[k], 0.5);
    close(sum(types.map((t) => t[k])), totals[k], 0.5);
  }
  close(sum(S7.shows.map((s) => s.result.venueNet)), totals.venueNet, 0.5);
  for (const t of types) assert.ok(t.losing <= t.shows && t.lost <= 0);
});

test("deal types follow artist size, and guarantee shows that lost money are counted", () => {
  for (const s of S7.shows) assert.ok(TIERS[s.tier].deals[s.deal.type] > 0, `${s.tier} got a ${s.deal.type} deal`);
  const losers = S7.shows.filter((s) => s.deal.type !== "door" && s.result.promoterNet < 0).length;
  assert.equal(sum(S7.report.types.filter((t) => t.type !== "door").map((t) => t.losing)), losers);
  assert.ok(losers > 0, "some guarantees lose money");
});

test("show-level sims are reproducible and expense lines match the tier", () => {
  const lines = expenseBudget("established", 1100).map((l) => l.key);
  for (const k of ["soundUp", "lightsUp", "barricade", "house"]) assert.ok(lines.includes(k));
  assert.ok(!expenseBudget("local", 200).some((l) => l.key === "hands"), "local shows load their own gear");
  const r = mulberry32(5);
  assert.deepEqual([r(), r()], (() => { const q = mulberry32(5); return [q(), q()]; })());
});

// --- URL state -----------------------------------------------------------------------

test("state round trips through the URL and bad values are clamped", () => {
  const s = decodeState("view=sheet&guarantee=7500&type=plus&acts=c3.a2&m=4");
  assert.equal(s.view, "sheet");
  assert.equal(s.guarantee, 7500);
  assert.equal(s.acts, "c3.a2");
  assert.deepEqual(decodeState(encodeState(s)), s);
  const bad = decodeState("view=nope&type=zz&m=40&pct=300&seed=-4&d=tomorrow");
  assert.equal(bad.view, "calendar");
  assert.equal(bad.type, "versus");
  assert.equal(bad.m, 11);
  assert.equal(bad.pct, 100);
  assert.equal(bad.seed, 1);
  assert.equal(bad.d, "");
  assert.equal(daysBetween("2027-01-01", "2027-03-01"), 59);
});
