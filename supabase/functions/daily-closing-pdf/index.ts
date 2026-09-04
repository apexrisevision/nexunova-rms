// ============================================================================
// DAILY CLOSING — DIRECTOR PDF  ·  BLUEPRINT §A13  ·  P7
// ----------------------------------------------------------------------------
// Renders one day to A4, writes it to the private `daily-closing` bucket, and
// inserts the day_documents version row IN THE SAME CALL. A regeneration after
// an adjustment increments the version and keeps every prior file.
//
// POST { company_id, cash_day_id }  with the caller's own Authorization header.
//
// AUTHORISATION IS THE DATABASE'S. The caller's JWT is forwarded to
// get_cash_day_pdf_data, which applies the same project rule as every other
// read (invariant 8). The service key is used only to write the file and the
// row, after the answer is already yes.
//
// ⚠️ NO CLIENT PHONE NUMBERS. §A10: "Director PDF omits client phone numbers."
// The RPC does not select one, so there is none in this function to leak. The
// test asserts the rendered text contains no phone-shaped string.
//
// ── TYPEFACE, AND A DEVIATION FROM §A13 ────────────────────────────────────
// §A13 asks for Inter embedded. Inter is published as a VARIABLE font; the
// static per-weight TTFs are no longer distributed anywhere reachable, and
// pdf-lib/fontkit embeds a variable font at its default instance only — it
// cannot select the 600 weight the layout depends on. Rather than ship a
// document whose "600" figures look identical to its body text, this renders
// in Helvetica + Helvetica-Bold, which give the two real weights §A13's
// hierarchy needs and are metrically close to Inter at document sizes.
//
// IT UPGRADES ITSELF. If `_assets/Inter-Regular.ttf` and
// `_assets/Inter-SemiBold.ttf` are present in the daily-closing bucket, they
// are embedded instead, with no code change. Drop them in and the next render
// is Inter.
//
// DEPLOY:  supabase functions deploy daily-closing-pdf --no-verify-jwt
// ============================================================================
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const BUCKET = "daily-closing";

const DC_BRAND_NAME = "FOURTEEN GROUP";   // RULES §0.7 — a constant, not a column

// ── §A11 palette, as PDF colours ────────────────────────────────────────────
const NAVY900 = rgb(0x0b / 255, 0x1b / 255, 0x3a / 255);
const INK900 = rgb(0x11 / 255, 0x18 / 255, 0x27 / 255);
const INK600 = rgb(0x4b / 255, 0x55 / 255, 0x63 / 255);
const INK500 = rgb(0x6b / 255, 0x72 / 255, 0x80 / 255);
const LINE = rgb(0xe5 / 255, 0xe7 / 255, 0xeb / 255);
const IN_G = rgb(0x0f / 255, 0x7b / 255, 0x4c / 255);
const OUT_R = rgb(0xb4 / 255, 0x23 / 255, 0x18 / 255);
const WHITE = rgb(1, 1, 1);

// A4 portrait, 18 mm margins, 22 mm band — §A13, in points.
const PAGE_W = 595.28, PAGE_H = 841.89;
const MM = 72 / 25.4;
const M = 18 * MM;
const BAND_H = 22 * MM;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

async function rpcAsCaller(auth: string, fn: string, args: unknown) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: ANON_KEY, Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  return r.ok ? await r.json() : null;
}

/* ── money, exactly as the screen formats it (§A7) ───────────────────────── */
function money(n: unknown, withRs = false): string {
  if (n === null || n === undefined || n === "") return "–";
  const v = Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  if (!isFinite(v)) return "–";
  const neg = v < 0, abs = Math.abs(v);
  let whole = Math.floor(abs);
  let paisa = Math.round((abs - whole) * 100);
  if (paisa === 100) { whole += 1; paisa = 0; }
  let s = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (paisa !== 0) s += "." + String(paisa).padStart(2, "0");
  if (withRs) s = "Rs " + s;
  return neg ? "(" + s + ")" : s;
}

function dateLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Karachi", weekday: "long", day: "2-digit", month: "long", year: "numeric",
  }).formatToParts(dt).reduce((a: Record<string, string>, x) => (a[x.type] = x.value, a), {});
  return `${p.weekday}, ${p.day} ${p.month} ${p.year}`;
}
function stamp(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d).reduce((a: Record<string, string>, x) => (a[x.type] = x.value, a), {});
  return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}`;
}
function slug(s: string) {
  return String(s || "Project").replace(/[^A-Za-z0-9]+/g, "").slice(0, 40) || "Project";
}

/* Fonts: Inter from our own bucket if it is there, else the standard pair. */
let FONT_CACHE: { reg: Uint8Array; semi: Uint8Array } | null | undefined;
async function interBytes() {
  if (FONT_CACHE !== undefined) return FONT_CACHE;
  try {
    const get = async (n: string) => {
      const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/_assets/${n}`,
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
      if (!r.ok) throw new Error("no " + n);
      return new Uint8Array(await r.arrayBuffer());
    };
    FONT_CACHE = { reg: await get("Inter-Regular.ttf"), semi: await get("Inter-SemiBold.ttf") };
  } catch { FONT_CACHE = null; }
  return FONT_CACHE;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "NOT_AUTHORIZED" }, 405);
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "NOT_AUTHORIZED" }, 401);

  let body: Record<string, string>;
  try { body = await req.json(); } catch { return json({ error: "INVALID_TRANSITION" }, 400); }

  const d = await rpcAsCaller(auth, "get_cash_day_pdf_data", {
    p_company_id: body.company_id, p_cash_day_id: body.cash_day_id,
  });
  if (!d || d.success !== true) return json({ error: d?.error ?? "NOT_AUTHORIZED" }, 403);

  // ── document ──────────────────────────────────────────────────────────────
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const inter = await interBytes();
  const F = inter ? await pdf.embedFont(inter.reg, { subset: true })
                  : await pdf.embedFont(StandardFonts.Helvetica);
  const FB = inter ? await pdf.embedFont(inter.semi, { subset: true })
                   : await pdf.embedFont(StandardFonts.HelveticaBold);
  const typeface = inter ? "Inter" : "Helvetica";

  pdf.setTitle(`Daily Closing — ${d.project_name} — ${d.business_date}`);
  pdf.setSubject("Confidential");
  pdf.setCreator("Nexunova RMS · Daily Closing");

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = 0;
  let pageNo = 1;

  const T = (s: string, x: number, yy: number, size: number, font = F, colour = INK900) =>
    page.drawText(String(s ?? ""), { x, y: yy, size, font, color: colour });
  const TR = (s: string, right: number, yy: number, size: number, font = F, colour = INK900) => {
    const w = font.widthOfTextAtSize(String(s ?? ""), size);
    page.drawText(String(s ?? ""), { x: right - w, y: yy, size, font, color: colour });
  };
  const rule = (yy: number, colour = LINE, thick = 0.75) =>
    page.drawLine({ start: { x: M, y: yy }, end: { x: PAGE_W - M, y: yy }, thickness: thick, color: colour });

  function band() {
    page.drawRectangle({ x: 0, y: PAGE_H - BAND_H, width: PAGE_W, height: BAND_H, color: NAVY900 });
    // §A13: "FOURTEEN GROUP · AWAMI MARKET" — the brand is a constant, the
    // project comes from projects.project_name. Never companies.display_name:
    // two tenant rows share that string (RULES §0.7).
    const head = `${DC_BRAND_NAME} · ${String(d.project_name).toUpperCase()}`;
    // 12/16 white 600, tracking .06em — drawn per character for the tracking.
    let x = M;
    const size = 9.5, track = size * 0.06;
    for (const ch of head) {
      page.drawText(ch, { x, y: PAGE_H - BAND_H + 34, size, font: FB, color: WHITE });
      x += FB.widthOfTextAtSize(ch, size) + track;
    }
    T(`Daily Closing — ${dateLong(d.business_date)}`, M, PAGE_H - BAND_H + 14, 15, F, WHITE);
    y = PAGE_H - BAND_H - 10 * MM;
  }

  function label(s: string, x: number, yy: number) {
    let cx = x; const size = 7.5, track = size * 0.06;
    for (const ch of s.toUpperCase()) {
      page.drawText(ch, { x: cx, y: yy, size, font: F, color: INK500 });
      cx += F.widthOfTextAtSize(ch, size) + track;
    }
  }

  function newPage() {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    pageNo += 1;
    band();
    T("continued", PAGE_W - M - F.widthOfTextAtSize("continued", 8), PAGE_H - BAND_H - 6 * MM, 8, F, INK500);
    y -= 4;
  }
  const need = (h: number) => { if (y - h < M + 40) newPage(); };

  band();

  // ── hero figures ──────────────────────────────────────────────────────────
  label("Closing cash", M, y);
  label("Closing bank", PAGE_W / 2, y);
  y -= 26;
  T(money(d.closing_cash, true), M, y, 24, FB, INK900);
  T(money(d.closing_bank, true), PAGE_W / 2, y, 24, FB, INK900);
  y -= 16;
  rule(y); y -= 18;

  // ── summary table ─────────────────────────────────────────────────────────
  const CASH_X = PAGE_W - M - 150, BANK_X = PAGE_W - M;
  TR("CASH", CASH_X, y, 7.5, F, INK500);
  TR("BANK", BANK_X, y, 7.5, F, INK500);
  y -= 14;
  const row = (name: string, cash: unknown, bank: unknown, colour = INK900, bold = false) => {
    T(name, M, y, 9, bold ? FB : F, INK900);
    TR(money(cash), CASH_X, y, 9, bold ? FB : F, colour);
    TR(money(bank), BANK_X, y, 9, bold ? FB : F, colour);
    y -= 14;
  };
  row("Opening (B/F)", d.opening_cash, d.opening_bank);
  row("Received (In)", d.in_cash, d.in_bank, IN_G);
  row("Paid (Out)", d.out_cash, d.out_bank, OUT_R);
  // The total rule sat at y+8 straight after the Paid row, which put it through
  // that row's descenders. It belongs in the gap BETWEEN Paid and Closing.
  y -= 4; rule(y + 11, INK900, 0.75);
  row("Closing (C/F)", d.closing_cash, d.closing_bank, INK900, true);
  y -= 4; rule(y); y -= 18;

  // ── ledger blocks ─────────────────────────────────────────────────────────
  function block(title: string, rows: Array<Record<string, unknown>>, colour = INK900) {
    if (!rows.length) return;
    need(30);
    label(title, M, y); y -= 14;
    for (const r of rows) {
      need(16);
      const left = [r.payee, r.unit_no ? "Unit " + r.unit_no : null, r.narration]
        .filter(Boolean).join(" · ");
      T(left.slice(0, 78), M, y, 8.5, F, INK900);
      TR(String(r.voucher || ""), PAGE_W - M - 90, y, 8.5, F, INK600);
      TR(money(r.amount), PAGE_W - M, y, 8.5, F, colour);
      y -= 13;
    }
    y -= 6;
  }
  block("Receipts", d.receipts || [], IN_G);
  block("Payments", d.payments || [], OUT_R);

  // Adjustments carry their reason, in italic-grey — §A13.
  const adj = d.adjustments || [];
  if (adj.length) {
    need(30);
    label("Adjustments", M, y); y -= 14;
    for (const r of adj) {
      need(24);
      T(String(r.voucher || ""), M, y, 8.5, F, INK900);
      TR(money(r.amount), PAGE_W - M, y, 8.5, F, r.direction === "OUT" ? OUT_R : IN_G);
      y -= 11;
      T(String(r.reason || "").slice(0, 96), M + 8, y, 8, F, INK600);
      y -= 13;
    }
    y -= 6;
  }

  if (d.pdc_pending && d.pdc_pending.length) {
    need(30);
    rule(y + 8); y -= 4;
    label("PDC pending", M, y); y -= 14;
    for (const p of d.pdc_pending) {
      need(14);
      const line = `Ch# ${p.cheque_no} · ${money(p.amount, true)} · due ${p.due_date}` +
        (p.status && p.status !== "pending" ? ` · ${String(p.status).toUpperCase()}` : "");
      T(line, M, y, 8.5, F, String(p.status).toLowerCase() === "bounced" ? OUT_R : INK900);
      y -= 13;
    }
    y -= 6;
  }

  // ── footer block ──────────────────────────────────────────────────────────
  need(60);
  rule(y + 8); y -= 6;
  const varTxt = Number(d.variance) === 0
    ? `Cash counted ${money(d.counted_cash, true)} · no variance`
    : `Cash counted ${money(d.counted_cash, true)} · Variance ${money(d.variance)}` +
      (d.variance_note ? `: "${d.variance_note}"` : "");
  T(varTxt, M, y, 8.5, F, INK600); y -= 14;
  T(`Prepared  ${d.prepared_by || "—"}`, M, y, 8.5, F, INK600);
  T(`Approved  ${d.closed_by_name || "—"} · ${stamp(d.closed_at).slice(-5)}`, PAGE_W / 2, y, 8.5, F, INK600);
  // The provenance line belongs at the FOOT of the page, on the same baseline
  // as the page number — not floating wherever the content happened to stop.
  // On a short day that left two footers at two different heights.
  page.drawText(`Generated ${stamp(null)} · Confidential · v${d.next_version}`,
    { x: M, y: M - 12, size: 7, font: F, color: INK500 });

  // page numbers, once every page exists
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const t = `Page ${i + 1} of ${pages.length}`;
    p.drawText(t, { x: PAGE_W - M - F.widthOfTextAtSize(t, 7), y: M - 12, size: 7, font: F, color: INK500 });
  });

  const bytes = await pdf.save();

  // ── store, then record ────────────────────────────────────────────────────
  const filename = `${slug(d.project_name)}_Daily_Closing_${d.business_date}.pdf`;
  const key = `${d.project_id}/documents/${d.business_date}/v${d.next_version}_${filename}`;

  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${key}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/pdf" },
    body: bytes,
  });
  if (!up.ok) return json({ error: "STORAGE_FAILED", detail: await up.text() }, 500);

  const rec = await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_day_document`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      p_company_id: body.company_id, p_cash_day_id: body.cash_day_id,
      p_version: d.next_version, p_storage_key: key,
    }),
  });
  const recJson = rec.ok ? await rec.json() : null;
  if (!recJson || recJson.success !== true) {
    return json({ error: "RECORD_FAILED", detail: recJson?.error ?? null }, 500);
  }

  // a signed link the panel can offer straight away
  const sign = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${key}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 600 }),
  });
  const signed = sign.ok ? await sign.json() : null;

  return json({
    success: true, event: "DirectorPdfRendered",
    version: d.next_version, filename, storage_key: key, typeface,
    bytes: bytes.length,
    url: signed ? `${SUPABASE_URL}/storage/v1${signed.signedURL}` : null,
    expires_in: 600,
  });
});
