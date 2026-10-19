# drinksunboy.com: a plain-English map

This repo holds two things:

1. **The Shopify theme**: everything you see on drinksunboy.com. It's Shopify's free "Dawn" theme (v16) with a SUNBOY layer on top. Files whose names start with `sb-` or `sunboy-` are ours; almost everything else is stock Dawn and rarely needs touching.
2. **The finder service** (`finder/`): a small back-end on Vercel (`sunboy-finder.vercel.app`) that the site calls for store locations, events, the trade shop and Slack approvals. Shopify can't do those things on its own.

---

## How changes get to the live site

| You change… | Where | What happens |
|---|---|---|
| Words, photos, links, section order | Shopify admin → Online Store → **Customize** | Live immediately. Shopify copies the change back to this repo as a "shopify[bot]" commit. |
| Code (layout, styling, behaviour) | This repo, branch `main` | Shopify pulls new commits into the live theme within a few minutes. |
| The finder service (`finder/`) | Deployed to Vercel (by Claude, with Yair's OK) | Shopify ignores this folder. |
| Keys and switches | Vercel → sunboy-finder → Settings → Environment Variables | Takes effect after a redeploy. |

**Good habits**
- Text edits in Customize are safe. GitHub keeps every version, so anything can be rolled back.
- Don't edit the same page in Customize while Claude is changing it in code. Say "editing" / "done editing".
- Known quirk (Oct 2026): Shopify's GitHub sync sometimes silently skips a `.liquid` file. If a code change doesn't show up, paste it in Online Store → ⋯ → **Edit code**. Shopify then syncs it back here.

---

## Pages and what they're built from

Page templates live in `templates/`. A page uses the template named by its "Theme template" setting (Shopify admin → Pages → the page → Theme template). Several templates still carry odd `pf-…` names left over from PageFly. They're ours now; the names just stuck.

| Page | Template | Sections (top to bottom) |
|---|---|---|
| **Homepage** | `index.json` | Photo tiles (`sb-mood`) → statement → flavor lineup → Find SUNBOY band → three truths → origin story → merch row (`sb-goods`) → press bar (hidden) |
| **Flavor pages** (/pages/guava etc.) | `page.contact.json` (multi-purpose, see below) | Flavor hero → nutrition label → "flip before you sip" note → FAQ → flavor lineup |
| **Variety packs** | `page.classic-variety-pack.json`, `page.refresher-variety-pack.json` | Pack hero + one row per flavor → note → Find SUNBOY band → lineup |
| **Find Us** | `page.pf-b5ac4275.json` | Store finder map (`sb-finder`) → lineup |
| **Events** | `page.pf-ce7f7457.json` | Events calendar (`sb-events`) |
| **Our Story** (/pages/about-us) | `page.pf-7f7457d1.json` | Story opener → pinned-photo chapters → scrolling bar → Instagram strip |
| **Distributor Shop** | `page.pf-1550554b.json` | Trade shop (`sb-trade`) |
| **RSM / Team Portal** | `page.pf-d8eebc48.json` | Trade shop in team mode (`sb-trade`) |
| **Trade Admin** (hidden) | `page.trade-admin.json` | Approvals + QuickBooks invoicing (`sb-trade-admin`) |
| **Your Account** (/pages/account) | `page.contact.json` | Orders + profile (`sb-account`) |
| **Accessibility, plain pages** | `page.contact.json` / `page.json` | Page text (+ contact form) |
| **Merch product pages** | `product.json` | Product → FAQ → disclosures → "You may also like" + Shop all |
| **Merch collection** | `collection.json` | Banner → product grid |

`page.contact.json` holds several page types in one template. Each section shows only where it belongs:
- the account section, only on /pages/account;
- the flavor sections, only on pages that have a SUNBOY "hero line";
- the plain text and contact form, everywhere else.

`page.flavor.json` is a clean flavor-only copy you can switch flavor pages to.

**On every page:**
- Header (`sections/header-group.json`): announcement messages + the scrolling yellow bar (`sb-marquee`).
- Footer (`footer-group.json`): newsletter signup + footer + legal line.
- Age gate, signup popup: `snippets/sb-age-gate.liquid`, `sb-signup-popup.liquid`. Turn them on/off and edit their words in Customize → Theme settings → "SUNBOY age gate & signup".

---

## Where each kind of text lives

| Text | Edit it in |
|---|---|
| Homepage, packs, Our Story, Find Us/Events headings, FAQs, header messages, footer | **Customize** (click the section) |
| Flavor names, hero lines, colours, nutrition facts | Shopify admin → **Pages** → the flavor page → Metafields (SUNBOY), and Content → Metaobjects → Nutrition facts |
| Per-product FAQ | Products → the product → Metafields → FAQs |
| Merch product descriptions and prices | Shopify admin → **Products** |
| Age gate and popup wording | Customize → Theme settings → SUNBOY age gate & signup |
| Distributor/Team portal wording, buttons, order messages | Code: `assets/sunboy-trade.js` (ask Claude) |
| Event descriptions ("Free tastings in store…") | Code: `finder/lib/events.js` (ask Claude) |
| Slack order messages | Code: `finder/lib/slack.js` (ask Claude) |

---

## The custom pieces, one line each

**Sections** (`sections/`)
- `sb-mood`: editorial photo tiles (homepage top).
- `sb-statement`: big statement with illustration.
- `sb-flavor-lineup`: the flavor can cards.
- `sb-find-us`: "Find SUNBOY" band: ZIP box + retailer logos.
- `sb-pillars`: the three truths (coconut water / fruit / spiked).
- `sb-split`: photo + text block.
- `sb-goods`: homepage merch row. Only shows items in the "SUNBOY Goods" collection and never ones tagged `internal-use`.
- `sb-press`: "As seen in" scrolling logos.
- `sb-marquee`: the yellow scrolling message bar.
- `sb-flip`: the "flip before you sip" note.
- `sb-flavor-hero`, `sb-nutrition`: flavor page top and nutrition label.
- `sb-pack`: variety-pack page.
- `sb-faq`: FAQ accordion.
- `sb-story-hero`, `sb-story`: Our Story.
- `sb-insta`: Instagram strip.
- `sb-finder`: Find Us map. Store list comes from VIP/SRS sales data, hours from Google, events from Connecteam; map by Mapbox.
- `sb-events`: events calendar (from Connecteam).
- `sb-events-strip`: homepage events teaser. Currently not used.
- `sb-trade`: distributor + team shop.
- `sb-trade-admin`: approvals and invoices.
- `sb-account`: account page.
- `sb-newsletter`, `sb-legal`: footer signup and legal line.

**Snippets** (`snippets/`)
- `sb-age-gate`, `sb-signup-popup`, `sb-mailchimp`: age gate, popup, and the code that sends signups to Mailchimp.
- `sb-flavor-card`, `sb-nutrition-label`: reusable flavor card and label.
- `sb-flavor-redirect`: can products aren't sold online, so their product pages forward to the flavor page.
- `sb-portal-redirect`: sends distributors/reps who land on Shopify's account pages to their portal.
- `sb-acct-js`, `sb-sun`: account-page helper, small sun icon.

**Styling and scripts** (`assets/`)
- `sunboy-brand.css.liquid`: fonts (Nobel) and brand colours.
- `sunboy-sections.css`: look of all SUNBOY sections.
- `sunboy-trade.css` / `.js`: trade shop.
- `sunboy-trade-admin.js`: Trade Admin.
- `sunboy-events.js`: shared events helpers.
- `sb-*.webp/png`: cans, bands, packs and Sunman illustrations.

Colour schemes (Customize → Theme settings → Colors): 1 white/brown, 2 teal, 3 yellow, 4 brown, 5 cream.

---

## The trade shop: how an order flows

Who can order is set by **customer tags** in Shopify:
- `trade`: distributor.
- `rsm` or `internal`: team.
- `trade-admin`: can approve.
- `trade-test`: test account. Its orders stay drafts and never ship.

A distributor's co-op % lives in the customer metafield "coop_percent" (default 50).

1. **Distributor** signs in → Distributor Shop. Prices shown at SUNBOY cost, minus their co-op share. Shipping is free at $100+ (SUNBOY cost), otherwise $15.
2. They click **Submit order**. The order goes **straight to Rack'd** (ShipHero), marked Net 30, and an **alert** posts in Slack **#trade-orders**.
3. **Reps/team** (and anyone ordering **packaging cartons**) click **Send for approval**. Their order waits as a Shopify draft and posts in **#trade-orders** with **Approve / Deny** buttons. You can also reply in the thread "approve" or "deny: reason".
4. **Only Yair and Sam can decide.** That means their Slack member IDs are listed in `SLACK_APPROVERS`, or their Slack email matches a `trade-admin` customer.
   - **Approve:** the draft becomes a real order and goes to Rack'd.
   - **Deny:** the draft is kept, marked not approved, with the reason.
   - The Slack message updates either way. The **Trade Admin** page does the same job.
5. **Invoicing:** orders that owe money show up on Trade Admin as "ready to invoice". **Create invoice** makes an *unsent* QuickBooks invoice, and only when clicked. Nothing here ever emails a customer.

Product tags that matter:
- `trade`: shows in the trade shop.
- `distributor-only` / `team-only`: limits who sees it.
- `requires-approval`: always needs approval (cartons).
- `internal-use`: never shown on the public homepage row.

---

## The finder service (`finder/`)

A handful of small web endpoints on Vercel. The site calls them from the browser.

| Address | What it does |
|---|---|
| `/api/stores`, `/api/geocode`, `/api/hours`, `/api/where`, `/api/brands`, `/api/coverage`, `/api/config` | Find Us: stores that recently bought SUNBOY (VIP/SRS), store hours (Google), the visitor's rough location, map settings |
| `/api/events` | Public events from Connecteam: tasting/event jobs only, never shift notes, staff shown only if they opted in. Refreshed every ~10 minutes. |
| `/api/trade/me`, `/api/trade/order` | Trade shop: who's signed in, their catalog and past orders; placing orders |
| `/api/trade/admin` | Trade Admin: approvals, QuickBooks invoices |
| `/api/qbo/callback` | QuickBooks sign-in return |
| `/api/slack` | Slack button clicks, the Deny pop-up and thread replies |
| `/api/health` | Quick "is everything configured" check |

Code layout:
- `api/`: the endpoints.
- `routes/`: small endpoints bundled into one, because Vercel's free plan allows 12 functions.
- `lib/`: the actual logic: `vip` (store data), `events` + `connecteam`, `trade` + `order` + `approve` (shop rules), `slack`, `qbo` + `invoice` (QuickBooks), `shopify` (talks to the store).

**Settings in Vercel** (names only; values are secret):

| Group | Variables |
|---|---|
| Shopify | `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` |
| Trade shop | `TRADE_SIGNING_KEY` (sign-in link between site and service), `TRADE_FREE_SHIP_MIN` (100), `TRADE_SHIP_UNDER` (15), `TRADE_APPROVE_ALL` (unset = only team/cartons need approval; `on` = every order) |
| Slack | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APPROVERS` (member IDs), `SLACK_CHANNEL` (optional, default trade-orders) |
| Find Us | `VIP_CUST_ID`, `VIP_SHARED_CODE`, `GOOGLE_PLACES_API_KEY`, `MAPBOX_PUBLIC_TOKEN` |
| Events | `CONNECTEAM_API_KEY` |
| QuickBooks | `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET` |

---

## Connecteam → website events (for the team)

- **A shift shows publicly when all of these are true:**
  - Its job is a tasting/event job (In-Store Sampling, Events, Total Wine…).
  - It's published.
  - Someone's assigned.
  - The title doesn't contain "private". Add "private" to hide one.
- **Event link:** the shift field "URL for Event (For SUNBOY Website)" adds an "Event info" link.
- **Staff on the site:** they appear only if their profile has "Show on Website" set to yes. Then their first name, photo and "Website Bio" are shown.

---

Theme base: [Shopify Dawn](https://github.com/Shopify/dawn) 16.0.0, MIT licence (see LICENSE.md).
