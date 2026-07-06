// ============================================================================
// NEXUNOVA RMS — SEND-INVOICE (Edge Function)
// Renders a platform subscription invoice to PDF (pdf-lib), stores it in the
// private `platform-invoices` bucket, and (mode=send) emails it to the tenant's
// billing contact via Resend with the PDF attached.
//
// AUTH: verify_jwt=false. The function authorizes by calling get_invoice_render_data
// with the CALLER's bearer (that RPC allows only service_role or a super-admin),
// then uses the service key for storage writes + mark_invoice_sent + logging.
//   • cron / server → Authorization: Bearer <service_role_key>
//   • super-admin UI → Authorization: Bearer <user session JWT>
//
// BODY: { invoice_id: uuid, mode?: 'generate' | 'send' }  (default 'send')
// DEPLOY: supabase functions deploy send-invoice --no-verify-jwt
// ============================================================================
import { PDFDocument, StandardFonts, rgb, PDFString, PDFName } from "https://esm.sh/pdf-lib@1.17.1";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY   = Deno.env.get("RESEND_API_KEY");
const RESEND_FROM  = Deno.env.get("RESEND_FROM") ?? "Nexunova RMS <noreply@nexunova.com>";
const LOGO_URL     = "https://rms.nexunova.com/assets/img/nexunova-logo.png";
const BUCKET       = "platform-invoices";

