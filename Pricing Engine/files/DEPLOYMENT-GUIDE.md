# Pricing Engine — Setup Guide

Written to be followed start to finish. Steps 1–5 are copy-paste and take
about an hour. Step 6 is the part that needs code written.

---

## First, the mental model

Three pieces, and it helps to know what each one does before you start.

**The rule book** — a table called `pricing_rules` holding your margin bands,
adjusters and floors. Locked so only you can read it.

**The calculator** — a function called `price_quote`. Your staff's screen sends
it the cost, weight and dimensions. It opens the rule book, works out the
price, and sends back *only* the answer. Staff never see the rule book, even
if they go looking in their browser.

**The logbook** — a table called `quotes`. Every quote anyone saves lands here.
Once enough have piled up, you run a report that says "your team is actually
charging 92% on this band, not the 105% in the rule book" and you decide
whether to update it.

That's the whole system. The rest is plumbing.

---

## Step 1 — Create the project

If you'd rather keep this separate from the invoice app, make a new one.
Separate is cleaner: different users, different access rules.

1. Go to **supabase.com** and sign in
2. **New project**
3. Name it something like `iff-pricing`
4. Set a database password and **save it somewhere safe** — you won't be shown
   it again, and you'll want it eventually
5. Region: **East US** or **Canada Central**, whichever is offered
6. Click create and wait about two minutes

---

## Step 2 — Run the schema

1. In the left sidebar, click **SQL Editor**
2. Click **New query**
3. Open `iff-pricing-schema.sql`, select all of it, copy
4. Paste into the editor
5. Click **Run** (or Ctrl+Enter)

You want **Success. No rows returned**. That's the correct result — the script
builds things rather than fetching them.

**If you get an error**, read the first line. It names the problem. The most
common one is running the script twice, which gives you "already exists"
errors — harmless, and it means the first run worked.

### Confirm it worked

New query, paste this, Run:

```sql
select version, active, note from pricing_rules;
```

One row, version 1, active `true`. Your starting rule book is in place.

---

## Step 3 — Create logins

Each person gets their own account. This matters more than it sounds — it's
what lets you see who is quoting consistently and who isn't.

### 3a. Create the users

1. Left sidebar → **Authentication** → **Users**
2. **Add user** → **Create new user**
3. Email and a temporary password. Turn **Auto Confirm User** on, otherwise
   they'll sit waiting for a confirmation email.
4. Repeat for everyone — yourself, Catalina, Lorena, Max, Maqsood

### 3b. Give each one a role

Creating a login doesn't grant access on its own. Each person needs a row in
`profiles` saying who they are and what they can see.

SQL Editor → New query. Change the emails and names to the real ones, then Run:

```sql
-- You: full access, can see rules and everyone's quotes
insert into profiles (id, full_name, role)
select id, 'Uzair', 'admin' from auth.users where email = 'uzair@iffcargo.com';

-- Staff: can quote, cannot see rules or anyone else's quotes
insert into profiles (id, full_name, role)
select id, 'Catalina', 'rep' from auth.users where email = 'catalina@iffcargo.com';

insert into profiles (id, full_name, role)
select id, 'Lorena', 'rep' from auth.users where email = 'lorena@iffcargo.com';

insert into profiles (id, full_name, role)
select id, 'Max', 'rep' from auth.users where email = 'max@iffcargo.com';
```

The `select id ... where email =` bit looks up the internal ID for you, so you
don't have to copy long ID strings by hand.

### Confirm

```sql
select full_name, role from profiles order by role, full_name;
```

Everyone listed, exactly one admin — you.

---

## Step 4 — Test the calculator

Before anyone touches it, price the shipment you already know the answer to.
This is the 35 lb, 24×24×24 box from Georgetown to Calgary at $505.62 cost.

SQL Editor → New query → Run:

```sql
select price_quote(
  505.62,                                    -- carrier cost
  'xb',                                      -- scope: dom, xb, or intl
  'courier',                                 -- mode: courier or ltl
  'Package',                                 -- packaging
  '[{"qty":1,"l":24,"w":24,"h":24,"wt":35}]'::jsonb
);
```

