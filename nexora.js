// ============================================================
// NEXORA — Supabase Backend
// Include in all pages: <script src="nexora.js"></script>
// ============================================================

const NEXORA_URL = 'https://apiyxejlcinagzrrhfeg.supabase.co';
const NEXORA_KEY = 'sb_publishable_RTEtuRaeIRv7nokrZ0Y9-Q_tQs5PTiA';
const ADMIN_EMAIL = 'chrisngot17@gmail.com';
const FREE_STORAGE_MB = 500;

(function loadSupabase() {
  if (window.supabase) return;
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
  s.onload = () => {
    window._nx = window.supabase.createClient(NEXORA_URL, NEXORA_KEY);
    NX.onReady();
  };
  document.head.appendChild(s);
})();

const NX = {
  _readyCallbacks: [], _ready: false,
  _currentUser: null, _currentProfile: null,

  onReady() {
    this._ready = true;
    this._readyCallbacks.forEach(fn => fn());
    this._readyCallbacks = [];
    this.initUI();
  },
  ready(fn) { if (this._ready) fn(); else this._readyCallbacks.push(fn); },
  client() { return window._nx; },

  // AUTH
  async getUser() {
    if (this._currentUser) return this._currentUser;
    const { data: { user } } = await this.client().auth.getUser();
    this._currentUser = user;
    return user;
  },
  async getProfile() {
    if (this._currentProfile) return this._currentProfile;
    const user = await this.getUser();
    if (!user) return null;
    const { data } = await this.client().from('profiles').select('*').eq('id', user.id).maybeSingle();
    this._currentProfile = data;
    return data;
  },
  async signUp(email, password, meta) {
    const { data, error } = await this.client().auth.signUp({
      email, password, options: { data: { full_name: meta.fullName } }
    });
    if (!error && data.user) {
      await this.client().from('profiles').upsert({
        id: data.user.id, full_name: meta.fullName, email,
        school_name: meta.schoolName, field_of_study: meta.fieldOfStudy,
        study_level: meta.studyLevel, language: meta.language || 'en'
      });
    }
    return { data, error };
  },
  async signIn(email, password) {
    const { data, error } = await this.client().auth.signInWithPassword({ email, password });
    if (!error) { this._currentUser = data.user; this._currentProfile = null; }
    return { data, error };
  },
  async signOut() {
    await this.client().auth.signOut();
    this._currentUser = null; this._currentProfile = null;
    window.location.href = 'index.html';
  },
  isPremium(profile) { return profile && profile.plan === 'premium'; },
  isAdmin(user) { return user && user.email === ADMIN_EMAIL; },

  // UI
  async initUI() {
    const user = await this.getUser();
    const profile = user ? await this.getProfile() : null;
    this.renderNavAvatar(user, profile);
  },
  async renderNavAvatar(user, profile) {
    const el = document.getElementById('nav-avatar');
    const signinEl = document.getElementById('nav-signin');
    if (!el) return;
    if (user && profile) {
      const name = profile.full_name || user.email || '';
      const initials = name.split(/[\s@]/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0,2) || '?';
      const premium = this.isPremium(profile);
      el.style.display = 'flex';
      el.innerHTML = `
        <div class="nxav ${premium?'prem':''}">${initials}${premium?'<span class="nxcrown">★</span>':''}</div>
        <div class="nxdrop">
          <div class="nxdrop-head">
            <strong>${name}</strong>
            <span>${profile.school_name||''} · ${profile.study_level||''}</span>
            ${premium?'<span class="nxbadge gold">★ Premium</span>':'<span class="nxbadge blue">Free</span>'}
          </div>
          <a href="dashboard.html">🏠 Dashboard</a>
          <a href="bibliotheque.html">📚 Library</a>
          <a href="marketplace.html">🛒 Marketplace</a>
          <a href="tutoring.html">🎓 Tutoring</a>
          <a href="profil.html">👤 My Profile</a>
          ${this.isAdmin(user)?'<a href="admin.html">⚙️ Admin</a>':''}
          <div class="nxdivider"></div>
          <a href="#" onclick="NX.signOut();return false;" class="signout-link">Sign Out</a>
        </div>`;
      if (signinEl) signinEl.style.display = 'none';
    } else {
      el.style.display = 'none';
      if (signinEl) signinEl.style.display = 'flex';
    }
  },

  // SCHOOLS
  async getSchools() {
    const { data } = await this.client().from('schools').select('*').order('name');
    return data || [];
  },

  // DOCUMENTS
  async getDocuments(filters = {}) {
    const user = await this.getUser();
    const profile = user ? await this.getProfile() : null;
    const premium = this.isPremium(profile);
    let q = this.client().from('documents').select('*, profiles(full_name,school_name)').eq('is_approved', true);
    if (filters.school_name && !premium) q = q.eq('school_name', filters.school_name);
    if (filters.doc_type) q = q.eq('doc_type', filters.doc_type);
    if (filters.search)   q = q.ilike('title', `%${filters.search}%`);
    if (filters.subject)  q = q.ilike('subject', `%${filters.subject}%`);
    if (!premium) q = q.eq('is_premium_only', false);
    q = q.order('created_at', { ascending: false });
    if (filters.limit) q = q.limit(filters.limit);
    const { data } = await q;
    return data || [];
  },

  // MARKETPLACE
  async getListings(filters = {}) {
    let q = this.client().from('marketplace').select('*, profiles(full_name,school_name,phone)').eq('is_active',true).eq('is_sold',false);
    if (filters.category) q = q.eq('category', filters.category);
    if (filters.search)   q = q.ilike('title', `%${filters.search}%`);
    q = q.order('created_at', { ascending: false });
    if (filters.limit) q = q.limit(filters.limit);
    const { data } = await q;
    return data || [];
  },
  async createListing(listingData) {
    const user = await this.getUser();
    const profile = await this.getProfile();
    if (!user) return { error: 'Not authenticated' };
    const { data, error } = await this.client().from('marketplace').insert({ ...listingData, seller_id: user.id, school_name: profile?.school_name||'' }).select().single();
    return { data, error };
  },

  // TUTORING
  async getTutors(filters = {}) {
    let q = this.client().from('tutoring').select('*, profiles(full_name,school_name)').eq('is_active',true);
    if (filters.subject) q = q.ilike('subject', `%${filters.subject}%`);
    if (filters.is_free) q = q.eq('is_free', true);
    if (filters.limit)   q = q.limit(filters.limit);
    q = q.order('rating', { ascending: false });
    const { data } = await q;
    return data || [];
  },

  // PERFORMANCE
  async getPerformance() {
    const user = await this.getUser();
    if (!user) return [];
    const { data } = await this.client().from('performance').select('*').eq('user_id', user.id).order('date', { ascending: false });
    return data || [];
  },
  async addPerformanceEntry(entry) {
    const user = await this.getUser();
    if (!user) return { error: 'Not authenticated' };
    return await this.client().from('performance').insert({ ...entry, user_id: user.id }).select().single();
  },

  // NOTIFICATIONS
  async getNotifications() {
    const user = await this.getUser();
    if (!user) return [];
    const { data } = await this.client().from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20);
    return data || [];
  },

  // HELPERS
  requireAuth() {
    this.ready(async () => {
      const user = await this.getUser();
      if (!user) window.location.href = 'login.html';
    });
  },
  timeAgo(d) {
    const mins = Math.floor((Date.now() - new Date(d)) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins/60);
    if (hrs < 24) return hrs + 'h ago';
    return Math.floor(hrs/24) + 'd ago';
  },
  toast(msg, type) {
    const colors = { success:'#10b981', error:'#ef4444', info:'#4f8aff', warning:'#f59e0b' };
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = `position:fixed;bottom:28px;right:28px;background:${colors[type||'success']};color:#fff;padding:14px 22px;border-radius:10px;font-size:0.85rem;font-family:'Inter',sans-serif;z-index:9999;opacity:0;transition:opacity 0.25s;max-width:320px;box-shadow:0 8px 24px rgba(0,0,0,0.3);`;
    document.body.appendChild(t);
    setTimeout(() => t.style.opacity='1', 10);
    setTimeout(() => { t.style.opacity='0'; setTimeout(() => t.remove(), 300); }, 3000);
  }
};

