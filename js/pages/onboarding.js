// â•â• ONBOARDING WIZARD â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Post-signup: create first project â†’ add categories â†’ add first unit

const OB = {
  step: 1,
  companyId: null,

  show(companyId) {
    this.step = 1;
    this.companyId = companyId;
    const screen = document.getElementById('s-onboarding');
    if (!screen) return;
    document.getElementById('s-app').classList.remove('on');
    screen.classList.add('on');
    this._render();
  },

  hide() {
    const screen = document.getElementById('s-onboarding');
    if (screen) screen.classList.remove('on');
    document.getElementById('s-app').classList.add('on');
  },

  async skip() {
    await this._markComplete();
    this.hide();
    nav('dashboard');
  },

  async _markComplete() {
    if (!this.companyId) return;
    try {
      await supabase.rpc('mark_onboarding_complete', { p_company_id: this.companyId });
    } catch(e) { console.warn('[onboarding] markComplete:', e); }
  },

  _render() {
    const titles = ['Create Your First Project', 'Add Unit Categories', 'Done!'];
    const subs   = [
      'A project groups all units for one building or development',
      'Categories describe unit types (e.g. 2 Bed Apartment, Shop)',
      'Your workspace is ready to use'
    ];
    const t = document.getElementById('ob-title');
    const s = document.getElementById('ob-sub');
    if (t) t.textContent = titles[this.step - 1];
    if (s) s.textContent = subs[this.step - 1];

    document.querySelectorAll('.ob-panel').forEach((p, i) => {
      p.style.display = (i + 1 === this.step) ? '' : 'none';
    });

    const dots = document.querySelectorAll('.ob-dot');
    dots.forEach((d, i) => {
      d.classList.toggle('ob-dot-active', i + 1 === this.step);
      d.classList.toggle('ob-dot-done',   i + 1 < this.step);
    });
  },

  async saveProject() {
    const name = (document.getElementById('ob-proj-name')?.value || '').trim();
    if (!name) { toast('Project name is required', 'err'); return; }
    const loc  = (document.getElementById('ob-proj-loc')?.value  || '').trim();

    try {
      const code = name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5)
        + (100 + Math.floor(Math.random() * 900));
      const { error } = await supabase.from('projects').insert({
        company_id:   this.companyId,
        project_name: name,
        project_code: code,
        location:     loc || null,
        status:       'active'
      });
      if (error) throw error;
      if (typeof loadProjectsCache === 'function') await loadProjectsCache(this.companyId);
      this.step = 2;
      this._render();
    } catch(e) {
      toast(e.message || 'Failed to save project', 'err');
    }
  },

  async saveCategories() {
    const raw = (document.getElementById('ob-cats')?.value || '').trim();
    if (!raw) { this.step = 3; this._render(); return; }

    const names = raw.split('\n').map(l => l.trim()).filter(Boolean);
    const rows  = names.map((n, i) => ({
      company_id: this.companyId,
      type_code:  n.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || ('type_' + (i + 1)),
      type_name:  n,
      sort_order: i,
      is_active:  true
    }));

    try {
      const { error } = await supabase.from('category_unit_types').insert(rows);
      if (error) throw error;
      if (typeof loadTypesCache === 'function') await loadTypesCache(this.companyId);
      this.step = 3;
      this._render();
    } catch(e) {
      toast(e.message || 'Failed to save categories', 'err');
    }
  },

  async finish() {
    await this._markComplete();
    this.hide();
    nav('dashboard');
    toast('Welcome to Nexunova RMS!', 'ok');
    if(typeof TUT !== 'undefined') TUT.maybeShow();
  }
};

