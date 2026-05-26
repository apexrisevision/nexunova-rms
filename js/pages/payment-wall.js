// ══ PAYMENT WALL v2 ══════════════════════════════════════════════
// Manual payment flow: Order Summary → Pay → Upload Proof → Confirmed

const PW = {
  step: 1,
  invoiceId:       null,
  invoiceNumber:   null,
  invoiceAmount:   null,
  invoiceCurrency: 'PKR',
  invoiceDue:      null,
  planCode:        null,
  receiptFile:     null,

  // ── Plan definitions ─────────────────────────────────────────────
  // Update prices/features here if plans change
  PLANS: {
    free_trial:       { name:'Free Trial',  price:0,      cycle:'',        color:'#94a3b8', projects:1,  units:10,    users:1,  api:false,  support:false },
    basic_monthly:    { name:'Basic',        price:10000,  cycle:'Monthly', color:'#38bdf8', projects:1,  units:500,   users:3,  api:false,  support:false },
    basic_yearly:     { name:'Basic',        price:108000, cycle:'Yearly',  color:'#38bdf8', projects:1,  units:500,   users:3,  api:false,  support:false },
    pro_monthly:      { name:'Pro',          price:25000,  cycle:'Monthly', color:'#a78bfa', projects:3,  units:1500,  users:4,  api:true,   support:false },
    pro_yearly:       { name:'Pro',          price:270000, cycle:'Yearly',  color:'#a78bfa', projects:3,  units:1500,  users:4,  api:true,   support:false },
    ultimate_monthly: { name:'Ultimate',     price:50000,  cycle:'Monthly', color:'#f59e0b', projects:10, units:10000, users:16, api:true,   support:true  },
    ultimate_yearly:  { name:'Ultimate',     price:540000, cycle:'Yearly',  color:'#f59e0b', projects:10, units:10000, users:16, api:true,   support:true  },
  },

  // ── Nexunova payment accounts ─────────────────────────────────────
  // brand: hex color used for accent bar, glow, badge
  // logo:  path to brand PNG rendered inside the icon tile
  ACCOUNTS: [
    {
      type:    'bank',
      brand:   '#0d9488',
      brandTo: '#0f766e',
      brandLabel: 'HBL',
      label:   'Bank Transfer',
      bank:    'Habib Bank Limited',
      title:   'Muhammad Muzammil',
      account: '02237991883403',
      logo:    'Logo/habib-bank--600.png',
    },
    {
      type:    'bank',
      brand:   '#0d9488',
      brandTo: '#0f766e',
      brandLabel: 'HBL',
      label:   'Bank Transfer',
      bank:    'Habib Bank Limited',
      title:   'Fariha Naz',
      account: '02237991889503',
      logo:    'Logo/habib-bank--600.png',
    },
    {
      type:    'jazzcash',
      brand:   '#E11D48',
      brandTo: '#BE123C',
      brandLabel: 'JazzCash',
      label:   'JazzCash Wallet',
      bank:    null,
      title:   'Mizkaa Malik',
      account: '+923334217875',
      logo:    'Logo/Jazz cash.png',
    },
    {
      type:    'easypaisa',
      brand:   '#22C55E',
      brandTo: '#16A34A',
      brandLabel: 'EasyPaisa',
      label:   'EasyPaisa Wallet',
      bank:    null,
      title:   'Malik Muhammad Muzammil',
      account: '+923078407983',
      logo:    'Logo/Easy paisa.png',
    },
  ],

  // ── Entry point ──────────────────────────────────────────────────
  async show(subStatus) {
    const el = document.getElementById('s-payment-wall');
    if (!el) return;
    document.getElementById('s-login')?.classList.remove('on');
    document.getElementById('s-app')?.classList.remove('on');
    el.classList.add('on');

    if (subStatus === 'payment_under_review') {
      this._renderWaiting();
      return;
    }

    if (subStatus === 'expired' || subStatus === 'cancelled' || subStatus === 'past_due') {
      this._renderExpired(subStatus);
      return;
    }

    const sess = JSON.parse(sessionStorage.getItem('nxn_sess') || '{}');
    this.invoiceId       = sess.invoiceId       || null;
    this.invoiceNumber   = sess.invoiceNumber   || null;
    this.invoiceAmount   = sess.invoiceAmount   || null;
    this.invoiceCurrency = sess.invoiceCurrency || 'PKR';
    this.invoiceDue      = sess.invoiceDue      || null;
    this.planCode        = sess.planCode        || null;
    this.receiptFile     = null;
    this.step = 1;
    this._renderStep(1);
  },

  hide() {
    document.getElementById('s-payment-wall')?.classList.remove('on');
  },

  // ── Step router ──────────────────────────────────────────────────
  _renderStep(n) {
    this.step = n;
    const bar = document.getElementById('pw-step-bar');
    if (bar) bar.style.display = '';
    this._updateBar(n);

    const titles = {
      1: ['Order Summary',    `Welcome, ${S?.coName || 'there'}! Review your plan before paying.`],
      2: ['Make Payment',     'Transfer the exact amount to one of our accounts below.'],
      3: ['Upload Proof',     'Attach your receipt — we\'ll verify and activate within 2 hours.'],
    };
    const [t, s] = titles[n] || ['Payment', ''];
    this._setTitle(t, s);

    if (n === 1) this._renderOrder();
    if (n === 2) this._renderPayInstructions();
    if (n === 3) this._renderUploadProof();
  },

  // ── Step bar update ──────────────────────────────────────────────
  _updateBar(n) {
    document.querySelectorAll('.pw-step-item').forEach((el, i) => {
      const dot = el.querySelector('.pw-sdot');
      const lbl = el.querySelector('.pw-slbl');
      if (!dot) return;
      if (i + 1 < n) {
        dot.className = 'pw-sdot pw-sdot-done';
        dot.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
      } else if (i + 1 === n) {
        dot.className = 'pw-sdot pw-sdot-active';
        dot.textContent = i + 1;
      } else {
        dot.className = 'pw-sdot';
        dot.textContent = i + 1;
      }
      if (lbl) lbl.style.color = (i + 1 <= n) ? 'rgba(255,255,255,.75)' : 'rgba(255,255,255,.28)';
    });
    document.querySelectorAll('.pw-sline').forEach((line, i) => {
      line.classList.toggle('pw-sline-done', i + 1 < n);
    });
  },

  // ── STEP 1: Order Summary ─────────────────────────────────────────
  _renderOrder() {
    const plan = this.PLANS[this.planCode] || { name: this.planCode || 'Subscription', cycle: '', color: '#6366f1', projects: null };
    const amt  = this._fmtAmt(this.invoiceAmount, this.invoiceCurrency);
    const due  = this.invoiceDue
      ? new Date(this.invoiceDue).toLocaleDateString('en-PK', { day:'numeric', month:'long', year:'numeric' })
      : '—';

    const unitsFmt = plan.units >= 1000 ? (plan.units / 1000) + 'K' : (plan.units || '—');

    const feats = plan.projects ? [
      `${plan.projects} Project${plan.projects > 1 ? 's' : ''}`,
      `${unitsFmt} Units`,
      `${plan.users} User${plan.users > 1 ? 's' : ''}`,
      'Reports & Exports',
      'PDC Management',
      'Payment Links',
      'Audit Trail',
      plan.api ? 'API Access' : null,
      plan.support ? 'Priority Support' : null,
    ].filter(Boolean) : [];

    this._setBody(`
      ${this._rejectionBanner()}

      <div class="pw2-plan-hero">
        <div class="pw2-plan-icon" style="background:${plan.color}18;border-color:${plan.color}44">
          <svg width="22" height="22" fill="none" stroke="${plan.color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
            <rect x="3" y="3" width="18" height="18" rx="3"/>
            <path d="M9 9h6M9 12h6M9 15h4"/>
          </svg>
        </div>
        <div class="pw2-plan-info">
          <div class="pw2-plan-name" style="color:${plan.color}">${_pwEsc(plan.name)} Plan${plan.cycle ? ' — ' + plan.cycle : ''}</div>
          <div class="pw2-plan-sub">Nexunova RMS Subscription</div>
        </div>
        <div class="pw2-plan-amt">
          <div class="pw2-plan-price">${amt}</div>
          ${plan.cycle ? `<div class="pw2-plan-cycle">per ${plan.cycle.toLowerCase() === 'yearly' ? 'year' : 'month'}</div>` : ''}
        </div>
      </div>

      <div class="pw2-invoice-card">
        <div class="pw2-inv-row">
          <span class="pw2-inv-key">Invoice No.</span>
          <span class="pw2-inv-val mono">${_pwEsc(this.invoiceNumber || 'Generating…')}</span>
        </div>
        <div class="pw2-inv-row">
          <span class="pw2-inv-key">Plan</span>
          <span class="pw2-inv-val">${_pwEsc(plan.name)}${plan.cycle ? ' (' + plan.cycle + ')' : ''}</span>
        </div>
        ${plan.projects ? `
        <div class="pw2-inv-row">
          <span class="pw2-inv-key">Limits</span>
          <span class="pw2-inv-val">${plan.projects} Project · ${unitsFmt} Units · ${plan.users} User${plan.users>1?'s':''}</span>
        </div>` : ''}
        <div class="pw2-inv-row">
          <span class="pw2-inv-key">Due By</span>
          <span class="pw2-inv-val" style="color:rgba(255,180,0,.9);font-weight:600">${due}</span>
        </div>
        <div class="pw2-inv-divider"></div>
        <div class="pw2-inv-total-row">
          <span class="pw2-inv-total-lbl">Total Due</span>
          <span class="pw2-inv-total-val">${amt}</span>
        </div>
      </div>

      ${feats.length ? `
      <div class="pw2-feats-card">
        <div class="pw2-feats-title">What's included in your plan</div>
        <div class="pw2-feats-grid">
          ${feats.map(f => `
          <div class="pw2-feat-item">
            <svg width="13" height="13" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
            <span>${_pwEsc(f)}</span>
          </div>`).join('')}
        </div>
      </div>` : ''}

      <div id="pw-err" class="pw-err" style="margin-top:8px"></div>

      <button class="pw2-btn-primary" onclick="PW._renderStep(2)" style="margin-top:20px">
        Proceed to Payment
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      </button>
      <button class="pw2-btn-ghost" onclick="PW._logout()">← Sign in with a different account</button>
    `);
  },

  // ── STEP 2: Payment Instructions ──────────────────────────────────
  _renderPayInstructions() {
    const amt         = this._fmtAmt(this.invoiceAmount, this.invoiceCurrency);
    const companyCode = S?.coCode || S?.coName || '';

    const accountCards = this.ACCOUNTS.map((acc, i) => {
      const typeLabels = { bank:'Account Number', jazzcash:'Mobile Number', easypaisa:'Mobile Number', raast:'Raast ID' };
      const accLabel   = typeLabels[acc.type] || 'Number';
      const brand      = acc.brand   || '#00d9ff';
      const brandTo    = acc.brandTo || brand;
      const iconHtml = acc.logo
        ? `<img src="${_pwEsc(acc.logo)}" alt="${_pwEsc(acc.brandLabel || acc.type)}" loading="lazy">`
        : (acc.svg || '');
      const iconClass = acc.logo ? 'pmx-icon pmx-icon-img' : 'pmx-icon';
      return `
      <div class="pmx-card" style="--pmx-brand:${brand};--pmx-brand-to:${brandTo}">
        <div class="pmx-accent"></div>
        <div class="pmx-head">
          <div class="${iconClass}">${iconHtml}</div>
          <div class="pmx-titles">
            <div class="pmx-label">${_pwEsc(acc.label)}</div>
            ${acc.bank ? `<div class="pmx-sub">${_pwEsc(acc.bank)}</div>` : ''}
          </div>
          <div class="pmx-chip">${_pwEsc(acc.brandLabel || acc.type)}</div>
        </div>

        <div class="pmx-body">
          <div class="pmx-row pmx-row-title">
            <div class="pmx-row-key">Account Title</div>
            <div class="pmx-row-val">${_pwEsc(acc.title)}</div>
          </div>

          <div class="pmx-row pmx-row-num">
            <div class="pmx-row-key">${_pwEsc(accLabel)}</div>
            <div class="pmx-num-wrap">
              <span class="pmx-num mono" id="pw2-accno-${i}">${_pwEsc(acc.account)}</span>
              <button class="pmx-copy" onclick="PW._copy('pw2-accno-${i}',this)" aria-label="Copy account number">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                <span>Copy</span>
              </button>
            </div>
          </div>

          ${acc.iban ? `
          <div class="pmx-row">
            <div class="pmx-row-key">IBAN</div>
            <div class="pmx-num-wrap">
              <span class="pmx-num mono pmx-num-sm" id="pw2-iban-${i}">${_pwEsc(acc.iban)}</span>
              <button class="pmx-copy" onclick="PW._copy('pw2-iban-${i}',this)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                <span>Copy</span>
              </button>
            </div>
          </div>` : ''}
          ${acc.branch ? `
          <div class="pmx-row">
            <div class="pmx-row-key">Branch</div>
            <div class="pmx-row-val">${_pwEsc(acc.branch)}</div>
          </div>` : ''}
        </div>
      </div>`;
    }).join('');

    this._setBody(`
      <div class="pw2-amount-banner">
        <div class="pw2-amount-label">Exact Amount to Transfer</div>
        <div class="pw2-amount-value">${amt}</div>
        <div class="pw2-amount-sub">Transfer the exact amount shown — no more, no less</div>
      </div>

      <div class="pw2-note-box">
        <svg width="15" height="15" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>
        <div>
          <div class="pw2-note-label">Important</div>
          <div class="pw2-note-text">In the payment remarks / description, write your Company Code, this helps us match your payment instantly.</div>
        </div>
      </div>

      <div class="pw2-section-title">Choose a Payment Method</div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:8px">
        ${accountCards}
      </div>

      <div id="pw-err" class="pw-err" style="margin-top:4px"></div>

      <button class="pw2-btn-primary" onclick="PW._renderStep(3)" style="margin-top:16px">
        I've Made the Payment — Upload Proof →
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      </button>
      <button class="pw2-btn-ghost" onclick="PW._renderStep(1)">← Back to Order Summary</button>
    `);
  },

  // ── STEP 3: Upload Proof ──────────────────────────────────────────
  _renderUploadProof() {
    const today  = new Date().toISOString().split('T')[0];
    const amtVal = this.invoiceAmount
      ? Number(this.invoiceAmount).toLocaleString('en-PK', { maximumFractionDigits: 0 })
      : '';

    this._setBody(`
      <div class="pw2-step-success-note">
        <svg width="15" height="15" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        Great! Now upload your payment receipt so we can verify and activate your account.
      </div>

      <div class="pw2-form">
        <div class="pw2-field-row">
          <div class="pw2-field">
            <label>Reference / TXN No. <span class="pw2-req">*</span></label>
            <input id="pw-ref" class="pw2-input" type="text" placeholder="Bank ref, TXN ID or screenshot ref" autocomplete="off">
          </div>
          <div class="pw2-field">
            <label>Amount Paid <span class="pw2-req">*</span></label>
            <input id="pw-amt" class="pw2-input inp-amt" type="text" inputmode="numeric" value="${amtVal}" placeholder="Amount in PKR">
          </div>
        </div>

        <div class="pw2-field-row">
          <div class="pw2-field">
            <label>Payment Date <span class="pw2-req">*</span></label>
            <input id="pw-date" class="pw2-input" type="date" value="${today}">
          </div>
          <div class="pw2-field">
            <label>Payment Method</label>
            <select id="pw-method-sel" class="pw2-input pw2-select">
              <option value="bank_transfer">Bank Transfer</option>
              <option value="jazzcash">JazzCash</option>
              <option value="easypaisa">Easypaisa</option>
              <option value="raast">Raast</option>
            </select>
          </div>
        </div>

        <div class="pw2-field">
          <label>Payment Receipt <span class="pw2-req">*</span></label>
          <div class="pw2-file-zone" id="pw-drop-zone">
            <input type="file" id="pw-receipt-file" accept="image/jpeg,image/png,image/jpg,application/pdf" onchange="PW._onFileSelect(this)">
            <div class="pw2-file-inner" id="pw2-file-inner">
              <svg width="30" height="30" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <div style="font-size:13px;color:rgba(255,255,255,.42);margin-top:10px;font-weight:500">Click or drag to upload receipt</div>
              <div style="font-size:11px;color:rgba(255,255,255,.22);margin-top:4px">JPG, PNG or PDF — max 5 MB</div>
            </div>
          </div>
          <div id="pw-file-info" style="display:none;align-items:center;gap:10px;padding:10px 13px;background:rgba(99,102,241,.06);border:1px solid rgba(99,102,241,.2);border-radius:8px;margin-top:8px">
            <svg width="14" height="14" fill="none" stroke="rgba(99,102,241,.8)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <span id="pw-file-name" style="font-size:12px;color:rgba(99,102,241,.9);font-family:'Space Mono',monospace;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
            <button onclick="PW._clearFile()" style="background:none;border:none;color:rgba(255,255,255,.35);cursor:pointer;font-size:16px;padding:0;line-height:1;flex-shrink:0" title="Remove file">✕</button>
          </div>
          <div id="pw-img-preview" style="display:none;margin-top:8px;border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,.08);max-height:200px">
            <img id="pw-preview-img" src="" style="width:100%;max-height:200px;object-fit:contain;display:block">
          </div>
        </div>

        <div class="pw2-field">
          <label>Notes <span style="font-size:10px;color:rgba(255,255,255,.22);font-weight:400;text-transform:none;letter-spacing:0">(optional)</span></label>
          <textarea id="pw-notes" class="pw2-input" style="resize:vertical;min-height:68px;padding-top:10px;line-height:1.5" placeholder="Any additional information about your payment…"></textarea>
        </div>

        <div id="pw-err" class="pw-err"></div>

        <button class="pw2-btn-primary" id="pw-submit-btn" onclick="PW._submitProof()">
          <span id="pw-submit-lbl">Submit Payment Proof</span>
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </button>
        <button class="pw2-btn-ghost" onclick="PW._renderStep(2)">← Back to Payment Details</button>
      </div>
    `);

    // Drag and drop
    const zone = document.getElementById('pw-drop-zone');
    if (zone) {
      zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('pw2-drag-over'); });
      zone.addEventListener('dragleave', ()  => zone.classList.remove('pw2-drag-over'));
      zone.addEventListener('drop',      e  => {
        e.preventDefault();
        zone.classList.remove('pw2-drag-over');
        const f = e.dataTransfer.files[0];
        if (f) this._handleFile(f);
      });
    }
  },

  // ── Submit proof ─────────────────────────────────────────────────
  async _submitProof() {
    const ref    = (document.getElementById('pw-ref')?.value   || '').trim();
    const amt    = parseAmt(document.getElementById('pw-amt')?.value);
    const date   = document.getElementById('pw-date')?.value;
    const method = document.getElementById('pw-method-sel')?.value || 'bank_transfer';
    const notes  = (document.getElementById('pw-notes')?.value || '').trim();
    const errEl  = document.getElementById('pw-err');
    const btn    = document.getElementById('pw-submit-btn');
    const lbl    = document.getElementById('pw-submit-lbl');

    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

    if (!ref)              { this._showErr('Reference / TXN number is required.');              return; }
    if (!amt || amt <= 0)  { this._showErr('Please enter the exact amount you paid.');           return; }
    if (!date)             { this._showErr('Payment date is required.');                         return; }
    if (!this.receiptFile) { this._showErr('Please attach your payment receipt (image or PDF).'); return; }

    if (btn) btn.disabled = true;
    if (lbl) lbl.textContent = 'Uploading receipt…';

    try {
      const ext  = this.receiptFile.name.split('.').pop() || 'jpg';
      const path = `${S.cid}/${this.invoiceId || 'noinv'}/${Date.now()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from('payment-receipts')
        .upload(path, this.receiptFile, { upsert: false, contentType: this.receiptFile.type });
      if (upErr) throw new Error('Receipt upload failed: ' + upErr.message);

      const { data: { publicUrl } } = supabase.storage
        .from('payment-receipts')
        .getPublicUrl(path);

      if (lbl) lbl.textContent = 'Submitting proof…';

      const { data: res, error } = await supabase.rpc('submit_payment_proof', {
        p_company_id:         S.cid,
        p_invoice_id:         this.invoiceId  || null,
        p_submitted_by:       S.userId,
        p_payment_method_id:  null,
        p_payment_partner_id: null,
        p_reference_number:   ref,
        p_amount_paid:        amt,
        p_currency:           this.invoiceCurrency || 'PKR',
        p_payment_date:       date,
        p_receipt_url:        publicUrl || path,
        p_receipt_filename:   this.receiptFile.name,
        p_receipt_size_kb:    Math.ceil(this.receiptFile.size / 1024),
        p_payer_name:         null,
        p_payer_account:      null,
        p_notes:              notes || null
      });

      if (error) throw error;
      if (!res?.success) throw new Error(res?.error || 'Submission failed. Please try again.');

      // Update session status
      const sess = JSON.parse(sessionStorage.getItem('nxn_sess') || '{}');
      sess.subStatus = 'payment_under_review';
      sessionStorage.setItem('nxn_sess', JSON.stringify(sess));
      if (S) S.subStatus = 'payment_under_review';

      this._renderWaiting();

    } catch(e) {
      this._showErr(e.message || 'An error occurred. Please try again.');
      if (btn) btn.disabled = false;
      if (lbl) lbl.textContent = 'Submit Payment Proof';
    }
  },

  // ── Expired / Cancelled / Past-due screen ────────────────────────
  _renderExpired(subStatus) {
    const el = document.getElementById('s-payment-wall');
    if (!el) return;
    el.classList.add('on');
    document.getElementById('s-login')?.classList.remove('on');
    document.getElementById('s-app')?.classList.remove('on');

    const bar = document.getElementById('pw-step-bar');
    if (bar) bar.style.display = 'none';

    const meta = {
      expired:    ['Subscription Expired',    'Your subscription period has ended.'],
      cancelled:  ['Subscription Cancelled',  'Your subscription has been cancelled.'],
      past_due:   ['Payment Overdue',          'Your subscription payment is overdue.'],
    };
    const [title, sub] = meta[subStatus] || ['Subscription Inactive', 'Your subscription is no longer active.'];
    this._setTitle(title, '');

    const waNum  = '971556325362';
    const waText = encodeURIComponent(
      `Hi Nexunova Team, I need to renew my RMS subscription.\nCompany: ${S?.coName || ''}\nCompany Code: ${S?.coCode || ''}\nStatus: ${subStatus}\nPlease assist.`
    );

    this._setBody(`
      <div class="pw2-confirm-wrap">
        <div class="pw2-confirm-icon-ring" style="border-color:rgba(239,68,68,.25)">
          <svg width="38" height="38" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <div class="pw2-confirm-title">${_pwEsc(title)}</div>
        <div class="pw2-confirm-sub">
          ${_pwEsc(sub)}<br>
          Contact our team to renew and regain full access — usually activated within 2 hours.
        </div>
      </div>

      <a href="https://wa.me/${waNum}?text=${waText}" target="_blank" class="pw2-wa-btn" style="margin-top:28px">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="#25d366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.890-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
        Contact us on WhatsApp to Renew
      </a>
      <div style="margin-top:12px;text-align:center;font-size:12px;color:rgba(255,255,255,.3)">
        or email <a href="mailto:sales@nexunova.com" style="color:rgba(99,102,241,.8)">sales@nexunova.com</a>
      </div>
      <button class="pw2-btn-ghost" onclick="PW._logout()" style="margin-top:16px">Sign out</button>
    `);
  },

  // ── Waiting / Confirmation screen ────────────────────────────────
  _renderWaiting() {
    const el = document.getElementById('s-payment-wall');
    if (!el) return;
    el.classList.add('on');
    document.getElementById('s-login')?.classList.remove('on');
    document.getElementById('s-app')?.classList.remove('on');

    // Hide step bar on confirmation screen
    const bar = document.getElementById('pw-step-bar');
    if (bar) bar.style.display = 'none';

    this._setTitle('You\'re Almost There!', '');

    // WhatsApp number — update with actual Nexunova support number
    const waNum  = '971556325362';
    const waText = encodeURIComponent(
      `Hi Nexunova Team, I've submitted payment proof for my RMS subscription.\nCompany: ${S?.coName || ''}\nCompany Code: ${S?.coCode || ''}\nPlease verify when possible. Thank you!`
    );

    this._setBody(`
      <div class="pw2-confirm-wrap">
        <div class="pw2-confirm-icon-ring">
          <svg width="38" height="38" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <div class="pw2-confirm-title">Payment Proof Submitted!</div>
        <div class="pw2-confirm-sub">
          Our team reviews proofs between <strong style="color:rgba(255,255,255,.8)">9 AM – 10 PM PKT</strong>.<br>
          You'll get full access within <strong style="color:rgba(255,255,255,.8)">2 working hours</strong> of verification.
        </div>
      </div>

      <div class="pw2-timeline">
        <div class="pw2-tl-row pw2-tl-done">
          <div class="pw2-tl-dot-wrap">
            <div class="pw2-tl-dot pw2-tl-dot-done">
              <svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div class="pw2-tl-connector pw2-tl-connector-done"></div>
          </div>
          <div class="pw2-tl-content">
            <div class="pw2-tl-label">Account Created</div>
            <div class="pw2-tl-sub">Your workspace is set up and ready</div>
          </div>
        </div>
        <div class="pw2-tl-row pw2-tl-done">
          <div class="pw2-tl-dot-wrap">
            <div class="pw2-tl-dot pw2-tl-dot-done">
              <svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div class="pw2-tl-connector pw2-tl-connector-done"></div>
          </div>
          <div class="pw2-tl-content">
            <div class="pw2-tl-label">Payment Proof Submitted</div>
            <div class="pw2-tl-sub">Receipt received — awaiting review</div>
          </div>
        </div>
        <div class="pw2-tl-row pw2-tl-active">
          <div class="pw2-tl-dot-wrap">
            <div class="pw2-tl-dot pw2-tl-dot-active"></div>
            <div class="pw2-tl-connector"></div>
          </div>
          <div class="pw2-tl-content">
            <div class="pw2-tl-label">Verification in Progress</div>
            <div class="pw2-tl-sub">Typically within 2 hours · 9 AM–10 PM PKT</div>
          </div>
        </div>
        <div class="pw2-tl-row">
          <div class="pw2-tl-dot-wrap">
            <div class="pw2-tl-dot"></div>
          </div>
          <div class="pw2-tl-content">
            <div class="pw2-tl-label" style="color:rgba(255,255,255,.35)">Full Access Granted</div>
            <div class="pw2-tl-sub">Log in after verification to access your dashboard</div>
          </div>
        </div>
      </div>

      <div class="pw2-confirm-info">
        <svg width="14" height="14" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>
        <span>After verification, sign in with your credentials to access your full dashboard.</span>
      </div>

      <a href="https://wa.me/${waNum}?text=${waText}" target="_blank" class="pw2-wa-btn" style="margin-top:20px">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="#25d366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.890-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
        Message us on WhatsApp — We're here to help
      </a>
      <button class="pw2-btn-ghost" onclick="PW._logout()" style="margin-top:8px">Sign out</button>
    `);
  },

  // ── Helpers ──────────────────────────────────────────────────────
  _setTitle(title, sub) {
    const t = document.getElementById('pw-title');
    const s = document.getElementById('pw-sub');
    if (t) t.textContent = title;
    if (s) s.textContent = sub;
  },

  _setBody(html) {
    const b = document.getElementById('pw-body');
    if (b) b.innerHTML = html;
  },

  _showErr(msg) {
    const e = document.getElementById('pw-err');
    if (e) { e.textContent = msg; e.style.display = ''; }
  },

  _fmtAmt(amount, currency) {
    const cur = currency || 'PKR';
    const n   = parseFloat(amount) || 0;
    return cur + ' ' + n.toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  },

  _rejectionBanner() {
    const sess = JSON.parse(sessionStorage.getItem('nxn_sess') || '{}');
    if (!sess.lastRejectionReason) return '';
    return `
      <div class="pw2-rejection">
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:5px">
          <svg width="13" height="13" fill="none" stroke="rgba(239,68,68,.8)" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>
          <span style="font-size:12px;font-weight:700;color:rgba(239,68,68,.9)">Previous proof was rejected</span>
        </div>
        <div style="font-size:12px;color:rgba(255,255,255,.5);line-height:1.55">${_pwEsc(sess.lastRejectionReason)}</div>
        <div style="font-size:11px;color:rgba(255,255,255,.3);margin-top:6px">Please submit a new receipt addressing the reason above.</div>
      </div>`;
  },

  _onFileSelect(input) {
    if (input.files[0]) this._handleFile(input.files[0]);
  },

  _handleFile(file) {
    const allowed = ['image/jpeg','image/jpg','image/png','application/pdf'];
    if (!allowed.includes(file.type)) { this._showErr('Only JPG, PNG or PDF files are accepted.'); return; }
    if (file.size > 5 * 1024 * 1024) { this._showErr('File too large — maximum size is 5 MB.'); return; }
    this.receiptFile = file;

    const info    = document.getElementById('pw-file-info');
    const nameEl  = document.getElementById('pw-file-name');
    const prevWrap = document.getElementById('pw-img-preview');
    const prevImg  = document.getElementById('pw-preview-img');
    const inner   = document.getElementById('pw2-file-inner');
    const errEl   = document.getElementById('pw-err');
    if (errEl)   { errEl.style.display = 'none'; errEl.textContent = ''; }
    if (nameEl)  nameEl.textContent = file.name;
    if (info)    info.style.display = 'flex';
    if (inner)   inner.style.opacity = '.35';

    if (prevWrap && prevImg && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = e => { prevImg.src = e.target.result; prevWrap.style.display = ''; };
      reader.readAsDataURL(file);
    }
  },

  _clearFile() {
    this.receiptFile = null;
    const fi   = document.getElementById('pw-receipt-file'); if (fi) fi.value = '';
    const info = document.getElementById('pw-file-info');    if (info) info.style.display = 'none';
    const prev = document.getElementById('pw-img-preview');  if (prev) prev.style.display = 'none';
    const inner = document.getElementById('pw2-file-inner'); if (inner) inner.style.opacity = '';
  },

  _copy(elId, btn) {
    const el = document.getElementById(elId);
    if (!el) return;
    navigator.clipboard.writeText(el.textContent.trim()).then(() => {
      // New SVG-based buttons (.pmx-copy) have a <span> child holding the label.
      // Legacy buttons (.pw2-copy-btn) are plain text.
      const lbl = btn.querySelector('span');
      if (lbl) {
        const orig = lbl.textContent;
        lbl.textContent = 'Copied';
        btn.classList.add('copied');
        setTimeout(() => { lbl.textContent = orig; btn.classList.remove('copied'); }, 1600);
      } else {
        const orig = btn.textContent;
        btn.textContent = '✓ Copied';
        btn.style.cssText += ';background:rgba(16,185,129,.15)!important;color:#6ee7b7!important;border-color:rgba(16,185,129,.35)!important';
        setTimeout(() => {
          btn.textContent = orig;
          btn.style.background = '';
          btn.style.color = '';
          btn.style.borderColor = '';
        }, 1600);
      }
    }).catch(() => {});
  },

  _logout() {
    if (typeof doLogout === 'function') doLogout();
  }
};

function _pwEsc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtPKR(amount, currency) {
  const cur = currency || 'PKR';
  const n   = parseFloat(amount) || 0;
  return cur + ' ' + n.toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
