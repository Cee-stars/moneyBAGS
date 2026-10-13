# moneyBAGS — Domain Modeling & Technical Design Research

**Date of research: 2026-10-13.** Pricing and API availability change; every such claim below carries the date of its source. Primary-source code was read directly from the upstream repositories (Firefly III, Actual Budget, GnuCash, Maybe Finance) on 2026-10-13 — those parts are *confirmed*, not inferred. Vendor documentation hosts (stripe.com, rfc-editor.org, neon.com, supabase.com, nextjs.org, link.moneytree.jp) were **not directly reachable** from this environment; claims sourced from them come via search-engine extraction of their pages and are flagged where that matters.

---

## 0. Executive summary

| # | Question | Recommendation |
|---|---|---|
| 1 | Recurring data model | **Four tables**: `subscription` (identity) → `subscription_term` (effective-dated price + recurrence) → `expected_charge` (materialized forecast, bounded horizon) → `txn` (one ledger table for reality). **Do not auto-post** to the ledger; forecast and reconcile. |
| 1b | Day 29/30/31 in February | **Clamp at computation time** (`min(anchor_day, days_in_month)`), store the *requested* day. Reserve `anchor_day = -1` for "last day of month". **Do not** use RFC 5545 default semantics — they *skip* February entirely. |
| 1c | Annual subs: amortize or lump sum? | **Store the lump sum in its real month** (the ledger must reconcile to the bank). **Derive** the normalized figure; make **annualized cost** the canonical comparison metric, monthly = annualized ÷ 12 for display only. Never store both. |
| 2 | Money representation | **`INTEGER` minor units** + per-currency `exponent` (JPY = 0, USD = 2). Column names end in `_minor`. Never float, never TEXT, no decimal library. |
| 3 | Competitive landscape | Subscription tracking exists (MF ME サブスクレポート, premium-only; a dozen single-purpose JP apps). **Wishlist × expenses × subscriptions genuinely does not exist as a shipped app** — only Notion templates. The idea is unserved. |
| 4 | Bank/card auto-import in Japan | **Not feasible for an individual.** Account-information aggregation is a registered activity (電子決済等代行業者, 第二号) requiring 財務局 registration; Moneytree LINK is enterprise sales with no public pricing or self-serve signup. **CSV import is the pragmatic path.** |
| 5 | Deployment | **Small VPS + SQLite on a persistent disk + Tailscale + PWA.** Zero change to `better-sqlite3`, no cold start, no inactivity pause, data on one disk you control, ~¥800–1,400/mo. If ¥0 is mandatory: Cloudflare Workers + D1. **Reject Supabase free** (7-day inactivity pause). |
| 5b | PWA? | **Yes.** `app/manifest.ts` is built into Next.js 15; add `@serwist/next` (actively maintained — v9.5.13 published 2026-10-04) for offline. **Do not rely on iOS Web Push** for renewal reminders. |
| 6 | Recurring-cost detection | Three stages: NFKC/descriptor normalization → interval clustering with per-cadence tolerance → amount tolerance (~7.5%). Require ≥3 occurrences. **Always propose, never auto-commit.** No mature OSS library exists; expect to write it (~200 lines). |

---

## 1. Recurring-payment data modeling

### 1.1 What established systems actually do (confirmed from source)

#### Firefly III — `recurrences` + `recurrences_repetitions` + `recurrences_transactions`

Read from `firefly-iii/firefly-iii` @ `main`, 2026-10-13. Schema created in `database/migrations/2018_06_08_200526_changes_for_v475.php`:

```php
Schema::create('recurrences', ...)       // the rule
  id, timestamps, softDeletes,
  user_id, transaction_type_id,
  title, description,
  first_date,          // the PHASE anchor — never mutated
  repeat_until,        // nullable end date
  latest_date,         // high-water mark of what has been generated
  repetitions,         // count-based end
  apply_rules, active  // boolean

Schema::create('recurrences_repetitions', ...)   // the recurrence pattern
  id, timestamps, softDeletes, recurrence_id,
  repetition_type   VARCHAR(50),   // daily | weekly | monthly | ndom | yearly
  repetition_moment VARCHAR(50),   // polymorphic: day-of-month, weekday, "nth,weekday", or a date
  repetition_skip   SMALLINT,      // every-N: skip N-1 occurrences
  weekend           SMALLINT       // weekend-adjustment strategy

Schema::create('recurrences_transactions', ...)  // the amount template
  id, timestamps, softDeletes, recurrence_id,
  transaction_currency_id, foreign_currency_id (nullable),
  source_id, destination_id,
  amount         DECIMAL(32,12),
  foreign_amount DECIMAL(32,12) nullable,
  description
```

Four design decisions worth stealing:

1. **`first_date` is the immutable phase anchor.** Occurrences are recomputed from it, not from the last generated date. This is what prevents drift.
2. **`latest_date` is the generation high-water mark**, kept separate from the phase. Generation is resumable and idempotent.
3. **The repetition is a child row, not a column set on the rule.** A rule can hold several repetitions (e.g. "the 1st *and* the 15th").
4. **`repetition_moment` is deliberately a string** whose meaning depends on `repetition_type`. Pragmatic for a solo app; I recommend decomposing it instead (see §1.9) because a string forces parsing on every query.

**Month-end handling — confirmed clamp.** `app/Support/Repositories/Recurring/CalculateXOccurrences.php`:

```php
protected function getXMonthlyOccurrences(Carbon $date, int $count, int $skipMod, string $moment): array
{
    $dayOfMonth = (int) $moment;
    if ($mutator->day > $dayOfMonth) { $mutator->addMonth(); }
    while ($total < $count) {
        $domCorrected = min($dayOfMonth, $mutator->daysInMonth);   // <-- THE CLAMP
        $mutator->day = $domCorrected;
        if (0 === ($attempts % $skipMod)) { $return[] = clone $mutator; ++$total; }
        ++$attempts;
        $mutator->endOfMonth()->addDay();      // advance by calendar month, not by 30 days
    }
}
```

The same `min($dayOfMonth, $...->daysInMonth)` appears in all three calculators (`CalculateXOccurrences.php:73`, `CalculateXOccurrencesSince.php:81`, `CalculateRangeOccurrences.php:68`). **The requested day is stored; the clamp happens at computation time.** A 31st-of-the-month subscription therefore produces 31 Jan → 28/29 Feb → 31 Mar → 30 Apr, and *returns to 31* in long months. Had they stored the clamped value, it would have ratcheted down to the 28th forever. This is the single most important detail in the whole month-end question.

Note the loop advances with `endOfMonth()->addDay()` — i.e. by calendar month. Adding "30 days" or even `addMonth()` from a clamped date would drift.

Firefly also has `ndom` ("nth day-of-month" = "2nd Tuesday") implemented via natural-language date parsing, and weekend adjustment in `FiltersWeekends.php` with the constants `WEEKEND_DO_NOTHING`, `WEEKEND_SKIP`, `WEEKEND_TO_FRIDAY`, `WEEKEND_TO_MONDAY`.