// ── PDF renderer (ported from the approved scratchpad renderer) ──────────────
async function renderInvoicePDF(data: any, logoBytes: Uint8Array | null): Promise<Uint8Array> {
  const INDIGO = rgb(0.310, 0.275, 0.898), INDIGO_D = rgb(0.243, 0.212, 0.75), INK = rgb(0.059, 0.090, 0.165);
  const BODY = rgb(0.216, 0.255, 0.318), MUTED = rgb(0.420, 0.447, 0.502), FAINT = rgb(0.612, 0.639, 0.686);
  const LINE = rgb(0.898, 0.906, 0.922), SOFT = rgb(0.933, 0.945, 0.996), GREEN = rgb(0.086, 0.639, 0.290);
  const GREEN_BG = rgb(0.941, 0.980, 0.957), RED = rgb(0.863, 0.149, 0.149), RED_BG = rgb(0.996, 0.949, 0.949), WHITE = rgb(1, 1, 1);

  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${data.invoice_number}`); doc.setProducer("Nexunova RMS");
  const page = doc.addPage([595.28, 841.89]);
  const W = 595.28, H = 841.89, M = 48, R = W - M;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const T = (s: any, x: number, y: number, sz: number, f = font, c = INK, sp = 0) =>
    page.drawText(String(s ?? ""), { x, y, size: sz, font: f, color: c, characterSpacing: sp });
  const wid = (s: any, sz: number, f = font) => f.widthOfTextAtSize(String(s ?? ""), sz);
  const RT = (s: any, xr: number, y: number, sz: number, f = font, c = INK, sp = 0) =>
    T(s, xr - wid(s, sz, f) - sp * String(s).length, y, sz, f, c, sp);
  const CT = (s: any, cx: number, y: number, sz: number, f = font, c = INK) => T(s, cx - wid(s, sz, f) / 2, y, sz, f, c);
  const hr = (y: number, x1 = M, x2 = R, col = LINE, th = 1) =>
    page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: th, color: col });
  const box = (x: number, y: number, w: number, h: number, col: any) => page.drawRectangle({ x, y, width: w, height: h, color: col });
  const money = (n: any) => (data.currency || "PKR") + " " + Math.round(Number(n || 0)).toLocaleString("en-US");
  const overdue = !!data.overdue, ACCENT = overdue ? RED : INDIGO;
  let y = H;

  box(0, H - 6, W, 6, INDIGO);
  y = H - 52;
  if (logoBytes) {
    try { const img = await doc.embedPng(logoBytes); const lw = 116, lh = (img.height / img.width) * lw; page.drawImage(img, { x: M, y: y - lh + 22, width: lw, height: lh }); }
    catch { T("NEXUNOVA", M, y, 20, bold, INDIGO, 1); }
  } else T("NEXUNOVA", M, y, 20, bold, INDIGO, 1);
  RT("INVOICE", R, y - 4, 30, bold, INK, 2);
  RT("Nexunova RMS · Platform Subscription", R, y - 20, 9, font, MUTED);
  if (overdue) { const bw = 74, bh = 20, bx = R - bw, by = y - 46; box(bx, by, bw, bh, RED); CT("OVERDUE", bx + bw / 2, by + 6, 10, bold, WHITE); }

  y = H - 150; hr(y + 14);
  T("BILLED TO", M, y, 8, bold, INDIGO, 1.2);
  T(data.company?.name || "—", M, y - 18, 13.5, bold, INK);
  let by = y - 34;
  for (const l of [data.company?.address, [data.company?.city, data.company?.country].filter(Boolean).join(", "), data.company?.email].filter(Boolean)) { T(l, M, by, 9.5, font, MUTED); by -= 13; }
  const fx = 330; T("FROM", fx, y, 8, bold, MUTED, 1.2); T("Nexunova", fx, y - 18, 12, bold, INK);
  let fy = y - 34; for (const l of ["Real-estate management SaaS", "support@nexunova.com", "nexunova.com"]) { T(l, fx, fy, 9.5, font, MUTED); fy -= 13; }

  y = Math.min(by, fy) - 16;
  const bandH = 46; box(M, y - bandH, R - M, bandH, SOFT); box(M, y - bandH, 3, bandH, ACCENT);
  const cells = [["INVOICE NO.", data.invoice_number], ["ISSUE DATE", data.issue_date], ["DUE DATE", data.due_date], ["PLAN", (data.plan_name || "—") + " · " + (data.billing_cycle || "")]];
  const cw = (R - M - 20) / cells.length;
  cells.forEach((c, i) => { const cx = M + 16 + i * cw; T(c[0], cx, y - 18, 7.5, bold, MUTED, 0.8); T(c[1], cx, y - 33, 11, bold, i === 2 && overdue ? RED : INK); });
  y -= bandH + 30;

  const colAmt = R, colDesc = M + 14;
  box(M, y - 22, R - M, 22, INK); T("DESCRIPTION", colDesc, y - 15, 8, bold, WHITE, 1); RT("AMOUNT", colAmt - 14, y - 15, 8, bold, WHITE, 1);
  y -= 22;
  T(`${data.plan_name || "Subscription"} Plan`, colDesc, y - 16, 11, bold, INK);
  T(`Billing period ${data.period_start} — ${data.period_end}`, colDesc, y - 30, 9, font, MUTED);
  RT(money(data.amount), colAmt - 14, y - 20, 11, bold, INK);
  y -= 40; hr(y, M, R, LINE, 1); y -= 24;

  const totX = 330, totR = R;
  const totRow = (label: string, val: string, opt: any = {}) => { T(label, totX, y, 9.5, opt.bold ? bold : font, opt.lc || MUTED); RT(val, totR, y, opt.bold ? 11 : 10, opt.bold ? bold : font, opt.vc || INK); y -= 17; };
  totRow("Subtotal", money(data.amount));
  if (Number(data.tax_amount || 0) > 0) totRow("Tax", money(data.tax_amount));
  hr(y + 6, totX, totR, LINE, 0.8); y -= 4;
  totRow("Total", money(data.amount), { bold: true, lc: INK, vc: INK });
  totRow("Received", money(data.received), { vc: GREEN, lc: GREEN }); y -= 4;
  const balH = 40; box(totX, y - balH + 8, totR - totX, balH, overdue ? RED_BG : SOFT); box(totX, y - balH + 8, 3, balH, ACCENT);
  T("BALANCE DUE", totX + 14, y - 10, 8.5, bold, overdue ? RED : INDIGO_D, 0.8);
  RT(money(data.balance), totR - 14, y - 14, 16, bold, overdue ? RED : INDIGO_D);
  const balBottom = y - balH + 8;

  let py = H - 470; const payX = M;
  T("PAYMENTS RECEIVED", payX, py, 8.5, bold, INK, 1); py -= 8; hr(py, payX, 300, LINE, 0.8); py -= 16;
  const pays = data.payments || [];
  if (!pays.length) { T("No payments received yet.", payX, py, 9.5, font, FAINT); py -= 14; }
  else for (const p of pays.slice(0, 6)) { T("•", payX, py, 9.5, bold, GREEN); T(p.date || "", payX + 12, py, 9.5, font, BODY); T(p.reference ? `Ref ${p.reference}` : (p.method || ""), payX + 92, py, 9, font, MUTED); RT(money(p.amount), 300, py, 9.5, bold, GREEN); py -= 15; }

  y = Math.min(balBottom, py) - 30;
  box(M, y - 34, R - M, 34, SOFT); box(M, y - 34, 3, 34, INDIGO);
  const g = (data.grace_days === undefined || data.grace_days === null) ? 15 : Number(data.grace_days);
  const policy = g > 0
    ? `As per our billing policy, services continue through a ${g}-day grace period after the due date to accommodate payment processing.`
    : "Payment is due by the due date; service is suspended immediately upon non-payment.";
  const wrap = (s: string, maxW: number, sz: number, f: any) => { const ws = s.split(" "); const ls: string[] = []; let cur = ""; for (const w of ws) { const t = cur ? cur + " " + w : w; if (f.widthOfTextAtSize(t, sz) > maxW) { ls.push(cur); cur = w; } else cur = t; } if (cur) ls.push(cur); return ls; };
  let py2 = y - 13; for (const l of wrap(policy, R - M - 28, 9, font)) { T(l, M + 14, py2, 9, font, BODY); py2 -= 12; }
  y -= 60;

  T("PAYMENT DETAILS", M, y, 8.5, bold, INK, 1); y -= 8; hr(y, M, R, LINE, 0.8); y -= 20;
  if (Number(data.balance || 0) <= 0) {
    box(M, y - 20, R - M, 30, GREEN_BG); box(M, y - 20, 3, 30, GREEN);
    T("PAID IN FULL", M + 14, y - 3, 10.5, bold, GREEN); T("Thank you — no payment is due on this invoice.", M + 128, y - 3, 9.5, font, BODY); y -= 34;
  } else {
    T("To pay, use your secure payment page:", M, y, 10.5, bold, INK); y -= 18;
    if (data.pay_url) {
      box(M, y - 20, R - M, 28, SOFT); box(M, y - 20, 3, 28, INDIGO); T(data.pay_url, M + 14, y - 2, 9.5, font, INDIGO_D);
      try {
        const ann = doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [M, y - 20, R, y + 8], Border: [0, 0, 0], A: doc.context.obj({ Type: "Action", S: "URI", URI: PDFString.of(data.pay_url) }) });
        const anns = page.node.lookup(PDFName.of("Annots")); if (anns) (anns as any).push(ann); else page.node.set(PDFName.of("Annots"), doc.context.obj([ann]));
      } catch { /* noop */ }
      y -= 32;
    }
    if (data.note) { T(data.note, M, y, 9, font, MUTED); y -= 14; }
  }

  const fyy = 54; hr(fyy + 14, M, R, LINE, 0.8);
  CT("Nexunova RMS — Real-estate Management System", W / 2, fyy, 8.5, bold, MUTED);
  CT("This is a computer-generated invoice. For queries, contact support@nexunova.com", W / 2, fyy - 12, 8, font, FAINT);
  return await doc.save();
}

function b64(bytes: Uint8Array): string {
  let bin = ""; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}
function emailHtml(d: any): string {
  const due = d.overdue ? `<span style="color:#f43f5e">${d.due_date} (overdue)</span>` : d.due_date;
  return `<div style="font-family:Inter,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#0f172a;color:#e2e8f0;border-radius:12px">
    <div style="margin-bottom:20px"><div style="font-size:20px;font-weight:700;color:#f8fafc">Nexunova RMS</div>
    <div style="font-size:12px;color:#6366f1;letter-spacing:1px;text-transform:uppercase">Subscription Invoice · ${d.invoice_number}</div></div>
    <p style="font-size:14px;color:#cbd5e1;line-height:1.6">Dear ${d.company?.name || "Customer"},</p>
    <p style="font-size:14px;color:#cbd5e1;line-height:1.6">Your ${d.plan_name} (${d.billing_cycle}) subscription invoice is attached (PDF).</p>
    <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:18px 20px;margin:20px 0">
      <table style="width:100%;font-size:13px;color:#cbd5e1"><tr><td>Invoice</td><td style="text-align:right;color:#f8fafc">${d.invoice_number}</td></tr>
      <tr><td>Amount</td><td style="text-align:right;color:#f8fafc;font-weight:700">${d.currency} ${Math.round(Number(d.amount||0)).toLocaleString("en-US")}</td></tr>
      <tr><td>Balance due</td><td style="text-align:right;color:#f8fafc;font-weight:700">${d.currency} ${Math.round(Number(d.balance||0)).toLocaleString("en-US")}</td></tr>
      <tr><td>Due date</td><td style="text-align:right">${due}</td></tr></table></div>
    ${d.pay_url && Number(d.balance||0) > 0 ? `<a href="${d.pay_url}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;margin:6px 0 18px">Pay securely →</a>` : ""}
    <p style="font-size:12px;color:#94a3b8;line-height:1.6">Please reference your invoice number with the payment. Questions? <a href="mailto:support@nexunova.com" style="color:#6366f1">support@nexunova.com</a></p>
  </div>`;
}

async function rpc(fn: string, body: any, bearer: string, apikey: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: { "Content-Type": "application/json", apikey, Authorization: `Bearer ${bearer}` }, body: JSON.stringify(body),
  });
  const txt = await res.text(); let json: any = null; try { json = txt ? JSON.parse(txt) : null; } catch { /* */ }
  return { ok: res.ok, status: res.status, json, txt };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405, headers: CORS });

  let body: any; try { body = await req.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400, headers: CORS }); }
  const invoiceId = body.invoice_id; const mode = body.mode === "generate" ? "generate" : "send";
  if (!invoiceId) return Response.json({ error: "invoice_id_required" }, { status: 400, headers: CORS });

  // AUTHZ. Two accepted callers:
  //  (a) cron/server: presents x-invoice-secret matching platform_settings
  //      → we render as service_role (trusted server path);
  //  (b) super-admin UI: presents its user JWT as Authorization → the gated
  //      get_invoice_render_data enforces super-admin.
  const authHeader = req.headers.get("Authorization") || `Bearer ${ANON_KEY}`;
  const callerBearer = authHeader.replace(/^Bearer\s+/i, "");
  let renderBearer = callerBearer, renderApikey = ANON_KEY;
  const secretHdr = req.headers.get("x-invoice-secret");
  if (secretHdr) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/platform_settings?setting_key=eq.invoice_dispatch_secret&select=setting_value`,
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
      const rows = await r.json();
      const stored = rows?.[0]?.setting_value;
      const storedStr = typeof stored === "string" ? stored : (stored == null ? null : String(stored));
      if (storedStr && storedStr === secretHdr) { renderBearer = SERVICE_KEY; renderApikey = SERVICE_KEY; }
    } catch { /* fall through to caller-bearer auth */ }
  }
  const rd = await rpc("get_invoice_render_data", { p_invoice_id: invoiceId }, renderBearer, renderApikey);
  if (!rd.ok) return Response.json({ error: "not_authorized_or_not_found", detail: rd.json ?? rd.txt }, { status: rd.status === 401 || rd.status === 403 ? 403 : 400, headers: CORS });
  const data = rd.json;
  if (!data) return Response.json({ error: "invoice_not_found" }, { status: 404, headers: CORS });

  // logo (best-effort)
  let logo: Uint8Array | null = null;
  try { const lr = await fetch(LOGO_URL); if (lr.ok) logo = new Uint8Array(await lr.arrayBuffer()); } catch { /* */ }

  const pdf = await renderInvoicePDF(data, logo);
  const path = `${data.company_id}/${data.invoice_number}.pdf`;

  // upload (service role; upsert so re-generate overwrites)
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST", headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "Content-Type": "application/pdf", "x-upsert": "true" }, body: pdf,
  });
  if (!up.ok && up.status !== 200) { const t = await up.text(); console.error("[send-invoice] upload failed", up.status, t); }

  await rpc("mark_invoice_sent", { p_invoice_id: invoiceId, p_pdf_path: path }, SERVICE_KEY, SERVICE_KEY);

  // signed URL (7 days) for preview/download
  let signedUrl: string | null = null;
  try {
    const s = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${path}`, {
      method: "POST", headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 604800 }),
    });
    if (s.ok) { const j = await s.json(); signedUrl = `${SUPABASE_URL}/storage/v1${j.signedURL}`; }
  } catch { /* */ }

  let emailed = false, emailError: string | null = null;
  if (mode === "send") {
    const to = data.billing_email;
    if (!to) emailError = "no_billing_email";
    else if (!RESEND_KEY) emailError = "resend_not_configured";
    else {
      try {
        const er = await fetch("https://api.resend.com/emails", {
          method: "POST", headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: RESEND_FROM, to, subject: `Invoice ${data.invoice_number} — Nexunova RMS subscription`, html: emailHtml(data), attachments: [{ filename: `${data.invoice_number}.pdf`, content: b64(pdf) }] }),
        });
        emailed = er.ok; if (!er.ok) emailError = `resend_${er.status}`;
      } catch (e) { emailError = String((e as Error).message); }
    }
  }
  return Response.json({ success: true, invoice_id: invoiceId, invoice_number: data.invoice_number, pdf_path: path, signed_url: signedUrl, emailed, email_error: emailError }, { headers: CORS });
});