// Inject nav avatar CSS
const s = document.createElement('style');
s.textContent = `
#nav-avatar{position:relative;display:none;align-items:center;}
.nxav{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#4f8aff,#a78bfa);color:#fff;display:flex;align-items:center;justify-content:center;font-family:'Syne',sans-serif;font-size:0.85rem;font-weight:700;cursor:pointer;position:relative;border:2px solid transparent;}
.nxav.prem{border-color:#f59e0b;box-shadow:0 0 12px rgba(245,158,11,0.3);}
.nxcrown{position:absolute;top:-6px;right:-4px;font-size:0.6rem;color:#f59e0b;}
.nxdrop{position:absolute;top:calc(100% + 12px);right:0;background:#0f1117;border:1px solid rgba(255,255,255,0.1);border-radius:12px;min-width:230px;padding:8px;box-shadow:0 20px 60px rgba(0,0,0,0.5);display:none;flex-direction:column;gap:2px;z-index:200;}
#nav-avatar:hover .nxdrop{display:flex;}
.nxdrop-head{padding:10px 12px 12px;border-bottom:1px solid rgba(255,255,255,0.06);margin-bottom:4px;display:flex;flex-direction:column;gap:4px;}
.nxdrop-head strong{font-size:0.88rem;color:#f0f2f5;}
.nxdrop-head span{font-size:0.75rem;color:#8892a4;}
.nxdrop a{padding:9px 12px;border-radius:8px;font-size:0.84rem;color:#8892a4;text-decoration:none;transition:all 0.15s;display:block;}
.nxdrop a:hover{background:rgba(255,255,255,0.05);color:#f0f2f5;}
.signout-link{color:#ef4444!important;}
.nxdivider{height:1px;background:rgba(255,255,255,0.06);margin:4px 0;}
.nxbadge{padding:2px 8px;border-radius:100px;font-size:0.65rem;font-weight:700;display:inline-block;}
.nxbadge.gold{background:rgba(245,158,11,0.15);color:#f59e0b;border:1px solid rgba(245,158,11,0.3);}
.nxbadge.blue{background:rgba(79,138,255,0.1);color:#4f8aff;border:1px solid rgba(79,138,255,0.2);}
`;
document.head.appendChild(s);