Firefly III generates transactions **from a cron job** ([docs](https://docs.firefly-iii.org/how-to/firefly-iii/finances/recurring/)) — i.e. it *does* auto-post. Note the consequence: no cron run means no transactions, and a double cron run risks duplicates. The docs also confirm the user-visible behaviour: for day 29–31 in shorter months, it falls back to the last available day.

#### Actual Budget — the design I'd actually copy

Read from `actualbudget/actual` @ `master`, 2026-10-13. `packages/loot-core/migrations/1618975177358_schedules.sql`:

```sql
CREATE TABLE schedules (
   id TEXT PRIMARY KEY,
   rule TEXT,                   -- FK to the rules table: conditions + recurrence live there
   active INTEGER DEFAULT 0,
   completed INTEGER DEFAULT 0,
   posts_transaction INTEGER DEFAULT 0,   -- <<< auto-post, or forecast-and-match?
   tombstone INTEGER DEFAULT 0);          -- <<< soft delete, separate from active/completed

CREATE TABLE schedules_next_date (
   id TEXT PRIMARY KEY, schedule_id TEXT,
   local_next_date INTEGER, local_next_date_ts INTEGER,
   base_next_date  INTEGER, base_next_date_ts  INTEGER);  -- <<< cached next occurrence

CREATE TABLE schedules_json_paths (
   schedule_id TEXT PRIMARY KEY, payee TEXT, account TEXT, amount TEXT, date TEXT);

ALTER TABLE transactions ADD COLUMN schedule TEXT;         -- <<< reality links back to the plan
```

This schema answers several of your questions at once:

- **`posts_transaction`** — an explicit, per-schedule switch between *auto-generate a transaction* and *just show it as upcoming and match it when it arrives*. **The default is 0, i.e. forecast-and-match.** This is the strongest evidence for my recommendation in §1.6.
- **`transactions.schedule`** — a nullable FK *from the fact to the plan*. The ledger stays a single table; the subscription link is one column.
- **Three independent lifecycle flags** — `active` (is it running), `completed` (did it finish naturally), `tombstone` (did the user delete it). Confirms that "paused/cancelled/deleted" are three different concepts and should not be crammed into one enum or one `deleted_at`.
- **`base_next_date` vs `local_next_date`** — the computed-from-anchor date is cached *separately* from the possibly weekend-adjusted local date. Drift protection again.

**Recurrence config shape** (`packages/loot-core/src/shared/schedules.ts`, `recurConfigToRSchedule`):

```js
{ start, frequency: 'daily'|'weekly'|'monthly'|'yearly',
  interval: N,
  patterns: [{ type: 'day' | 'MO'|'TU'|..., value }],   // day-of-month OR nth-weekday
  endMode: 'never' | 'after_n_occurrences' | 'on_date',
  endOccurrences, endDate,
  skipWeekend, weekendSolve }
```

It compiles to `@rschedule/core` options (`byDayOfMonth`, `byDayOfWeek: [['TU', 2]]`, `interval`, `count`, `end`) — i.e. it borrows RRULE's *vocabulary* while keeping the stored form a plain JSON object with named fields. That is exactly the tradeoff I recommend. Per the unofficial `actualpy` client, the day pattern supports **`-1` to mean the last day of the month** — a clean way to distinguish "the 31st" from "the last day".

**Reconciliation — confirmed tolerances.** `getScheduleOccurrenceMatchStartDate()`:

```js
if (dateCond?.op === 'is')        return occurrenceDate;          // exact date → exact match
if (schedule.posts_transaction)   return occurrenceDate;          // we posted it → exact
return monthUtils.subDays(occurrenceDate, 2);                     // else: 2-day grace window
```

and `packages/loot-core/src/shared/rules.ts:235`:

```js
export function getApproxNumberThreshold(number) {
  return Math.round(Math.abs(number) * 0.075);   // ±7.5% amount tolerance
}
```

Amount conditions accept `is | isapprox | isbetween`; date conditions accept `is | isapprox`. **So a real, shipped budget app reconciles expected-vs-actual with a ±2-day window and a ±7.5% amount band.** Those are good starting constants.

**Status model** (`getStatus()`): `completed → paid → due → upcoming → missed → scheduled`, derived from `(next_date, completed, hasTrans, upcomingLength)`. Note `missed` — a charge that was expected and never arrived is a first-class state, not a deletion.

#### GnuCash — the oldest and most conservative model

`libgnucash/engine/Recurrence.h` (read 2026-10-13):

```c
typedef enum {
    PERIOD_ONCE, PERIOD_DAY, PERIOD_WEEK, PERIOD_MONTH,
    PERIOD_END_OF_MONTH,   /* "This is actually a period plus a phase." */
    PERIOD_NTH_WEEKDAY,    /* e.g. Second Tuesday */
    PERIOD_LAST_WEEKDAY,
    PERIOD_YEAR, NUM_PERIOD_TYPES, PERIOD_INVALID = -1,
} PeriodType;

typedef enum { WEEKEND_ADJ_NONE, WEEKEND_ADJ_BACK, WEEKEND_ADJ_FORWARD, ... } WeekendAdjust;

typedef struct {
    GDate start;        /* First date in the recurrence; specifies phase. */
    PeriodType ptype;
    guint16 mult;       /* a period multiplier  <-- every-N lives here */
    WeekendAdjust wadj;
} Recurrence;
```

Two things to take from this:

- **`PERIOD_END_OF_MONTH` is a separate period type, not `BYMONTHDAY=31`.** GnuCash explicitly models "last day of month" as its own concept. The header comment even flags why: it is "a period plus a phase". Validating this, `recurrenceSet()` normalizes: *"for `PERIOD_END_OF_MONTH`, the last day of date's month is used"*, and *"for `PERIOD_NTH_WEEKDAY`, a fifth weekday converts to a `PERIOD_LAST_WEEKDAY`"* — i.e. "5th Tuesday" is impossible, so it degrades to "last Tuesday" rather than skipping.
- **Every-N is a multiplier (`mult`) on a base period**, not a separate "quarterly"/"biweekly" enum. Quarterly = `{MONTH, mult:3}`, biweekly = `{WEEK, mult:2}`. This collapses your "monthly/annual/quarterly/weekly/every-N-months" list into one representation. Firefly does the same with `repetition_skip`; Actual with `interval`. **All three independently converged on (base period × multiplier).** Strong signal.

The SQL backend stores this as `recurrences(obj_guid, recurrence_mult, recurrence_period_type, recurrence_period_start, recurrence_weekend_adjust)`, hung off `schedxactions(guid, name, enabled, start_date, end_date, last_occur, num_occur, rem_occur, auto_create, auto_notify, adv_creation, adv_notify, instance_count, template_act_guid)` — per the [GnuCash SQL wiki page](https://wiki.gnucash.org/wiki/SQL) and [piecash docs](https://piecash.readthedocs.io/en/stable/_modules/piecash/_common.html). Note **`auto_create` vs `auto_notify`** — the same auto-post-vs-notify switch as Actual's `posts_transaction`, twenty years earlier. And `last_occur` / `rem_occur` / `instance_count` are the generation bookkeeping that keeps it idempotent.

#### Stripe — the billing-system view

Per Stripe's billing-cycle documentation (accessed via search extraction 2026-10-13; **I could not load docs.stripe.com directly, so treat the wording as paraphrase**):

- `billing_cycle_anchor_config.day_of_month = 31` yields renewal on **the last day of each month**; in a shorter month it renews on that month's last day. Stripe recommends this parameter for monthly and yearly plans because it factors in short months and leap years.
- The documented sequence for a 31 January anchor is **28 Feb (29 in a leap year) → 31 Mar → 30 Apr → …** — i.e. identical clamp-and-restore behaviour to Firefly III.
- For multi-month intervals there is an extra wrinkle: a 2-month subscription created in February with a day-31 anchor gets an **initial prorated period** to 28/29 Feb, then full 2-month periods. Proration is Stripe's answer to anchor misalignment; a personal tracker does not need it.

A third-party glossary ([flexprice.io](https://flexprice.io/glossary/anniversary-billing)) adds the warning that clamping and then *persisting* the clamped day shortens later periods, and recommends keeping the originally requested day on the record. That is not Stripe documentation, but it independently restates the Firefly III finding, and it is the right advice.

**Stripe's price model** is the other relevant piece: a `Price` object is separate from the `Subscription`, and `SubscriptionSchedule` lets you predefine future phases (and can **create a new Price inline** rather than editing an existing one). I could not confirm a documentation statement that `Price` objects are strictly immutable — **treat "Stripe prices are immutable" as my inference**, supported by the inline-creation API shape and by the existence of `SubscriptionSchedule` phases. The architectural point stands regardless: *the price is a versioned object referenced by the subscription, not a mutable field on it.* That is the price-history answer (§1.4).

**Trials**: Stripe uses `trial_end` / `trial_period_days` on the subscription. Newer "trial offers" use a **separate trial `Price` object**, and the docs state you cannot combine a trial offer with a `trial_end`/`trial_period_days` free trial, and cannot change a trial offer's duration after creation. So Stripe's own evolution went *from* a flag on the subscription *to* a distinct priced phase — again pointing at effective-dated terms.

#### iCalendar RRULE — why you should NOT store an RRULE string

This is the most actionable negative finding in this section.

RFC 5545's `BYMONTHDAY=31` with `FREQ=MONTHLY` **does not clamp — it omits.** Invalid dates are skipped. RFC 7529 later made this explicit by adding a `SKIP` parameter with values `OMIT`, `BACKWARD`, `FORWARD`, and the pre-existing Gregorian behaviour is `SKIP=OMIT`. (Confirmed indirectly: the RFC 7529 table of contents has a section titled "Skipping Invalid Dates"; CalConnect's [RRULE/RSCALE examples](https://calconnect.org/node/173) describe testing *"the implicit `SKIP=YES` behavior with the non-RSCALE Gregorian calendar"*. **I could not load rfc-editor.org or datatracker.ietf.org from this environment**, so the enumerated value names come from search extraction of `draft-daboo-icalendar-rscale` and RFC 7529 and should be spot-checked before you cite them in code comments.)

The consequence for a billing app is severe: **`FREQ=MONTHLY;BYMONTHDAY=31` means "bill me in January, March, May, July, August, October, December" — February, April, June, September and November are simply skipped.** That is never what a subscription means. Every billing system surveyed above clamps instead. `BYMONTHDAY=-1` ("last day") is the RRULE-correct spelling of the intent, but then a 30th-of-month subscription has no correct RRULE at all without `SKIP=BACKWARD`, which is RFC 7529 and patchily supported.

Second problem: an RRULE string is **opaque to SQL**. "Which subscriptions bill in February?" and "what is my annualized spend?" become application-layer loops over an RRULE engine instead of a `WHERE` clause.

**Verdict: borrow RRULE's vocabulary (FREQ / INTERVAL / BYMONTHDAY / BYDAY / BYSETPOS), store it decomposed into typed columns, and implement clamp semantics yourself.** This is precisely what Actual Budget does (JSON config → rschedule at runtime) and what Firefly III and GnuCash do (typed columns).

### 1.2 Billing intervals

Collapse everything to **(base period, multiplier, phase anchor)** — the representation all three open-source apps converged on independently:

| Real-world interval | `freq` | `interval_n` | anchor |
|---|---|---|---|
| Monthly | `MONTH` | 1 | `anchor_day` |
| Quarterly | `MONTH` | 3 | `anchor_day` + `anchor_date` for phase |
| Every 2 months | `MONTH` | 2 | as above |
| Annual | `YEAR` | 1 | `anchor_date` (month+day) |
| Weekly | `WEEK` | 1 | `anchor_weekday` |
| Biweekly | `WEEK` | 2 | `anchor_weekday` + `anchor_date` for phase |
| "2nd Tuesday monthly" | `MONTH` | 1 | `nth_week=2, anchor_weekday=2` |
| Last day of month | `MONTH` | 1 | `anchor_day = -1` |

**The phase matters for every multiplier > 1.** "Quarterly on the 15th" is ambiguous — Jan/Apr/Jul/Oct or Feb/May/Aug/Nov? You need `anchor_date` (the first real billing date) to disambiguate, which is exactly why Firefly keeps `first_date` and GnuCash keeps `Recurrence.start` with the comment *"specifies phase"*.

**Irregular**: don't model it. If a cost has no pattern, it isn't a subscription — it is a sequence of transactions, optionally tagged to a subscription with `freq = NULL` (an "irregular" subscription that you track for grouping and totals but never forecast). A `status`/`freq IS NULL` subscription still participates in "what am I paying for" lists; it just produces no `expected_charge` rows. One switch, no new table.

### 1.3 Day 29/30/31 in February — the recommendation

```
anchor_day        INTEGER       -- 1..31, or -1 meaning "last day of month"
day_overflow      TEXT          -- 'clamp' (default) | 'skip' | 'forward'
```

1. **Store the requested day, never the resolved day.** Resolve at computation time with `min(anchor_day, days_in_month)`. (Confirmed Firefly III behaviour; matches Stripe's documented Jan 31 → Feb 28 → **Mar 31** sequence.)
2. **Advance by calendar month from the anchor, not by adding days or by `addMonth()` on the clamped date.** Compute occurrence *k* as `anchor_month + k*interval_n`, then clamp the day. This makes the function pure in *k* — no accumulated drift, and regenerating is idempotent.
3. **`anchor_day = -1` means "last day"**, a distinct intent from "the 31st". GnuCash makes this a separate `PERIOD_END_OF_MONTH` period type; `actualpy` uses `-1`. Use `-1` — one column, no new enum value. In practice clamp makes 31 and -1 behave identically, but the user's *intent* differs and you will want it for display ("毎月末日" vs "毎月31日").
4. **Keep `day_overflow` as a column even though you will only ever use `clamp`.** It costs nothing and documents the decision. `skip` exists for RRULE compatibility; `forward` (→ 1 March) is what a few payment processors do and is occasionally what a user wants.
5. **Weekend adjustment is a separate axis** (`weekend_adjust: none|back|forward`). Confirmed present in all three: Firefly `weekend`, GnuCash `WeekendAdjust`, Actual `skipWeekend`+`weekendSolve`. For card-billed subscriptions this is almost always `none` (cards charge on weekends); for 口座振替 (direct debit) it matters, because Japanese banks move a weekend/holiday debit to the next business day. **If you add it, note that "next business day" in Japan needs a 祝日 calendar, not just a weekday check** — that is a real scope decision, and I'd defer it.

### 1.4 Free trials and price changes — one mechanism, not two

**Both are the same problem: the terms of a subscription change on a date, and you need the old terms to stay true for the old months.** Solve them once with an effective-dated `subscription_term` table.

```
subscription_term
  subscription_id, effective_from, effective_to (NULL = current),
  status       -- 'trial' | 'active' | 'paused' | 'cancelled'
  amount_minor -- 0 during a free trial
  currency, freq, interval_n, anchor_*, day_overflow, weekend_adjust
```

- A **free trial** is a term with `status='trial'`, `amount_minor=0`, and `effective_to` = the conversion date. Conversion to paid = close that row, open the next. **No separate trial table, no `is_trial` boolean, no `trial_ends_at` column on the subscription.** (Stripe's own evolution from `trial_period_days` to a distinct trial `Price` is the same move.)
- A **price change** closes the current term and opens a new one. Your 2025 reports keep showing ¥500/mo because the 2025 term still says ¥500. This is the whole reason not to put `amount` on the subscription row.
- A **plan change** (Standard → Premium) is the same operation. So is an **interval change** (monthly → annual), which is the case a naive `price_history` table would get wrong — the price *and* the cadence change together, so they must version together. **This is why I recommend `subscription_term` rather than a `subscription_price_history` table**: a price-only history cannot express "switched to annual billing".
- A **pause** is a term with `status='paused'`. It generates no `expected_charge` rows but keeps the timeline contiguous, so "how long have I had this?" and "what did I pay in total?" stay answerable.

**Do you need price history?** For a solo app: **yes, and it is nearly free given you need the table anyway for trials.** Without it: (a) changing a price silently rewrites your own history, so last year's totals change under you; (b) you cannot answer "how much have subscription prices risen for me?", which is the single most motivating report this kind of app can produce (and topical — MF ME itself raised its price on 2025-08-05, see §3). The cost is one join and a `WHERE effective_from <= :d AND (effective_to IS NULL OR effective_to > :d)` predicate.

**Rejected:** storing amount on `subscription` and overwriting it. Cheap today, destroys the app's most interesting report, and makes historical forecasts retroactively wrong.
**Rejected:** an append-only `price_change` event log with no interval data. Cannot represent monthly→annual switches; forces you to replay events to answer any question.

### 1.5 Annual subscriptions: amortize or lump sum?

**Recommendation: store the lump sum in its actual billing month. Derive the normalized view. Never store both.**

Reasoning:

1. **The ledger must reconcile to the bank statement.** If you store ¥998/month for a ¥11,980/year subscription, your app's November total will not match your card statement, and the app loses its only external check on correctness. Once that breaks, you stop trusting it and stop using it.
2. **Rounding makes stored amortization lossy.** ¥11,980 ÷ 12 = ¥998.33. In integer yen that is twelve ¥998 payments = ¥11,976, a ¥4 leak per subscription per year. With JPY's zero exponent you cannot hide this in sub-units the way USD can. You'd need largest-remainder distribution to make the twelve parts sum exactly — fine for display, poisonous as stored truth.
3. **The two numbers answer different questions**, and a personal finance app needs both:
   - *"Can I pay my bills in November?"* → cash flow → **lump sum in November**.
   - *"Is Adobe worth it compared to Figma?"* → run-rate → **normalized monthly/annual**.
4. **What real apps do:** YNAB's canonical answer is Rule 2 / "True Expenses" — the user *manually* budgets ~1/12 each month into a category as a sinking fund, while the actual transaction still lands as a lump sum when it hits ([ynab.com/blog/how-to-embrace-your-true-expenses](https://www.ynab.com/blog/how-to-embrace-your-true-expenses)). Crucially, **the amortization is a budgeting-layer construct, not a ledger-layer one.** The ledger records the lump sum. That is exactly the separation I'm recommending, and it is the strongest precedent available. Dedicated subscription trackers (Bobby et al., §3) go the other way and show "daily/weekly/monthly/yearly cost at a glance" — i.e. they *derive* all four views from one stored amount+interval. Also the same separation.

**Canonical normalized metric: annualized cost, not monthly.**

```
annualized_minor = amount_minor * periods_per_year(freq, interval_n)
monthly_equivalent_minor = annualized_minor / 12      -- display only, round at the edge
```

Use annualized as the stored/compared figure because it is exact for every interval you care about (12 monthly, 4 quarterly, 1 annual, 52 weekly — weekly is the only approximation, 52 vs 52.1775). Deriving monthly from annualized gives one consistent rounding point. The alternative — computing a monthly figure per subscription then summing — rounds N times and the totals won't tie out.

**Concrete UI consequence worth designing for:** show a monthly timeline of *actual* charges (lumpy, with a visible spike in the month Adobe renews) **and** a flat "run rate" line. The gap between them is genuinely useful information — it tells you how much of your spending is deferred. Most apps show only one.

**Rejected:** storing 12 monthly `expected_charge` rows of ¥998 for an annual sub. Breaks reconciliation, leaks yen, and makes the forecast of your card bill wrong every single month.
**Rejected:** storing both a lump-sum row and amortized rows with a flag. Two sources of truth that will diverge; every aggregate query needs a filter you will eventually forget.

### 1.6 Paused / cancelled: soft-delete vs status vs effective dates

**Recommendation: use all three, because they are three different things.** Actual Budget's schema independently confirms this with three separate columns (`active`, `completed`, `tombstone`).

| Concept | Where it lives | Why |
|---|---|---|
| "I'm not paying for this right now" | `subscription_term.status = 'paused'` | Point-in-time, and it is *dated* — you need to know *when* it was paused for historical totals. |
| "I cancelled this on 2026-03-15" | `subscription.ended_on` + `ended_reason` | A domain fact about the real world. Permanent. Keeps history intact and keeps the subscription out of current totals automatically via date predicates. |
| "Don't show this in my list" | `subscription.archived_at` | UI hygiene, orthogonal to the domain. Lets you hide a cancelled-years-ago service without lying about it. |
| "This row was a mistake" | Hard `DELETE` | A solo app with backups does not need tombstones for data-management errors. |

**Why `ended_on` beats a `status='cancelled'` enum on the subscription:** every interesting query is date-scoped. "What was I paying in March 2026?" is `WHERE started_on <= '2026-03-31' AND (ended_on IS NULL OR ended_on >= '2026-03-01')`. With a bare status enum, a subscription you cancelled last week retroactively disappears from last year's totals — the exact history-pollution bug you asked about, in reverse.

**Why not a generic `deleted_at` soft-delete for cancellation:** cancelling a subscription is a *business event*, not a data-management act. Conflating them means you cannot distinguish "I cancelled Netflix" from "I typo'd this row". Firefly III uses `active` + Laravel `softDeletes()` side by side for the same reason.

**The pollution rule, stated once:** current totals come from `expected_charge` rows whose term is `status='active'` and whose `due_on` falls in the window, or from `txn` rows in the window. Neither query needs to know about cancellation at all — a cancelled subscription simply has no future `expected_charge` rows and no new `txn` rows. **Cancellation handled by absence, not by filtering.** That's the cleanest property of this design.

### 1.7 Subscription vs transaction: one table or two?

**Two tables — in fact three: plan, forecast, fact. And one ledger table for all transactions, subscription-related or not.**

```
subscription  (what I'm signed up for — identity, stable)
  └─ subscription_term  (the terms, effective-dated)
       └─ expected_charge  (what I think will be charged — materialized, bounded)
             ⇕ reconciled against
           txn             (what was actually charged — the single ledger)
```

Why not one table:

- A subscription has no amount — its *term* does, and that changes over time.
- A subscription has no date — it has a recurrence rule. A transaction has exactly one date and no rule.
- A subscription is a *standing intent*; a transaction is an *immutable event*. Different mutability, different lifecycle.
- You need `SUM(amount)` over transactions to equal your bank statement. If forecast rows live in the same table, every aggregate in the app needs a `WHERE is_forecast = 0` you will eventually forget in one place, and that one place will be the one that matters.

Why not fold `expected_charge` into `subscription_term` and compute on the fly:

- You need to *remember* reconciliation decisions ("the ¥1,480 on 3 Nov is October's Netflix charge, posted late"). That's a row.
- You need `missed` as a durable state, not a recomputation.
- You need the user to be able to say "skip this one occurrence" (free month, promo) without inventing a term.
- Pure computation is fine for *rendering* a 12-month-ahead projection. It is not fine for anything you need to annotate. **So: materialize a bounded window (say today − 3 months … today + 12 months), compute beyond that.** Actual Budget's `schedules_next_date` is the degenerate case of this — it materializes exactly one.

Why one ledger table rather than `subscription_txn` + `other_txn`:

- Your card statement is one stream. Splitting it means every balance, every monthly total, every CSV import has to union two tables.
- Subscription-ness is a *property discovered about* a transaction, often after import. That's a nullable FK (`txn.subscription_id`), exactly as Actual does with `transactions.schedule`.

#### Should the app auto-generate charges?

**No. Forecast and reconcile. Do not auto-post to the ledger.**

This is Actual Budget's default (`posts_transaction DEFAULT 0`) and GnuCash's default posture (`auto_create` vs `auto_notify` as separate flags). Firefly III does auto-post via cron, and its docs' prominent warning that *"this feature requires that you know how to run the cron job"* plus community threads about cron misconfiguration is itself a data point about the cost.

For your situation specifically — a single user importing card CSVs — auto-posting is strictly worse: the real charge *will* arrive via CSV, so auto-posting guarantees you have two rows for every charge and must dedupe them anyway. You've done the hard work (matching) and added a failure mode (phantom rows) for no gain.

**Reconciliation algorithm (concrete):**

```
for each unmatched txn:
  candidates = expected_charge
      where state in ('forecast','due','missed')
        and subscription.merchant matches txn.merchant       -- or txn.subscription_id already set
        and txn.date between due_on - 5 and due_on + 5        -- grace window
        and abs(txn.amount) between amount*0.925 and amount*1.075   -- ±7.5%
  if exactly one candidate: link it, state = 'matched'
  else: leave unmatched, surface in a review queue
```

The ±2-day / ±7.5% constants are Actual Budget's, read from source. I'd widen the date window to ±5 for Japanese card data, because **the posting date on a card statement is routinely days after the merchant's charge date, and 月末締め/翌月払い cycles stretch it further.** Make both tolerances per-subscription-overridable: USD-billed subs need a much wider amount band (§1.8).

**Failure modes of auto-generation, and the mitigation for each:**

| Failure mode | Mitigation |
|---|---|
| **Duplicates** (two generation runs, or generation + CSV import) | `UNIQUE (subscription_id, due_on)` on `expected_charge`. Generation is `INSERT … ON CONFLICT DO NOTHING`, so it is idempotent and safe to run on every page load. Separately, `UNIQUE (account_id, import_hash)` on `txn` makes CSV re-import idempotent. |
| **Drift** (each occurrence computed from the last, errors compound; clamped dates ratchet down) | Compute occurrence *k* as a pure function of `(term.anchor_date, freq, interval_n, k)`. Never read the previous row. Store the requested anchor, clamp on read. (Firefly's `first_date`; GnuCash's `Recurrence.start`.) |
| **Charges that never arrive** (service died, card expired, you forgot you cancelled) | Grace period, then `state='missed'`, surfaced in a review queue. **Never auto-delete and never silently roll forward.** `missed` is one of Actual's six first-class statuses. |
| **Phantom spend in totals** | Forecast rows live in `expected_charge`, never in `txn`. Totals that mean "what I spent" query `txn`; totals that mean "what I expect" query `expected_charge`. Structurally impossible to confuse. |
| **Price changed and you didn't notice** | A txn that matches on merchant+date but fails the amount band is the *highest-value event in the app*. Don't just fail to match — surface it as "Netflix went from ¥1,480 to ¥1,590, update terms?" and offer to close the term and open a new one. This is the killer feature and it falls out of the schema for free. |
| **Unbounded generation** | Materialize a bounded horizon only (−3mo … +12mo). Regenerate the forward window on demand; the backward window is already reconciled and immutable. |
| **Timezone / DST corruption of dates** | Store dates as `TEXT 'YYYY-MM-DD'`, never epoch timestamps, never `Date` round-trips through UTC. A billing date is a *calendar* date in JST, not an instant. Firefly III had to add `date_tz` columns in a 2024 migration (`2024_11_05_062108_add_date_tz_columns.php`) to clean this up after the fact — avoid inheriting that debt. |
| **Mutating a reconciled row** | `expected_charge` rows in state `matched` are closed. Term edits create a *new* term; they never retro-edit matched history. |

### 1.8 Foreign-currency subscriptions (USD-billed, JPY-paid)

**Recommendation: support it minimally — three nullable columns on `txn`, one per-term `currency`. Do NOT build an FX-rate pipeline.**

**Is it worth supporting for a solo Japanese developer? Yes, and it is close to unavoidable.** A developer's subscription list almost certainly contains USD-denominated items (GitHub, cloud providers, AI tools, Adobe, Netflix in some markets). If the model can't represent them, the app's headline number is wrong, which defeats the purpose. But the *full* treatment is not worth it.

What actually happens with a Japanese card, per [money.it-trend.jp](https://money.it-trend.jp/articles/credit/card/02-0355) and card-issuer pages (accessed 2026-10-13):

```
JPY charged = USD amount × brand reference rate × (1 + 海外事務手数料)
```

- 海外事務手数料 ranges roughly **1.6%–3.85%** depending on issuer. Cited examples: JCB CARD W / JCB Gold 1.6%; Epos Card **3.85% as of a 2025-07 revision, up from 2.20%**. Rates get revised, so any hardcoded number rots.
- Brand reference rates differ between Visa/Mastercard/JCB and **are not all published**.
- The rate applied depends on the **売上確定日** (settlement date), not the charge date, so the same USD price yields a different JPY amount every month. One source states plainly that 為替変動や売上確定日のズレ cause the billed amount to move.

The design consequences:

1. **The JPY amount is the fact; the USD amount is the intent.** So:
   ```
   txn.amount_minor       -- JPY, what the card actually billed. This is truth.
   txn.currency           -- 'JPY'
   txn.orig_amount_minor  -- 999 ($9.99)  ← nullable
   txn.orig_currency      -- 'USD'        ← nullable
   txn.fx_rate_micro      -- implied all-in rate, orig→settled, ×1e6  ← nullable, DERIVED
   ```
   `fx_rate_micro` is computed from the two amounts, not fetched. **It therefore already includes the issuer's fee**, which is what you want.
2. **`subscription_term.currency` is the billing currency** (`USD`), and `amount_minor` is in that currency (`999`). The term says what you agreed to pay; the txn says what it cost you.
3. **To forecast a USD subscription's JPY cost, use the last observed rate from that subscription's own charge history** — not a market rate. The observed rate bakes in the brand rate *and* your card's fee *and* settlement-date timing. It is strictly more accurate than a mid-market rate for the one question you're asking, and it costs zero API calls. This is the single best simplification available here.
4. **Widen the amount tolerance for foreign-currency subscriptions.** ±7.5% is marginal when the JPY amount moves with FX plus a possibly-revised 1.6%→3.85% fee. Make tolerance per-term, default ±7.5% for same-currency and ±15% for cross-currency. Otherwise every USD subscription lands in your review queue every month, and you'll stop reviewing.
5. **Flag rate changes, not just price changes.** If `fx_rate_micro` jumps when the USD amount is unchanged, that is FX, not a price rise. Distinguishing them is a genuinely nice report and is free once you store both amounts.

**Rejected:** a daily `fx_rate(date, base, quote, rate)` table populated from an API (which is what Maybe Finance does — `exchange_rates(from_currency, to_currency, date, rate)` with a unique index on the triple, confirmed in its `db/schema.rb`). Correct for a multi-user multi-currency product; for you it adds an external dependency, a scheduled job, and an API key, to produce a *worse* estimate than your own observed rate. Add it later if you ever hold foreign-currency *assets* (then you genuinely need mid-market revaluation).
**Rejected:** storing only JPY and dropping the USD amount. You lose the ability to tell "the price went up" from "the yen went down" — and in 2022–2026 that distinction dominated the actual numbers.
**Rejected:** storing only USD and converting for display. The ledger would stop reconciling with the card statement, which is the one invariant worth protecting.

### 1.9 Recommended schema sketch

SQLite dialect. `TEXT` dates in `YYYY-MM-DD`. All money is `INTEGER` minor units (§2). UUID/ULID text PKs.

```sql
-- ─── reference ────────────────────────────────────────────────────────────────
CREATE TABLE currency (
  code     TEXT PRIMARY KEY,            -- 'JPY', 'USD'
  exponent INTEGER NOT NULL             -- JPY=0, USD=2.  The ONLY place this lives.
);

CREATE TABLE account (                  -- one row per card / bank / cash / 電子マネー
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,            -- cash|bank|credit_card|emoney
  currency    TEXT NOT NULL REFERENCES currency(code),
  archived_at TEXT
);

CREATE TABLE category (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  parent_id TEXT REFERENCES category(id), archived_at TEXT
);

-- merchant identity: the normalization target for CSV import (§6)
CREATE TABLE merchant (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL UNIQUE
);
CREATE TABLE merchant_alias (           -- learned raw-descriptor → merchant map
  pattern     TEXT PRIMARY KEY,         -- normalized raw descriptor, or a LIKE pattern
  merchant_id TEXT NOT NULL REFERENCES merchant(id)
);

-- ─── 1. the subscription: IDENTITY ONLY. no price, no date, no interval. ──────
CREATE TABLE subscription (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,                      -- 'Netflix'
  merchant_id  TEXT REFERENCES merchant(id),       -- how it appears on statements
  category_id  TEXT REFERENCES category(id),
  account_id   TEXT REFERENCES account(id),        -- default payment method
  url          TEXT,
  cancel_url   TEXT,                               -- small feature, huge quality-of-life
  notes        TEXT,
  started_on   TEXT NOT NULL,
  ended_on     TEXT,                               -- NULL = still held  (§1.6)
  ended_reason TEXT,                               -- cancelled|replaced|trial_expired|price
  archived_at  TEXT,                               -- UI hygiene, orthogonal to ended_on
  created_at   TEXT NOT NULL, updated_at TEXT NOT NULL
);

-- ─── 2. the terms: effective-dated. trials, price changes, pauses, plan   ─────
--        changes and interval changes are ALL just rows here.           (§1.4)
CREATE TABLE subscription_term (
  id              TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscription(id) ON DELETE CASCADE,
  effective_from  TEXT NOT NULL,                   -- inclusive
  effective_to    TEXT,                            -- exclusive; NULL = current
  status          TEXT NOT NULL,                   -- trial|active|paused|cancelled
  plan_name       TEXT,                             -- 'Standard', 'Premium'

  amount_minor    INTEGER NOT NULL,                -- 0 for a free trial
  currency        TEXT NOT NULL REFERENCES currency(code),   -- BILLING currency (may be USD)

  -- recurrence: RRULE vocabulary, decomposed. NULL freq = irregular, no forecast. (§1.2)
  freq            TEXT,                            -- DAY|WEEK|MONTH|YEAR|NULL
  interval_n      INTEGER NOT NULL DEFAULT 1,      -- the multiplier: quarterly = MONTH,3
  anchor_date     TEXT NOT NULL,                   -- first real billing date = PHASE
  anchor_day      INTEGER,                         -- 1..31, or -1 = last day of month (§1.3)
  anchor_weekday  INTEGER,                         -- 0..6, for WEEK or with nth_week
  nth_week        INTEGER,                         -- 1..4, -1=last  → "2nd Tuesday"
  day_overflow    TEXT NOT NULL DEFAULT 'clamp',   -- clamp|skip|forward
  weekend_adjust  TEXT NOT NULL DEFAULT 'none',    -- none|back|forward

  -- reconciliation tuning, per term (§1.8 point 4)
  date_tolerance_days   INTEGER NOT NULL DEFAULT 5,
  amount_tolerance_bp   INTEGER NOT NULL DEFAULT 750,   -- basis points; 750 = 7.5%

  created_at TEXT NOT NULL,
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  CHECK (amount_minor >= 0),
  CHECK (anchor_day IS NULL OR anchor_day = -1 OR (anchor_day BETWEEN 1 AND 31))
);
CREATE UNIQUE INDEX ux_term_from ON subscription_term(subscription_id, effective_from);
CREATE INDEX ix_term_current ON subscription_term(subscription_id, effective_to);

-- ─── 3. the forecast: materialized over a BOUNDED horizon only.         (§1.7) ─
CREATE TABLE expected_charge (
  id              TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscription(id) ON DELETE CASCADE,
  term_id         TEXT NOT NULL REFERENCES subscription_term(id),
  occurrence_k    INTEGER NOT NULL,                -- index from term.anchor_date; anti-drift
  due_on          TEXT NOT NULL,                   -- RESOLVED: clamped + weekend-adjusted
  amount_minor    INTEGER NOT NULL,
  currency        TEXT NOT NULL REFERENCES currency(code),
  state           TEXT NOT NULL DEFAULT 'forecast',-- forecast|due|matched|missed|skipped
  txn_id          TEXT REFERENCES txn(id),         -- set when reconciled
  note            TEXT,
  UNIQUE (subscription_id, due_on)                 -- THE anti-duplicate guard
);
CREATE INDEX ix_exp_due ON expected_charge(due_on, state);

-- ─── 4. the ledger: ONE table for every transaction, subscription or not. ─────
CREATE TABLE txn (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES account(id),
  date          TEXT NOT NULL,                     -- posting date, YYYY-MM-DD, JST
  amount_minor  INTEGER NOT NULL,                  -- signed; negative = outflow
  currency      TEXT NOT NULL REFERENCES currency(code),   -- settlement currency (JPY)

  -- foreign currency, nullable (§1.8)
  orig_amount_minor INTEGER,
  orig_currency     TEXT REFERENCES currency(code),
  fx_rate_micro     INTEGER,                       -- derived: all-in rate ×1e6

  payee_raw     TEXT,                              -- descriptor EXACTLY as imported
  merchant_id   TEXT REFERENCES merchant(id),
  category_id   TEXT REFERENCES category(id),
  subscription_id TEXT REFERENCES subscription(id),-- nullable FK, as Actual's transactions.schedule
  memo          TEXT,
  source        TEXT NOT NULL,                     -- manual|csv
  import_hash   TEXT,                              -- dedupe key for CSV re-import
  created_at    TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_txn_import ON txn(account_id, import_hash) WHERE import_hash IS NOT NULL;
CREATE INDEX ix_txn_date ON txn(date);
CREATE INDEX ix_txn_sub  ON txn(subscription_id, date);

-- split one aggregated charge (App Store / Google Play / carrier) across subs (§6)
CREATE TABLE txn_allocation (
  id TEXT PRIMARY KEY,
  txn_id TEXT NOT NULL REFERENCES txn(id) ON DELETE CASCADE,
  subscription_id TEXT REFERENCES subscription(id),
  category_id     TEXT REFERENCES category(id),
  amount_minor    INTEGER NOT NULL
);

-- ─── 5. the wishlist: the actual differentiator (§3) ──────────────────────────
CREATE TABLE wishlist_item (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  target_amount_minor INTEGER NOT NULL,
  currency            TEXT NOT NULL REFERENCES currency(code),
  url                 TEXT, image_url TEXT,
  category_id         TEXT REFERENCES category(id),
  priority            INTEGER,
  target_date         TEXT,
  status              TEXT NOT NULL DEFAULT 'considering', -- considering|saving|bought|dropped
  bought_txn_id       TEXT REFERENCES txn(id),             -- closes the loop
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

-- THE link that makes "wishlist × subscriptions" more than two features in one app:
-- "cancelling these subs funds this item in N months"
CREATE TABLE wishlist_funding (
  wishlist_item_id TEXT NOT NULL REFERENCES wishlist_item(id) ON DELETE CASCADE,
  subscription_id  TEXT NOT NULL REFERENCES subscription(id) ON DELETE CASCADE,
  PRIMARY KEY (wishlist_item_id, subscription_id)
);
```

**Derived values — views, not columns:**

```sql
CREATE VIEW v_current_term AS
  SELECT t.* FROM subscription_term t
  WHERE t.effective_to IS NULL AND t.status IN ('trial','active');

-- annualized is canonical; monthly is annualized/12 at the display edge (§1.5)
CREATE VIEW v_subscription_runrate AS
  SELECT s.id, s.name, t.currency, t.amount_minor,
         t.amount_minor * CASE t.freq
            WHEN 'YEAR'  THEN 1
            WHEN 'MONTH' THEN 12
            WHEN 'WEEK'  THEN 52
            WHEN 'DAY'   THEN 365 END / t.interval_n AS annualized_minor
  FROM subscription s JOIN v_current_term t ON t.subscription_id = s.id
  WHERE s.ended_on IS NULL AND t.freq IS NOT NULL;
```

**Why this shape, in one paragraph.** `subscription` holds only what never changes, so it never needs versioning. `subscription_term` makes trials, price rises, pauses, plan changes and interval changes a single mechanism with a single query predicate — and makes last year's numbers permanently true. `expected_charge` gives reconciliation decisions, `missed` charges and one-off skips somewhere durable to live, with `UNIQUE(subscription_id, due_on)` making generation idempotent and `occurrence_k` making it drift-free. `txn` stays the one ledger that must tie out to your card statement, with subscription-ness as a nullable FK discovered after import. `txn_allocation` handles the one case Money Forward ME explicitly cannot (§3, §6). `wishlist_funding` is the join that turns three features into one product.

**Rejected alternatives, consolidated:**

| Rejected | Why |
|---|---|
| One table (`recurring_transaction` with generated children) | Cannot hold trial→paid or price history; conflates standing intent with immutable event; forces `WHERE is_forecast=0` into every aggregate. |
| Store an RRULE/iCal string in a column | RFC 5545 default **omits** invalid dates — `BYMONTHDAY=31` skips February entirely, which is never what billing means (§1.1). Also opaque to SQL. Borrow the vocabulary, store it decomposed. |
| `subscription_price_history` instead of `subscription_term` | Cannot express a monthly→annual switch, where price and cadence change together. Also needs a parallel mechanism for trials and pauses. One effective-dated table covers all of it. |
| `amount` + `interval` on `subscription`, overwritten on change | Silently rewrites your own history; kills the "how much have my subscriptions risen?" report, which is the app's best feature. |
| Separate `trial` table / `is_trial` + `trial_ends_at` columns | A trial is just a term with `amount_minor = 0`. Stripe itself moved from `trial_period_days` toward a distinct priced phase. |
| `deleted_at` soft-delete to represent cancellation | Cancellation is a domain event, not a data-management act; conflating them means you cannot tell "I cancelled Netflix" from "I typo'd this row". Use `ended_on` + `archived_at`. |
| Status enum on `subscription` with no dates | A cancellation today retroactively erases the subscription from last year's totals. |
| Materialize all future occurrences | Unbounded, and drifts. Bounded horizon + pure `f(anchor, k)`. |
| Auto-post generated transactions into `txn` | The real charge arrives by CSV anyway, so you guarantee duplicates and must dedupe regardless — a new failure mode for zero gain. Actual Budget defaults `posts_transaction = 0`. |
| Daily `fx_rate` table from an API | Produces a *worse* forecast than the rate implied by the subscription's own charge history, which already includes the issuer's 1.6–3.85% fee. Adds a job, a key, and a dependency. |
| Epoch timestamps for billing dates | A billing date is a calendar date in JST, not an instant. Firefly III needed a 2024 migration to add `date_tz` columns after getting this wrong. |

---

## 2. Money representation

**Recommendation: `INTEGER` minor units, with the exponent held once per currency. For JPY the minor unit is the yen, so `exponent = 0` and `1200` means ¥1,200 — not ¥12.00.**

### Why not the alternatives, specifically in SQLite + JavaScript

**Float / `REAL` — rejected.** `0.1 + 0.2 !== 0.3`; worse, summing the same set of amounts in a different order gives different results, so your monthly total depends on your `ORDER BY`. For a ledger whose entire value proposition is tying out against a bank statement, this is disqualifying. (The exponent-0 argument that "JPY amounts are integers anyway so floats are safe" is true for *storage* and false for *arithmetic* — amortization, tax, splits and FX all produce non-integers, and once one lands in a double the errors propagate.)

**`DECIMAL`/`NUMERIC` — not actually available in SQLite.** SQLite has no decimal type. `NUMERIC` is a *type affinity*, not a type: SQLite will store the value as `INTEGER` if it's integral and as `REAL` (an IEEE-754 double) otherwise. So declaring `NUMERIC(19,4)` in SQLite gets you silent float storage with a reassuring column type. **This is the single most important SQLite-specific fact in this section.** Contrast Maybe Finance, which uses `t.decimal "balance", precision: 19, scale: 4` throughout its `db/schema.rb` (confirmed, read 2026-10-13) — that is genuinely exact, *because it runs on PostgreSQL where `NUMERIC` is a real arbitrary-precision type*. Their choice does not transfer to SQLite. (SQLite does ship a `decimal` extension, but it is opt-in, not loaded by `better-sqlite3` by default, and loses you index-friendly comparison.)

**`TEXT` decimal strings — rejected.** Exact, but you cannot `SUM()`, `ORDER BY` or range-index them without casting to a type that reintroduces the problem. You'd push all arithmetic into JS and lose SQL aggregation, which is most of why you chose SQLite.

**A decimal library (decimal.js / dinero.js) over integers — unnecessary.** Every amount is integral in minor units, so `+`/`-`/`*` are exact in plain JS integers. Only *division* (amortization, splitting) is lossy, and that is a display/allocation concern solved by largest-remainder distribution, not by arbitrary precision. A library here is weight without benefit. (`Intl.NumberFormat` handles the *formatting* side, including JPY's zero fraction digits, for free.)

### JavaScript safety

JS `Number` is a double with exact integers up to 2^53 − 1 ≈ 9.007×10^15. In yen that is ~9 quadrillion — nine orders of magnitude past any personal finance figure. `better-sqlite3` returns SQLite `INTEGER` as a JS number when it fits in the safe range and otherwise requires its BigInt mode. **You will never approach that boundary**, so plain `number` is correct and you should not reach for `BigInt` (which would infect every arithmetic site and break `JSON.stringify`).

### How JPY's zero exponent interacts with a schema that may later hold USD

This is the part that bites, and it has a clean answer with real precedent.

**Confirmed precedent — Actual Budget does exactly this.** `packages/loot-core/src/shared/currencies.ts` (read 2026-10-13) carries a `decimalPlaces: number` field per currency:

```js
{ code: 'JPY', name: 'Japanese Yen',  symbol: '¥', decimalPlaces: 0, ... },
{ code: 'KRW', name: 'South Korean Won', symbol: '₩', decimalPlaces: 0, ... },
{ code: 'IRR', name: 'Iranian Rial',  symbol: '﷼', decimalPlaces: 0, ... },
{ code: 'USD', ... decimalPlaces: 2 },   // and ~all others
```

and `packages/loot-core/src/shared/util.ts`:

```js
export function amountToInteger(amount, decimalPlaces = 2) {
  return Math.round(amount * Math.pow(10, decimalPlaces));
}
export function integerToAmount(integerAmount, decimalPlaces = 2) {
  return integerAmount / Math.pow(10, decimalPlaces);
}
```

So a shipped, multi-currency, SQLite-backed budget app stores integer minor units with a per-currency exponent, and gives JPY exponent 0. That is your answer, validated in production.

**The practical rules:**

1. **The exponent lives in exactly one place** — the `currency` table — and is never duplicated into application constants.
2. **An amount is never passed around without its currency.** `{ amount_minor: 1200, currency: 'JPY' }`, never a bare `1200`. The exponent is meaningless without the code.
3. **Every money column is named `*_minor`.** This is not cosmetic: it is the only defence against the specific bug below.
4. **The bug to fear:** writing JPY as if it had exponent 2 (storing `120000` for ¥1,200). Everything looks fine until you display it or sum it with a USD-derived value, and then you are wrong by 100×. A single `amountToMinor(value, currency)` / `minorToDisplay(value, currency)` pair at the I/O boundary, plus the naming convention, prevents it. Add a `CHECK` on import that JPY values are plausible if you want belt and braces.
5. **Don't normalize to a common unit.** Resist storing everything in "USD cents" or "tenths of a yen" to dodge the exponent difference. You lose the invariant that `txn.amount_minor` is literally the number on the statement, which is the thing you're reconciling against.
6. **Rounding, when you must divide** (annual → 12 months, splitting a charge): compute with integers and distribute the remainder largest-remainder-first so the parts sum exactly to the whole. In JPY the residue is up to 11 yen on an annual figure — visible, so handle it rather than letting it float away.

**One nuance worth knowing:** the ISO 4217 minor unit for JPY is formally 0, which is why "¥1,200 is 1200 minor units" is correct and not a hack. There is no currency in practical use with an exponent above 4 (and only a handful at 3), so `INTEGER` with a per-currency exponent covers every case you could meet.

---

## 3. Competitive landscape

> All pricing below carries its source date. Japanese app pricing moves — MF ME's own first major increase in 12 years landed 2025-08-05 — so re-verify before quoting any of it.

### 3.1 Japanese household-budget apps

**マネーフォワード ME** — the incumbent, and the only one with a real subscription feature.

- **Subscription feature: 「サブスクレポート」.** Per [official support](https://support.me.moneyforward.com/hc/ja/articles/11442145377305): it lists the subscription services you paid for **in the previous month** and presents them as a report, grouped by category (動画, 音楽, ゲーム…). Reached via the gear icon on the home screen → 「先月のサブスクレポート」. Introduced for premium members in 2022 ([Impress Watch](https://www.watch.impress.co.jp/docs/news/1463008.html)).
- **Limitations, stated by Money Forward itself** — and these are the gaps your app can fill:
  1. **Premium-only.** 「本機能はプレミアムサービスでご提供しております」
  2. **Retrospective, not forward-looking.** It reports last month. It does **not** tell you "Adobe renews in 9 days for ¥6,480" — no renewal forecast, no trial-expiry warning.
  3. **Cannot see through aggregated billing.** Charges that can't be distinguished from other payments on the statement — explicitly **App Store and carrier billing (キャリア決済)** — are not supported. For a Japanese user this is a large fraction of real subscriptions, and it is unfixable by detection alone. Your `txn_allocation` table (§1.9) is the answer and nobody ships it.
  4. **Annual subscriptions show up late** — in the month *after* the payment is reflected. So an annual sub is nearly invisible in a monthly report.
  5. **Detection is from a maintained service allowlist**, centred on 動画配信 services. Niche or developer-oriented subscriptions won't be recognized.
- **Pricing (premium スタンダードコース), as revised 2025-08-05** ([official notice](https://support.me.moneyforward.com/hc/ja/articles/48081452703385)): App Store / Google Play billing **¥590/mo, ¥6,490/yr**; credit-card billing **¥540/mo, ¥5,940/yr**. Applied to existing subscribers at renewal from 2025-08-05 (card annual plans from 2025-09-05). 資産形成アドバンスコース unchanged.

**Zaim (家計簿くふうZaim)** — strong aggregation, no subscription feature found.

- Broad institution coverage, receipt OCR, balance graphs, budgets. Free tier covers the essentials; 家計簿の複数作成 is premium.
- **Pricing:** a 2025-08 campaign offered the **¥4,800/yr** premium plan (store billing) free for a year to switchers ([resemom.jp release, 2025-07-25](https://resemom.jp/release/prtimes/20250725/152205.html)), which pins the list price at that date. Current price unverified.
- **No subscription-tracking feature surfaced in any search.** Treat "Zaim has no dedicated subscription report" as **likely but not confirmed** — I could not reach zaim.net.
- **Developer API:** see §4. Historically there was a Zaim Developers program (the `pyzaim` PyPI package documents needing 「Zaim Developersでのアプリケーションの登録(コンシューマID、コンシューマシークレットの発行)」), but **I could not confirm its 2026 status.**

**OsidOri (オシドリ)** — couples/household focus. **974 financial institutions**; bank/card/e-money/securities/cash; dual personal + shared ledgers in one app; 割り勘; budgets; receipt OCR. Scored 4.02 and ranked 4th of 16 in [my-best.com](https://my-best.com/products/296867)'s testing. **Current pricing not found** in search; verify on the official site. No subscription feature surfaced.

**Dr.Wallet** — differentiates on **human operators visually transcribing receipts, claimed 99.98% accuracy**. Positioned as a record-keeping specialist; automatic whole-portfolio tracking is comparatively limited. **Pricing not found.** Irrelevant to subscriptions.

**シンプル家計簿 / 貯金メモ / マネーボックス etc.** — manual-entry apps, deliberately feature-light. 「貯金メモ」 is the closest thing to a goal tracker: target amount, current saved, average, remaining, days-to-target and progress %, with expense entry on the same screen ([app-liv](https://app-liv.jp/5340389/)). 「マネーボックス」 frames itself around 購入目標 — "shows the path to realizing your purchase goals" ([App Store JP](https://apps.apple.com/jp/app/id959555672)). **These are the nearest existing neighbours to your wishlist idea, and neither connects to subscriptions or to an imported ledger.**

**楽天家計簿** — bank/card linking with Rakuten points. No subscription feature surfaced.

### 3.2 Dedicated subscription trackers (JP market)

Per a Japanese comparison roundup ([vegcale.com, 2026-08-16](https://vegcale.com/2026/08/16/subscription-management-apps-comparison-2026/)) and App Store listings, accessed 2026-10-13:

| App | How it finds subscriptions | Pricing | Limitations |
|---|---|---|---|
| **サブトラ (Subtra)** | Scans **Gmail payment receipts** | Free + Premium **¥280/mo, ¥2,200/yr**, 7-day trial (as of 2026-08) | Only finds what emails you; no ledger; no wishlist |
| **Subcut** | Imports **bank/card statements**; assists cancellation | Not found | Statement-driven only |
| **Recur** | Manual entry | Not found | Deliberately minimal; iOS + Android |
| **サブマネ!** | Manual; pushes **trial-expiry reminders** | Free; iOS 18.6+ | Reminder-first, no analysis |
| **サブスク簡単管理** | Manual, input-assist focused | Free | iPhone/iPad only |
| **SubFlow** | Manual, "flow" visualization | Not found; iOS 17.6+ | Visualization-first |
| **Bobby** (intl., widely used in JP) | **Manual only** — explicitly does not connect to banks or auto-detect | Free with caps + **one-time IAPs ~$0.99–$2.99** (App Store data) | Free tier capped on subscription/category count; iOS-centric (one source claims Android — unresolved); no bank link; no sharing |

The roundup's own framing is telling: it advises choosing based on *"whether you want to see only subscriptions, or your whole household finances"* — i.e. **the market is bifurcated, and nobody spans both well.** It also flags that most of these comparisons are personal blogs, so verify pricing in-store.

**The structural pattern across all of them:** either (a) a subscription tracker with no ledger and no reconciliation (Bobby, Recur, サブマネ!, SubFlow, サブスク簡単管理), or (b) a household-finance app where subscriptions are a minor retrospective report behind a paywall (MF ME). **Nothing does forward-looking subscription forecasting reconciled against an imported ledger.** That is the gap your §1 schema is aimed at, and it's a real one.

### 3.3 Does anything combine a wishlist with expenses and subscriptions?

**Searched in English and Japanese. The answer is no — not as a shipped application.** This appears to be genuinely unserved.

**What exists:**

- **Notion/template territory only.** A Notion "Full Finance Tracker" bundles income tracker + expense tracker + **subscription tracker + wishlist and savings tracker** for ~$6.50 ([tsunestudios.gumroad.com](https://tsunestudios.gumroad.com/l/fullfinancetracker)). An "Ultimate Shopping Wishlist Tracker" spans *"wishlist items to budgets, expenses and more"* with budget tracker and expense progress bars ([theorganizerfreak.gumroad.com](https://theorganizerfreak.gumroad.com/l/ultimate-shopping-wishlist-tracker)). A "Smart Wishlist" template links items to your budget with a purchase log. **These have single-digit ratings** — they are evidence of *demand*, not of a served market.
- **Wishlist-as-savings-goal apps, no subscriptions, no ledger.** Goal Wallet — Wishlist Tracker (iOS): per-item target price and deadline, nothing about expenses or subscriptions ([App Store](https://apps.apple.com/us/app/id6464305325)). Wishey was a budgeting app with a wishlist but its French App Store listing says **no longer available**. In Japan, 貯金メモ and マネーボックス occupy this niche (§3.1).
- **Budget apps with savings goals** (YNAB's True Expenses, Zaim/MF budgets) treat a goal as *a category with a target amount*. **A goal is not a wishlist item**: it has no product, no URL, no price-watch, no priority ordering against other wants, and no link to what you'd give up to afford it.

**Why the combination is genuinely interesting, not just a feature bundle.** The three datasets share one join that nobody has exploited:

```
annualized cost of subscriptions you'd cancel  ──funds──>  wishlist item
```

Concretely, once §1.9's schema exists you get, for free: *"Cancelling Netflix (¥1,590/mo) and Adobe (¥6,480/yr ≈ ¥540/mo) funds the ¥42,000 headphones in 20 months"*, and the reverse: *"this ¥42,000 purchase equals 2.0 years of your current subscription spend."* That is `wishlist_funding` JOIN `v_subscription_runrate`. **Both numbers are hard to get today in any shipped app, in any market**, because no app holds a reconciled ledger, a forward subscription forecast, and a priced wishlist in the same database.

**Caveat on this finding.** Absence of search evidence is weaker than presence. I searched EN and JA across App Store listings, comparison roundups and template marketplaces, and found only templates. **I'd call it "very likely unserved" rather than proven** — the JP App Store's long tail is not fully indexed by web search, and I could not reach apps.apple.com directly to browse categories.

---

## 4. Bank/card auto-import in Japan

**Blunt answer: automated account aggregation is not feasible for a solo individual developer in Japan. CSV import is the pragmatic path, and it is the right call regardless.**

### 4.1 The regulatory wall

Retrieving a user's bank account information programmatically and passing it to software is a **registered activity** in Japan. Per the FSA ([金融庁 電子決済等代行業 申請ページ](https://www.fsa.go.jp/common/shinsei/dendai/), [dendaigyo_start.pdf](https://www.fsa.go.jp/common/about/pamphlet/dendaigyo_start.pdf)):

- Only businesses **registered with a 財務局 (Local Finance Bureau)** may conduct 電子決済等代行業 in Japan. 「登録を受けた事業者のみが、国内で電子決済等代行業を行うことができます」
- There are two categories. **第一号** = transmitting payment instructions. **第二号** = querying and providing account information (口座管理サービス) — **this is the account-aggregation case**, i.e. what a 家計簿 app does. (The mapping of "read-only aggregation" to 第二号 is my reading of the FSA's category description, consistent with how the industry describes it; **I did not read the statutory text — 銀行法第52条の61の2 et seq. — directly.**)
- Registration is not a form-filling exercise: the review covers 「当該者の体制等」 (the applicant's organizational arrangements), and registrants must additionally **conclude contracts with each bank** and implement 情報の安全管理措置 ([businesslawyers.jp](https://www.businesslawyers.jp/practices/878)).
- Applications go to the Finance Bureau covering the applicant's 主たる営業所又は事務所 — which presumes a business premises.

**Practical reading:** per-bank contracts, an audited security posture, and an organizational review are not things one individual clears for a personal project. I did not find any explicit prohibition on a 個人事業主 registering, so **I will not claim it is legally impossible — but I found zero evidence of an individual doing it, and the per-bank contract requirement alone makes it unreachable in practice.** That's the honest version.

### 4.2 Aggregation providers — all enterprise

**Moneytree LINK / MT LINK.** The most-cited Japanese aggregation platform. Everything found points to enterprise sales:

- Positioned as 金融インフラサービス for businesses, with named bank/card-issuer deployments (みずほダイレクトアプリ, 横浜銀行, 山形銀行, 三菱UFJニコス) — [atpress.ne.jp/news/151675](https://www.atpress.ne.jp/news/151675), [atpress.ne.jp/news/125163](https://www.atpress.ne.jp/news/125163).
- Separate product 「LINK API Private」 for corporates automating 入金消込 ([initial.inc company profile](https://initial.inc/companies/A-12055)).
- **No public pricing page, no self-serve signup, no sandbox, no individual-developer tier found in any search (EN or JA).** Their public [GitHub SDK docs](https://github.com/mt-micky/mt-link-javascript-sdk) document OAuth/PKCE flows *for developers who already hold credentials* and say nothing about obtaining them.
- Scale figures (2020 reporting): 2,700+ institutions, 2,200万 accounts, 55億 transactions — enterprise-grade, priced accordingly.

**Verdict: enterprise sales process. Pricing is not public, which for this category reliably means "not a solo-developer number." Confidence: high, but this is inference from the absence of a public tier, not a quoted refusal.** Email them if you want certainty; it costs one message.

**Zaim API.** A Zaim Developers program demonstrably existed (the `pyzaim` and `zaim` PyPI packages document registering an application for a consumer ID/secret). **I could not confirm whether it accepts new registrations in 2026** — zaim.net was unreachable from this environment and no announcement either way surfaced. Note that most of what search surfaces is *banks exposing 参照系 APIs to Zaim* (住信SBIネット銀行 2018, マネックス証券 2019, PayPay銀行 2018), which is the opposite direction. **Even if the Zaim API lives, it reads *your Zaim data*, not your banks** — so you'd be paying Zaim premium and inheriting its categorization. That makes it a sync source, not an aggregation solution. **Worth one check at zaim.net/developers; don't build a plan around it.**

**MF クラウド API.** Money Forward's published APIs are for its **business/accounting products (MFクラウド会計 etc.)**, aimed at corporate accounting integrations, not for reading a consumer's MF ME data. **No consumer-facing MF ME API found.** Stated as a negative finding; I could not reach moneyforward.com.

**Foreign aggregators (Plaid, etc.).** Plaid's recurring-transactions product is documented as available **in the US, Canada and UK**, and requires a product access request ([plaid.com/docs/transactions](https://plaid.com/docs/transactions/)). Japanese retail bank coverage is not there. Not an option.

### 4.3 CSV import — what's actually available

This is the feasible path, and it works today with no gatekeeper.

- **楽天カード:** 請求確定済み利用明細 downloadable as CSV, **per billing month**, and **only from the PC version of 楽天e-NAVI** ([official help](https://www.rakuten-card.co.jp/e-navi/p/rc/e-navi/statement/popup2.html)). Note the stated quirk: statements that display as two rows come through as two CSV rows — your importer must handle it.
- **三井住友カード (Vpass):** CSV download available; **no PDF export**, so CSV is the primary machine-readable route ([pay-route / vegcale comparison, 2026-09-14](https://vegcale.com/2026/09/15/credit-card-statement-pdf-download/)).
- **Banks:** most major Japanese banks offer 入出金明細 CSV from internet banking. Not individually verified here.
- **Encoding: assume Shift_JIS (CP932) and detect.** Japanese financial CSVs are commonly Shift_JIS; MF クラウド's own import FAQ offers a Shift-JIS/UTF-8 toggle and advises Shift-JIS for Excel ([biz.moneyforward.com FAQ](https://biz.moneyforward.com/support/account/faq/import-errror/ie04.html)). **Do not assume UTF-8.** Also expect BOM variants, CRLF, 全角 digits, and `¥`/`,` inside quoted amount fields.

**Design implications for your importer:**

1. **Per-source CSV profiles**, user-definable: column mapping, date format, sign convention (some issuers put outflows positive), encoding. One table, not one hardcoded parser per issuer.
2. **`import_hash` for idempotent re-import** — `sha256(account_id, date, amount, payee_raw, row_ordinal_within_duplicate_group)`. The ordinal matters: two genuinely identical ¥500 charges on the same day are legitimate and must not collapse. Enforce with `UNIQUE (account_id, import_hash)` (§1.9).
3. **Preserve `payee_raw` verbatim, forever.** It is the input to normalization (§6) and the only way to re-derive merchants when you improve the rules.
4. **Expect no merchant IDs, no categories, no FX breakdown** in most JP card CSVs. Some issuers do print 換算レート and 海外事務手数料 as separate line items (§1.8) — parse them if present, treat as absent otherwise.
5. **月末締め/翌月払い means the posting date in the CSV is not the charge date.** This is exactly why §1.7's reconciliation window should be ±5 days rather than Actual's ±2.

**One honest caveat on the whole section:** I could not load `link.moneytree.jp`, `docs.link.getmoneytree.com`, `zaim.net`, or `moneyforward.com` from this environment — egress policy blocked everything outside GitHub. The regulatory findings come from FSA pages surfaced in search and are solid; the "no individual tier exists" conclusions are **inferences from a consistent absence of public pricing/signup across multiple searches in both languages**, not quoted denials. If you want certainty on Moneytree or Zaim, one email each will settle it. My prediction is that the answer is "法人のみ" for Moneytree.

---

## 5. Deployment and persistence

### 5.1 The constraint, confirmed

**Vercel's own guidance states SQLite cannot be used on Vercel**, because serverless storage is ephemeral and SQLite needs persistent local storage; additionally each new function instance cannot share the same storage ([vercel.com/kb/guide/is-sqlite-supported-in-vercel](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel), accessed via search extraction 2026-10-13). A third-party survey adds that the Node runtime's filesystem is read-only except `/tmp` (max ~500 MB), and `/tmp` survives only while an instance stays warm ([codenote.net](https://codenote.net/en/posts/vercel-nextjs-embedded-database-prototyping/)) — **i.e. your database would silently disappear on cold start.** So `better-sqlite3` can *load* on Vercel; it just cannot *persist*. Confirmed, and it rules out (b)-with-SQLite entirely.

### 5.2 The options, with current numbers

| Option | Cost (source date) | Fits? | Notes |
|---|---|---|---|
| **(a) Small VPS + SQLite on disk** | さくらのVPS 1GB **~¥807/mo** on annual contract (2026-07-28 comparison, [atsoho.com](https://atsoho.com/apps/p/sakura-vps)); another source lists ¥980/mo. Hetzner CPX11 **€4.51/mo** (2 vCPU, 2 GB, 40 GB NVMe, 20 TB traffic) ([jisaku.com, 2026](https://jisaku.com/glossary/vps-hetzner-vultr-linode-digitalocean-contabo-2026)) | ✅ **best** | **Zero code change** — `better-sqlite3` works as-is. No cold start, no idle pause, one disk you own. You patch the OS. |
| **(b1) Vercel + Neon** | Free: **0.5 GB storage + 100 CU-hours per project/month**, up to 100 projects, autoscale ≤2 CU, **compute suspends after 5 min idle**; hitting a monthly limit **suspends compute until next cycle**. Paid Launch ~$0.106/CU-h + $0.35/GB-mo (post-Databricks cuts). (Sources checked late Sept 2026: [jetadmin.io/blog/neon-pricing](https://www.jetadmin.io/blog/neon-pricing/); aggregators disagree on paid rates — verify at neon.com/pricing) | ⚠️ | Requires rewriting the data layer to Postgres. Scale-to-zero means a cold DB start on every phone visit. 0.5 GB is ample. **No benefit over (a) for one user.** |
| **(b2) Vercel + Supabase** | Free: **500 MB DB**, 50k MAU, ~5 GB egress, 2 projects/org — and **projects are PAUSED after 1 week of inactivity, requiring manual restore from the dashboard** ([jetadmin.io 2026 guide](https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/)) | ❌ **reject** | **The 7-day pause is disqualifying.** A personal finance app you open twice a month would be dead on arrival every time. |
| **(c) Cloudflare Workers + D1** | Free: **5 M rows read/day, 100 k rows written/day, 5 GB storage account-wide**, resets 00:00 UTC; exceeding read/write limits **errors all queries until reset** ([developers.cloudflare.com/d1/platform/pricing](https://developers.cloudflare.com/d1/platform/pricing/), accessed 2026-10-13) | ✅ **best ¥0** | D1 is SQLite dialect, so most SQL ports. But `better-sqlite3`'s API does not — you'd rewrite the data access layer and run Next.js on Workers (OpenNext). No idle penalty, no cold DB, genuinely $0. Caution: *rows read* counts rows **scanned**, so an unindexed table scan burns budget fast. |
| **(d) Local only** | ¥0 | ❌ | Fails the phone requirement. *Unless* paired with Tailscale and an always-on machine — in which case it is (a) with worse uptime. |
| **(e) Local-first + Turso embedded replicas** | Free: 100 DBs, **5 GB storage, 500 M rows read/mo, 10 M written/mo**, ~3 GB syncs, 1-day PITR (revised free tier effective 2025-03-31, [turso.tech blog](https://turso.tech/blog/turso-cloud-debuts-the-new-developer-plan)); Developer **$4.99/mo** (9 GB, 2.5 B reads). A secondary tracker reports the top tier rose from $50 to $416.58/mo on 2026-02-04 ([costbench](https://costbench.com/changelog/turso-price-increase-2026-02/)) — unverified, but a signal about pricing volatility | ❌ for v1 | **Embedded replicas need a writable filesystem, so they don't work on Vercel serverless** — the one place you'd want them. On a VPS you don't need them. For a single-user, single-writer app this is complexity with no payoff. The top-tier price jump is also a reason not to depend on them. |
| Fly.io / Railway / Render | **Fly: no permanent free tier** (trial = 2 VM-hours or 7 days), ~$1.94/mo smallest VM, **volumes billed on provisioned size whether running or not**, +$2/mo dedicated IPv4, snapshot billing from Jan 2026. **Railway: no free tier**, Hobby $5/mo. **Render: free 750 instance-h/mo but free Postgres expires 30 days after creation** and free services sleep (~1 min wake). ([devtoolpicks.com 2026](https://devtoolpicks.com/blog/railway-vs-render-vs-fly-io-solo-developers-2026), [findstack](https://findstack.com/resources/railway-vs-render-vs-fly-io)) | ⚠️ | Fly with one small VM + small volume is a legitimate variant of (a) and keeps SQLite. Render's free DB expiry is disqualifying. |

### 5.3 Recommendation

**Self-host on a small VPS: SQLite on a persistent disk, Next.js behind a reverse proxy, access from the phone over Tailscale.** ~¥800–1,400/month.

Why this and not the others, against your four stated constraints:

1. **"Data is private financial info"** → it lives on one disk, under one account, with no third-party database operator in the path. (b)/(c)/(e) all hand your transaction history to a vendor. For *this* data class that is the decisive argument, and it is the one that should dominate.
2. **"Doesn't want to pay much"** → ~¥800/mo is real money but it is the floor for always-on-and-private. Cloudflare at ¥0 is the only cheaper serious option and costs you a rewrite.
3. **"Wants it on their phone"** → Tailscale's free Personal plan covers this: the phone is a *device*, not a seat, and the plan is reported as 6 users / unlimited user devices / 50 tagged resources (checked 2026-08-17, [ssdnodes.com](https://www.ssdnodes.com/learn/is-tailscale-free-plan-limits); older sources say 3 users/100 devices — **the exact numbers are unresolved, but all agree a personal phone + one server is free**). Your server never gets a public port, which removes the entire class of "my finance app got scanned and popped" risk. If you'd rather have a public URL, Caddy + automatic TLS + a single-user passkey/OIDC login is the alternative — strictly more exposed.
4. **Already have `better-sqlite3`** → **zero migration.** This is worth more than it sounds: options (b), (c) and (e) each require rewriting your data layer *before* you have a working app, which is how side projects die.

**Second choice, if ¥0 is a hard requirement: (c) Cloudflare Workers + D1.** D1's SQLite dialect means your schema and most queries survive; you rewrite the driver layer and deploy Next.js via OpenNext. Free limits are far beyond one user. Accept that your data sits with Cloudflare and that *rows-read* accounting punishes missing indexes.

**Explicitly rejected:** Supabase free (7-day inactivity pause — fatal for an app used weekly). Render free Postgres (expires after 30 days). Turso embedded replicas for v1 (incompatible with the serverless platform that would motivate them; needless for a single writer). Neon+Vercel (a rewrite and a cold start, for no gain over the VPS).

**Operational must-dos on the VPS:**
- `PRAGMA journal_mode = WAL` and `PRAGMA busy_timeout = 5000`. Note that `next dev` and some deployment setups run multiple Node processes; with `better-sqlite3` keep **one writer** — instantiate the DB once per process and funnel writes through a single route handler, not through parallel workers.
- **Backups: `VACUUM INTO '/backup/moneybags-YYYYMMDD.sqlite'` nightly** (safe on a live WAL database, unlike `cp`), then push encrypted off-box (`rclone` + `age`/`gpg`). This is financial data with no vendor backup behind it — **the backup is not optional, it is the main thing the VPS option asks of you in exchange for control.**
- Keep the DB file outside the deploy directory so a redeploy can't clobber it.
- Pin `better-sqlite3` and rebuild native bindings on Node upgrades.

### 5.4 Should this be a PWA? Yes — with eyes open about iOS.

**What it actually requires in Next.js 15:**

1. **Manifest — built in, no dependency.** Next.js 15 ships official PWA guidance and first-class manifest support via the App Router: an `app/manifest.ts` exporting a function typed `MetadataRoute.Manifest` (a static `app/manifest.json` also works) — [nextjs.org/docs/15/app/guides/progressive-web-apps](https://nextjs.org/docs/15/app/guides/progressive-web-apps). Add `display: 'standalone'`, `theme_color`, 192/512 icons, plus an `apple-touch-icon` and `viewport` meta.
2. **Offline/caching — not built in.** Next.js provides no service worker. **Use `@serwist/next`.** Maintenance status, confirmed hard from the npm registry on 2026-10-13:
   - `@serwist/next`: **latest `9.5.13`, published 2026-10-04** (nine days before this report); preceding releases 9.5.12 on 2026-07-22, 9.5.11 on 2026-05-03; a `10.0.0-preview.14` tag exists. **Actively maintained, on a regular cadence.**
   - `next-pwa` (shadowwalker): **latest `5.6.0`, registry last modified 2022-08-23.** Four years stale, 123 open issues, README still documents `pages/_offline.js` with no App Router guidance. **Dead — do not use it.**
   - Caveat from community reports: **Serwist is disabled in dev mode due to Turbopack incompatibility**, so the service worker only exists in production builds. Your `dev` script uses `--turbopack`, so expect to test offline behaviour via `next build && next start` only.
3. **Realistically, for this app, you may not need a service worker at all.** Your data lives server-side in SQLite; offline reads would require a client-side replica you don't have. **The high-value 90% of "PWA" here is just the manifest** — installable icon, standalone window, no browser chrome, no App Store. I'd ship the manifest first and add Serwist only when you actually want offline entry.

**Real iOS limitations today (all from vendor/third-party write-ups, 2025–2026 — Apple does not publish several of these):**

- **No install prompt.** Safari never offers installation; the user must manually 共有 → ホーム画面に追加. You must tell them, in-app. This is the #1 reason PWAs underperform on iOS.
- **Web Push works but is fragile.** Available since **iOS 16.4 (March 2023)**, along with the Badging API — but **only for home-screen-installed web apps**, and only after an explicit user gesture granting permission. Reports note delivery **may be unreliable after device restarts**. Declarative Web Push arrived in **Safari 18.4**, rendering a notification from a JSON payload without requiring the service worker to be running — an improvement, still install-gated. ([magicbell.com guide](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide), [monterail](https://monterail.com/blog/pwa-for-apple-ios))
- **No Background Sync**, and no background execution. Nothing runs when the app is closed.
- **Storage eviction.** WebKit uses LRU-style eviction keyed on last user interaction/storage operation. Quota figures in circulation (~50 MB for non-installed) are **third-party estimates and mutually inconsistent** — Apple hasn't published exact numbers. Treat client-side storage as a cache, never as the system of record.
- One outlier post claims iOS 17.4 reduced installed PWAs to bookmarks; **other sources contradict it and I'd disregard it** (it conflates the briefly-threatened EU change, which Apple reversed).

**Consequence for your renewal reminders — this matters, so decide it now.** Do **not** architect notifications around iOS Web Push. Options in order of reliability: (1) a **server-side cron on the VPS** that emails or LINE-notifies you N days before each `expected_charge.due_on` — fully reliable, trivial given you already have a server; (2) a prominent "due soon / trial ending" badge rendered on app open; (3) Web Push as a nice-to-have on top. **Option (1) is also an argument for the VPS**: a serverless deployment has no natural place for that cron without adding another service.

---

## 6. Recurring-cost detection from imported CSV

**No mature open-source library exists** for this in JS or Python — I searched specifically and found only write-ups, one Claude skill, a patent, and commercial APIs. Budget ~200 lines of your own. The good news is the algorithm is well understood and the published tolerance constants are consistent.

### 6.1 The three-stage pipeline

**Stage 1 — Merchant-name normalization.** The hardest and highest-leverage stage; raw statement descriptors are noisy and one service appears under several variants.

Generic steps ([subtracker.io/build/recurring-charge-detection](https://subtracker.io/build/recurring-charge-detection)): strip reference numbers, locations and processor prefixes, then map to a canonical merchant before any clustering.

**Japan-specific steps that generic guides omit — these matter more than the generic ones for your data:**
- **`String.prototype.normalize('NFKC')` first.** JP card CSVs mix 半角カナ (`ｱﾏｿﾞﾝ`) with 全角 (`アマゾン`), and 全角 digits/latin (`ＡＭＡＺＯＮ`, `１２３`). NFKC folds all of these. Without it, the same merchant splits into three groups and detection silently fails.
- **カタカナ ↔ latin aliasing** is not solvable by normalization (`ネットフリックス` vs `NETFLIX.COM`). This needs the learned `merchant_alias` table — which is fine, because you confirm each mapping once and it is permanent.
- Strip the recurring JP noise: trailing `／` segments, `（カ` / `(ド` corporate-form abbreviations, store/branch codes, 利用日 embedded in the descriptor, `＊` separators.
- Strip aggregator prefixes: `AMAZON DOWNLOADS`, `PAYPAL *`, `APPLE COM BILL`, `GOOGLE *`, `AMAZON WEB SERVICES`.
- Then uppercase, collapse whitespace, and write to `merchant.normalized_name`.

Keep `payee_raw` untouched forever so you can re-run improved rules over history (§4.3).

**Stage 2 — Interval clustering.** Per normalized merchant: sort dates, diff consecutive, find the dominant gap with low variance, match against a cadence table. Published tolerances (from the `lyndonkl/claude` `recurring-charge-detector` skill, ~135 stars — a Claude skill rather than a package, but the one concrete published table I found):

| Cadence | Days | Tolerance |
|---|---|---|
| weekly | 7 | ±2 |
| biweekly | 14 | ±3 |
| monthly | 30 | ±4 |
| quarterly | 91 | ±10 |
| semiannual | 182 | ±14 |
| annual | 365 | ±21 |

**Improvement on that table, for monthly specifically: prefer day-of-month equality over the 30±4 window.** Charges on the 31st produce gaps of 28–31 days, which 30±4 covers — but 28-day and 31-day gaps also match "weekly×4" and other noise. Testing "same day-of-month (or both clamped to month-end)" is far more specific and directly reuses your `anchor_day` logic from §1.3. Fall back to 30±4 when day-of-month varies (common when weekend adjustment or posting lag is involved).

**Stage 3 — Amount tolerance.** Exact match, or within a band. **Use ±7.5%** — that is Actual Budget's shipped constant (`getApproxNumberThreshold` = `Math.round(Math.abs(number) * 0.075)`, confirmed from source, §1.1). Widen to ~±15% for suspected foreign-currency charges (§1.8). A consistent *step* in amount is not a rejection — it is a **price change**, and the right response is to propose a new `subscription_term`.

**Confidence and promotion.** Require **≥3 confirming occurrences** before auto-proposing. This threshold is independently corroborated:
- the `recurring-charge-detector` skill requires ≥3;
- Plaid treats a stream as **matured at ≥3 occurrences**, and tags streams with fewer as **`early_detection`** in the `status` field ([plaid.com/blog/recurring-transactions](https://plaid.com/blog/recurring-transactions/));
- Spade's enrichment docs state it needs **3 or more transactions with matching characteristics** ([docs.spade.com](https://docs.spade.com/reference/recurring-transaction-guide));
- US5918216 (1999, expired) claims the 2-gap version: if the first and second gaps both match a predetermined period within tolerance, a recurring transaction is identified ([patents.google.com/patent/US5918216](https://patents.google.com/patent/US5918216)).

Score from interval variance + amount stability + occurrence count. Show 2-occurrence candidates as "possible", 3+ as "likely".

### 6.2 Known failure modes

- **Aggregated billing is unsolvable by detection.** Apple/Google/PayPal/carrier charges bundle several subscriptions into one line — subtracker.io flags this explicitly, and **Money Forward ME documents it as an unsupported case in its own product** (§3.1). No algorithm fixes it. **Your answer is the `txn_allocation` table (§1.9): let the user split one ¥2,480 App Store charge into three subscriptions once, then reuse that split as a learned rule.** This is a genuine competitive advantage, not a workaround.
- **Variable-amount recurring charges** (utilities, usage-based cloud bills) pass the interval test and fail the amount test. Treat as recurring with `amount_tolerance_bp` raised, flagged "variable".
- **Annual subscriptions need 3 years of history** to reach 3 occurrences. Practically: let the user mark a single charge as annual manually, and let detection handle the rest. Don't try to be clever here.
- **Posting-date jitter** from 月末締め cycles inflates gap variance. Mitigated by preferring day-of-month matching.

### 6.3 Borrowable references

| Source | Take |
|---|---|
[`lyndonkl/claude` recurring-charge-detector](https://claudeskills.info/skills/lyndonkl/claude/recurring-charge-detector/) | The cadence/tolerance table above; ≥3-occurrence rule; lifecycle states; annualized-cost computation. A SKILL.md, not a package. |
| [Plaid recurring transactions](https://plaid.com/blog/recurring-transactions/) | API *shape* worth copying: "streams" grouped by description+amount+cadence, with `status` (`early_detection` vs matured), `average_amount` and a latest amount, and inflow/outflow tagging. Model your detector's output on this. Note a third-party SDK names the latest-amount field `newest_transaction_amount`, so exact field names vary by version. |
| [Spade recurring guide](https://docs.spade.com/reference/recurring-transaction-guide) | Confirms the ≥3 threshold; returns interval-in-days and expected-next-payment — both worth emitting. |
| [subtracker.io write-up](https://subtracker.io/build/recurring-charge-detection) | Clearest prose description of normalize → dominant-gap → tolerance, plus the aggregated-billing caveat. |
| [US5918216](https://patents.google.com/patent/US5918216) | Interval-matching logic, 1999, **expired** — safe to read and borrow. |
| Actual Budget source | `getApproxNumberThreshold` (7.5%), `getScheduleOccurrenceMatchStartDate` (±2 days), and the `is`/`isapprox`/`isbetween` condition vocabulary. The only *shipped, open-source* reconciliation tolerances I found. |

**Design rule above all: always propose, never auto-commit.** Detection creates *candidate* subscriptions in a review queue; the user confirms, and confirmation writes a `merchant_alias` row so the mapping is permanent. A false-positive subscription silently inserted into a finance app destroys trust in the totals faster than any missing feature.

---

## Confidence notes

**Confirmed by reading primary source code on 2026-10-13:** Firefly III schema and the `min(dayOfMonth, daysInMonth)` clamp (3 call sites); Actual Budget's `schedules`/`schedules_next_date`/`transactions.schedule` schema, `posts_transaction` default 0, the six-state status model, the 7.5% amount threshold, the −2-day match window, and the recur-config shape; GnuCash's `PeriodType`/`WeekendAdjust` enums and `recurrenceSet()` normalization rules; Actual's per-currency `decimalPlaces` with **JPY = 0**; Maybe Finance's `decimal(19,4)` + `exchange_rates` table and the absence of user-facing subscription tracking; npm publish dates for `@serwist/next` (9.5.13, 2026-10-04) and `next-pwa` (2022-08-23).

**From search-engine extraction of vendor pages (hosts unreachable from this environment — verify before quoting):** all Stripe behaviour; RFC 7529 `SKIP` value names; all cloud pricing and free-tier limits; Next.js PWA guide contents; Money Forward ME feature details and 2025-08-05 pricing; Zaim/OsidOri/Dr.Wallet details; FSA 電子決済等代行業 requirements; Japanese card CSV specifics.

**Explicitly inferred, not confirmed:**
- Stripe `Price` immutability (inferred from inline-price-creation API shape + the existence of `SubscriptionSchedule` phases).
- Mapping of read-only account aggregation to 電子決済等代行業 **第二号** (consistent with the FSA category description; statutory text not read).
- "Moneytree LINK has no individual-developer tier" and "Zaim Developers is closed/irrelevant" — inferred from a consistent absence of public pricing/signup across EN+JA searches, **not** from a quoted statement. One email to each would settle both.
- "Zaim has no subscription-tracking report" — negative search result only.
- "No app combines wishlist + expenses + subscriptions" — searched EN and JA across store listings, roundups and template marketplaces; found only Notion templates. **Very likely unserved, not proven**; the JP App Store long tail is not fully web-indexed and apps.apple.com was not directly reachable.
- Tailscale free-plan exact device/user counts (sources disagree; all agree a phone + one server is free).
- Turso's 2026-02 top-tier price change (single secondary source).
