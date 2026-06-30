# Connect a Facebook (or Instagram) Page to your CRM

This standalone note has been superseded. The authoritative, always-up-to-date guide now lives as
an in-app help page that mirrors the **Connect Facebook** wizard exactly (same 12 steps, same
order, same values), with copy buttons, callouts and screenshot slots:

- **In the app:** open **Connect Facebook** in the lead-entry interface and click **Full guide**.
- **Direct link:** [`help-facebook-leads.html`](../help-facebook-leads.html) (served at
  `https://rms.nexunova.com/help-facebook-leads.html`).

The in-app wizard itself is the single source of truth for the step order and the per-tenant
values (your Callback URL and Verify Token are shown there). The current order is:

1. Create your Business Manager
2. Add your Facebook Page
3. Create your lead form
4. Create your Meta app
5. Add the tools (Webhooks + Facebook Login for Business)
6. Add privacy policy & go Live
7. **Link your Page & grant Leads Access**
8. **Connect Facebook** (OAuth — the CRM mints your Verify Token here)
9. **Turn on lead notifications** (paste Callback URL + Verify Token, subscribe `leadgen`)
10. Connection health · 11. Verify ping · 12. Test lead

> Note: the Verify Token does not exist until **Step 8 (Connect)** runs — that is why Connect comes
> before the lead-notifications step. If the token looks empty at Step 9, finish Step 8 first.