You'll get a block of results. Look for:

- `"sell"` — the recommended price
- `"chargeable_wt": 99.5` — dim weight taking over from the 35 lb actual
- `"density_pcf": 4.4`
- `"flags"` — the warnings, including the low-density one

If those numbers appear, the engine is running. Everything else is
connecting a screen to it.

### Try a second one

Change the inputs and run it again — a 2 lb envelope, a 3-skid LTL move.
Ten minutes of this is worth an hour of reading. You'll see quickly whether
the floors and bands behave the way you expect, and it costs nothing to find
out now rather than after your staff are using it.

---

## Step 5 — Get your connection details

The screen your staff use needs two values to talk to the database.

1. Left sidebar → **Settings** (gear) → **API**
2. Copy **Project URL** — looks like `https://abcdefgh.supabase.co`
3. Copy the **anon public** key — a long string of characters

Paste both into a note for later.

**The anon key is safe to put in a web page.** That's what it's for. It only
grants what your access rules allow, which is why the rules matter more than
the key. The `service_role` key on that same page is the dangerous one — it
bypasses everything. Never put that in a web page, and don't email it.

---

## Step 6 — The screen

This is the part that needs code. The current tool does its own arithmetic in
the browser, which is exactly what has to change — the maths moves to the
database and the browser becomes a form.

What has to happen:

- A login screen
- The line-item form stays as it is
- Instead of calculating, it calls `price_quote` and displays what comes back
- Save calls `save_quote`
- The margin bands, adjusters and quote log come out of the rep screen entirely
- A separate admin page for you, showing the calibration report

Then deploy to Netlify the same way as the invoice app.

I can write this for you — say the word and it'll be ready to drop into
Netlify. It's the last piece.

---

## Running it, once it's live

### Checking the calibration

Roughly monthly. SQL Editor:

```sql
select * from calibration_report();
```

A row per band, showing what the rule book currently says, how many quotes
you've logged, what your team actually charged, and what it suggests changing
to. Bands without enough data say so and stay put.

Read the `status` column before anything else. "single rep — review before
applying" means one person's habit is being mistaken for a house rate.

### Changing the rule book

Nothing changes automatically. You decide, then publish:

```sql
select publish_rules(
  '[{"max":40,"mk":170},{"max":75,"mk":140},{"max":125,"mk":120},
    {"max":250,"mk":100},{"max":500,"mk":88},{"max":1000,"mk":72},
    {"max":999999999,"mk":58}]'::jsonb,
  null, null,
  'March calibration - 6 months of data'
);
```

Each `max` is the top of a cost band, each `mk` the markup percentage. Type
the numbers you want, keeping the same shape. It creates a new version, makes
it active, and retires the old one — which stays on file, so you can always
answer why a quote in March was priced the way it was.

### Who is quoting consistently

```sql
select * from rep_consistency;
```

Sorted by spread, widest first. High spread means that person's pricing varies
most from shipment to shipment. High override percentage means they're
routinely disagreeing with the engine — worth a conversation either way, since
sometimes the engine is the one that's wrong.

### Where margin is actually going

Once you start filling in `actual_cost` — what the carrier really invoiced,
after reweighs and accessorials:

```sql
select * from margin_realization;
```

The `avg_leakage` column is the gap between the margin you quoted and the
margin you kept. That number is usually the most useful one in the whole
system, and it only exists if someone enters the real invoice cost.

---

## If something breaks

**"permission denied for table pricing_rules"** — correct behaviour. A rep
account tried to read the rule book. Nothing to fix.

**"no active pricing rules"** — no rule version is switched on. Run:
`update pricing_rules set active = true where version = 1;`

**"a reason is required when the final price differs"** — someone changed the
price without picking a reason. Deliberate: it's what keeps the calibration
honest.

**"admins only"** — your profile row says `rep`. Fix with:
`update profiles set role = 'admin' where full_name = 'Uzair';`

**Staff see no quotes but they saved some** — expected. Reps only see their
own. Admins see all.
