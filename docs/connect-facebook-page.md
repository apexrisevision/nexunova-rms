# Connect a Facebook Page to your CRM

This guide walks you (the IT operator) through connecting a Facebook Page from scratch so
that **lead-form submissions arrive in your CRM automatically**. You do the one-time account/
app setup once, then connect each Page.

Everything here happens in **your own** Meta account, Business Manager, and app — the CRM
only provides the connection. Wherever this guide says "your app" or "your Page", it means
the ones your company owns. The CRM never asks you to invent or copy a verify token; it
generates that for you.

> The CRM has a built-in wizard that mirrors these exact steps with one-click "Open in Meta"
> buttons, copy buttons, screenshots, and automatic checks. Open **Facebook → Set up a
> Facebook Page**. This document is the full reference for the same sequence.

**Before you start:** you have a personal Facebook account you can log in with, and a company
**privacy policy URL** ready (your website's /privacy page).

---

## The steps

### Step 1 — Create your Business Manager *(in Meta)*
Open **business.facebook.com → Create account**. Enter your business name, your name, and work
email → **Submit**. This is the home for your Page, ad account, and app. Already have one
(maybe from your ads agency)? Use it — just be an **admin**.

### Step 2 — Add or create your Facebook Page *(in Meta)*
**Business settings → Pages → Add** → add your existing Page (claim it) or create a new one.
The Page must belong to your Business Manager — leads come from its lead form.

### Step 3 — Create your lead form *(in Meta)*
Create a Lead Generation **Instant Form** for your Page — the form people fill in. Build it in
the **Forms Library**, or while creating a Lead ad in **Ads Manager**. Keep it simple: at least
**Full name** and **Phone**.

### Step 4 — Create your Meta app *(in Meta)*
1. **developers.facebook.com → My Apps → Create App**.
2. Finish developer sign-up if prompted.
3. Use case **Other** → app type **Business**.
4. Name it (e.g. your company) and pick your **Business Manager** from Step 1.
5. **Create app**.

Already have a Business-type app for ads? Use that one — don't make a second.

### Step 5 — Add the tools your app needs *(in Meta)*
In the app dashboard → **Add product**, set up:
- **Webhooks** — delivers new leads to your CRM.
- **Facebook Login for Business** — lets the CRM connect your Page in one click (Step 9).

Just add them here; the settings come in the next steps.

### Step 6 — Add your privacy policy & go Live *(in Meta)*
1. **App Settings → Basic** → paste your **Privacy Policy URL** → **Save changes**.
2. Top of the dashboard: switch **App Mode** from **Development** to **Live**.

In Development mode Facebook won't send real leads. The Live toggle requires the privacy URL.

### Step 7 — Turn on lead notifications *(in Meta)*
Open **Webhooks → Page** object, find **leadgen**, switch **Subscribe** ON. It asks for two
values — copy them from the CRM wizard:
- **Callback URL** — your CRM's address (one-click Copy).
- **Verify Token** — a private password the **CRM generates**. You never invent one. It appears
  in the wizard once your Page is connected (Step 9); copy it from there.

You'll know this worked when **Step 11** goes green.

### Step 8 — Link your Page & grant leads access *(in Meta)*
**Business settings → Pages → your Page** → connect your **app** to it, then enable **Leads
Access** for the app. The app can only read a Page's leads after both are done.

### Step 9 — Connect Facebook *(the CRM does this automatically)*
In the wizard, click **Connect Facebook**, sign in, pick the Page(s) you set up, and choose a
**project** for each. The CRM stores the access securely on its server — you never copy a
token. You can connect several Pages at once.

### Step 10 — Connection health check *(automatic)*
The CRM verifies the token is valid and shows which App ID it belongs to. Red = the login
didn't grant all permissions or the token expired → repeat Step 9, accepting all permissions.

### Step 11 — Facebook can reach your CRM *(automatic)*
Facebook sends a one-time verification ping when you subscribed (Step 7). The CRM confirms it
arrived. If not, re-check that **leadgen** is **Subscribed** and the Callback URL matches, then
press Subscribe again.

### Step 12 — Send a test lead *(in Meta, the CRM detects it)*
Open the **Lead Ads Testing Tool** (developers.facebook.com/tools/lead-ads-testing), pick your
Page + form, **Create Lead**, and wait for **Success**. The CRM detects the first lead and ticks
this green. Delete the test lead afterwards.

When all 12 are green: **"Connected & verified — your leads will now arrive automatically in
your CRM."** A health strip on the Page's row (token valid, last event, lead count) stays
visible so you can spot problems later.

---

## Troubleshooting

**Test lead stuck on "Pending" forever**
Your app isn't **Live** (Step 6) or **leadgen** isn't **Subscribed** (Step 7). Fix both, create a
fresh test lead.

**No event ever reaches the CRM (Step 11 / Step 12 never go green)**
Your **Page isn't linked to the app**, or **Leads Access** isn't granted (Step 8). Open Business
settings → Pages → your Page, connect your app, and enable lead access.

**Token invalid or expired (Step 10 red)**
Re-connect: Step 9 → **Connect Facebook** again, accepting every permission.

**The verify token field is empty in Step 7**
It's generated when you connect your Page. Complete **Step 9** first, then return to Step 7 to
copy it.

**Leads connect but go to the wrong person**
Routing to the receiving director is fixed by your CRM administrator and can't be changed from
the operator screen by design. Contact your admin.

---

## Who sees what
- **Operator (IT):** runs this whole wizard — connect, disconnect, test, view logs.
- **Director:** read-only — sees connected Pages, setup progress, and health, but does not
  manage connections. Leads still route to the active director automatically.
