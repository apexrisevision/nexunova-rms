# Connect a Facebook Page to your CRM

This guide walks you (the IT operator) through connecting one of your Facebook Pages so
that **lead-form submissions arrive in your CRM automatically**. You do it once per Page.

Everything here happens in **your own** Meta account, Business Manager, and app — the CRM
only provides the connection. Wherever this guide says "your app" or "your Page", it means
the ones your company owns. The CRM never asks you to invent or copy a verify token; it
generates that for you.

> The CRM has a built-in wizard that mirrors these exact steps with one-click "Open in Meta"
> buttons, copy buttons, and automatic checks. Open **Facebook → Set up a Facebook Page**.
> This document is the full reference for the same sequence.

---

## Before you start
- You can sign in to **Meta for Developers** (developers.facebook.com) and **Business
  settings** (business.facebook.com).
- You are an admin of the **Facebook Page** whose leads you want to receive.
- You have a **company privacy policy URL** ready (Meta may ask for it when you go Live).

---

## The steps

### Step 1 — Open or create your Meta app *(you do this in Meta)*
Open **Meta for Developers → My Apps**. Use the app you already use for lead ads, or create a
new one. When creating, choose the **Business** app type. Don't make a second app if you
already have one for ads.

### Step 2 — Switch your app to Live *(you do this in Meta)*
In the app dashboard, find the **App Mode** toggle at the top and switch it from
**Development** to **Live**. In Development mode Facebook will not send real leads.

- If the toggle is greyed out or asks for a **Privacy Policy URL**, open
  **App Settings → Basic**, paste your company's privacy page URL, **Save**, then toggle to
  Live again.

### Step 3 — Turn on lead notifications *(you do this in Meta)*
In your app, open **Webhooks**, choose the **Page** product, find **leadgen**, and switch
**Subscribe** to ON. Meta will ask for two values — get them from the CRM wizard:

- **Callback URL** — your CRM's address. Copy it from the wizard (one-click Copy).
- **Verify Token** — a private password the **CRM generates for you**. You never invent one.
  It appears in the wizard once your Page is connected (Step 5); copy it from there.

You'll know this step worked when **Step 7** below goes green (Facebook's verification ping
reaches your CRM).

### Step 4 — Link your Page and grant leads access *(you do this in Meta)*
In **Business settings → Pages**, make sure your Page is added to your Business, then assign
**your app** to that Page and enable **Leads Access** for it. Your app can only read a Page's
leads after it is linked and granted access.

### Step 5 — Connect Facebook *(the CRM does this automatically)*
In the wizard, click **Connect Facebook**. Sign in, pick the Page you just set up, and choose
which **project** its leads belong to. The CRM stores the access securely on its server — you
never see or copy a token. When the connection is saved, this step turns green.

### Step 6 — Connection health check *(automatic)*
The CRM asks Facebook whether the connection is valid and which app the token belongs to.
Green = healthy (and shows the App ID + expiry). If it's red, the Facebook login didn't grant
all permissions or the token expired — go back to Step 5 and **Connect** again, accepting all
permissions.

### Step 7 — Facebook can reach your CRM *(automatic)*
When you turned on lead notifications (Step 3), Facebook sends a one-time verification ping.
The CRM confirms it arrived. If it hasn't, re-check that **leadgen** is **Subscribed** in your
app's Webhooks and that the Callback URL matches exactly, then press Subscribe again.

### Step 8 — Send a test lead *(you do this in Meta, the CRM detects it)*
Open the **Lead Ads Testing Tool** (developers.facebook.com/tools/lead-ads-testing), pick your
Page and form, and **Create Lead**. Track its status until it shows **Success**. The CRM
detects the first lead automatically and turns this step green. Then delete the test lead in
the tool.

When all steps are green you'll see **"Connected & verified — your leads will now arrive
automatically in your CRM."** A health strip on the Page's row (token valid, last event date,
lead count) stays visible so you can spot problems later.

---

## Troubleshooting

**Test lead stuck on "Pending" forever**
Your app isn't **Live** (Step 2) or the **leadgen** webhook isn't **Subscribed** (Step 3).
Fix both, then create a fresh test lead.

**No event ever reaches the CRM (Step 7 / Step 8 never go green)**
Your **Page isn't linked to the app**, or **Leads Access** isn't granted (Step 4). Open
Business settings → Pages → your Page, assign your app, and enable lead access.

**Token invalid or expired (Step 6 red)**
Re-connect: go to Step 5 and click **Connect Facebook** again, accepting every permission
Facebook requests. This refreshes the stored access.

**The verify token field is empty in Step 3**
It's generated when you connect your Page. Complete **Step 5** first, then return to Step 3 to
copy your verify token.

**Leads connect but go to the wrong person**
Routing to the receiving director is fixed by your CRM administrator and cannot be changed
from the operator screen by design. Contact your admin if it needs to change.

---

## Who sees what
- **Operator (IT):** runs this whole wizard — connect, disconnect, test, view logs.
- **Director:** read-only — sees connected Pages, setup progress, and health, but does not
  manage connections. Leads still route to the active director automatically.
