const NEXORA_URL = 'https://apiyxejlcinagzrrhfeg.supabase.co';
const NEXORA_KEY = 'sb_publishable_RTEtuRaeIRv7nokrZ0Y9-Q_tQs5PTiA';
const FREE_STORAGE_MB = 500;
const PREMIUM_PRICE_INR = 299;

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

  async getUser() {
    try {
      const { data: { user } } = await this.client().auth.getUser();
      this._currentUser = user; return user;
    } catch(e) { return null; }
  },

  async getProfile(userId) {
    if (!userId) return null;
    const { data } = await this.client().from('profiles').select('*').eq('id', userId).maybeSingle();
    this._currentProfile = data; return data;
  },

  async signUp(email, password, meta) {
    const { data, error } = await this.client().auth.signUp({
      email, password, options: { data: { full_name: meta.fullName } }
    });
    if (!error && data.user) {
      await this.client().from('profiles').update({
        full_name: meta.fullName, email,
        school_name: meta.schoolName,
        field_of_study: meta.fieldOfStudy,
        study_level: meta.studyLevel,
        language: meta.language || 'en'
      }).eq('id', data.user.id);
    }
    return { data, error };
  },

  async signIn(email, password) {
    return await this.client().auth.signInWithPassword({ email, password });
  },

  async signOut() {
    await this.client().auth.signOut();
    this._currentUser = null; this._currentProfile = null;
    window.location.href = 'nexora_index.html';
  },

  isPremium() { return this._currentProfile?.plan === 'premium'; },

  async initUI() {
    const user = await this.getUser();
    if (user) { await this.getProfile(user.id); this.updateNotificationBadge(); }
    this.updateHeaderAvatar();
  },

  updateHeaderAvatar() {
    const user = this._currentUser;
    const profile = this._currentProfile;
    document.querySelectorAll('[data-nexora-avatar]').forEach(el => {
      if (user) {
        const name = profile?.full_name || user.email || '';
        const initials = name.split(/[\s@]/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0,2) || '?';
        el.textContent = initials;
        el.style.cssText = 'width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#4f8aff,#a78bfa);color:#fff;display:flex;align-items:center;justify-content:center;font-size:0.8rem;font-weight:700;text-decoration:none;cursor:pointer;flex-shrink:0;';
        el.href = 'nexora_profil.html';
        if (profile?.plan === 'premium') el.style.boxShadow = '0 0 0 2.5px #a78bfa';
      } else {
        el.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>';
        el.style.cssText = '';
        el.href = 'nexora_login.html';
      }
    });
  },

  async updateNotificationBadge() {
    const user = this._currentUser;
    if (!user) return;
    const { data } = await this.client().from('notifications').select('id').eq('user_id', user.id).eq('is_read', false);
    const count = data?.length || 0;
    document.querySelectorAll('[data-nexora-notif]').forEach(el => {
      el.textContent = count; el.style.display = count > 0 ? 'flex' : 'none';
    });
  },

  async getDocuments(filters = {}) {
    const user = await this.getUser();
    const profile = user ? await this.getProfile(user.id) : null;
    const isPremium = profile?.plan === 'premium';
    let q = this.client().from('documents').select('*, profiles(full_name, school_name)').eq('is_approved', true).order('created_at', { ascending: false });
    if (filters.schoolName) q = q.eq('school_name', filters.schoolName);
    if (filters.subject)    q = q.ilike('subject', `%${filters.subject}%`);
    if (filters.docType)    q = q.eq('doc_type', filters.docType);
    if (filters.level)      q = q.eq('study_level', filters.level);
    if (filters.search)     q = q.ilike('title', `%${filters.search}%`);
    if (filters.limit)      q = q.limit(filters.limit);
    const { data, error } = await q;
    if (error) return [];
    if (!isPremium) {
      const userSchool = profile?.school_name;
      return (data||[]).filter(doc => !doc.is_premium_only || doc.school_name === userSchool);
    }
    return data || [];
  },

  async uploadDocument(docData) {
    const user = await this.getUser();
    if (!user) return { error: { message: 'Not authenticated' } };
    const profile = await this.getProfile(user.id);
    if (profile?.plan !== 'premium' && (profile?.storage_used_mb || 0) >= FREE_STORAGE_MB)
      return { error: { message: 'Storage limit reached. Upgrade to Premium.' } };
    const { data, error } = await this.client().from('documents').insert({
      ...docData, uploader_id: user.id, school_name: profile?.school_name || docData.school_name
    }).select().single();
    if (!error) {
      await this.client().from('profiles').update({
        documents_uploaded: (profile?.documents_uploaded||0)+1,
        storage_used_mb: (profile?.storage_used_mb||0)+(docData.file_size_mb||0)
      }).eq('id', user.id);
    }
    return { data, error };
  },

  async saveDocument(documentId) {
    const user = await this.getUser();
    if (!user) return null;
    const { data: ex } = await this.client().from('saved_documents').select('id').eq('user_id', user.id).eq('document_id', documentId).maybeSingle();
    if (ex) { await this.client().from('saved_documents').delete().eq('id', ex.id); return false; }
    await this.client().from('saved_documents').insert({ user_id: user.id, document_id: documentId });
    return true;
  },

  async getListings(filters = {}) {
    let q = this.client().from('marketplace').select('*, profiles(full_name, school_name)').eq('is_active', true).eq('is_sold', false).order('created_at', { ascending: false });
    if (filters.category)    q = q.eq('category', filters.category);
    if (filters.schoolName)  q = q.eq('school_name', filters.schoolName);
    if (filters.listingType) q = q.eq('listing_type', filters.listingType);
    if (filters.search)      q = q.ilike('title', `%${filters.search}%`);
    if (filters.limit)       q = q.limit(filters.limit);
    const { data, error } = await q;
    return error ? [] : (data||[]);
  },

  async createListing(listingData) {
    const user = await this.getUser();
    if (!user) return { error: { message: 'Not authenticated' } };
    const profile = await this.getProfile(user.id);
    return await this.client().from('marketplace').insert({
      ...listingData, seller_id: user.id, school_name: profile?.school_name
    }).select().single();
  },

  async getTutors(filters = {}) {
    let q = this.client().from('tutoring').select('*, profiles(full_name, school_name)').eq('is_active', true).order('rating', { ascending: false });
    if (filters.subject)    q = q.ilike('subject', `%${filters.subject}%`);
    if (filters.schoolName) q = q.eq('school_name', filters.schoolName);
    if (filters.mode)       q = q.eq('mode', filters.mode);
    if (filters.isFree)     q = q.eq('is_free', true);
    if (filters.limit)      q = q.limit(filters.limit);
    const { data, error } = await q;
    return error ? [] : (data||[]);
  },

  async createTutoringOffer(offerData) {
    const user = await this.getUser();
    if (!user) return { error: { message: 'Not authenticated' } };
    const profile = await this.getProfile(user.id);
    return await this.client().from('tutoring').insert({
      ...offerData, tutor_id: user.id, school_name: profile?.school_name
    }).select().single();
  },

  async requestTutoring(tutoringId, tutorId, message) {
    const user = await this.getUser();
    if (!user) return { error: { message: 'Not authenticated' } };
    const { data, error } = await this.client().from('tutoring_requests').insert({
      student_id: user.id, tutor_id: tutorId, tutoring_id: tutoringId, message
    }).select().single();
    if (!error) await this.sendNotification(tutorId, 'New tutoring request', 'Someone wants to learn from you!', 'request');
    return { data, error };
  },

  async getMessages(otherUserId) {
    const user = await this.getUser();
    if (!user) return [];
    const { data } = await this.client().from('messages').select('*')
      .or(`and(sender_id.eq.${user.id},receiver_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},receiver_id.eq.${user.id})`)
      .order('created_at', { ascending: true });
    await this.client().from('messages').update({ is_read: true }).eq('sender_id', otherUserId).eq('receiver_id', user.id);
    return data || [];
  },

  async sendMessage(receiverId, content) {
    const user = await this.getUser();
    if (!user) return null;
    return await this.client().from('messages').insert({ sender_id: user.id, receiver_id: receiverId, content }).select().single();
  },

  async getPerformance() {
    const user = await this.getUser();
    if (!user) return [];
    const { data } = await this.client().from('performance').select('*').eq('user_id', user.id).order('date', { ascending: false });
    return data || [];
  },

  async addPerformanceEntry(entry) {
    const user = await this.getUser();
    if (!user) return null;
    return await this.client().from('performance').insert({ ...entry, user_id: user.id }).select().single();
  },

  async getNotifications() {
    const user = await this.getUser();
    if (!user) return [];
    const { data } = await this.client().from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20);
    return data || [];
  },

  async sendNotification(userId, title, message, type) {
    await this.client().from('notifications').insert({ user_id: userId, title, message, type });
  },

  async markAllNotificationsRead() {
    const user = await this.getUser();
    if (!user) return;
    await this.client().from('notifications').update({ is_read: true }).eq('user_id', user.id);
    this.updateNotificationBadge();
  },

  async getSchools() {
    const { data } = await this.client().from('schools').select('*').order('name');
    return data || [];
  },

  async upgradeToPremium(paymentMethod, transactionId) {
    const user = await this.getUser();
    if (!user) return false;
    const expiresAt = new Date(); expiresAt.setMonth(expiresAt.getMonth()+1);
    await this.client().from('subscriptions').insert({
      user_id: user.id, plan: 'premium', status: 'active',
      payment_method: paymentMethod, amount: PREMIUM_PRICE_INR,
      currency: 'INR', expires_at: expiresAt.toISOString(),
    });
    await this.client().from('profiles').update({ plan: 'premium' }).eq('id', user.id);
    await this.sendNotification(user.id, 'Welcome to Premium!', 'You now have access to all schools and unlimited storage.', 'premium');
    return true;
  },
};

function showToast(msg, type) {
  const colors = { success:'#34d399', error:'#f87171', info:'#4f8aff', warning:'#fbbf24' };
  const color = colors[type] || colors.info;
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = `position:fixed;bottom:28px;right:28px;background:${color};color:#fff;padding:14px 22px;border-radius:10px;font-size:0.85rem;font-weight:500;z-index:99999;opacity:0;transition:opacity 0.25s;font-family:'Inter',sans-serif;max-width:320px;box-shadow:0 8px 32px rgba(0,0,0,0.3);`;
  document.body.appendChild(t);
  setTimeout(() => t.style.opacity='1', 10);
  setTimeout(() => { t.style.opacity='0'; setTimeout(()=>t.remove(),300); }, 3000);
}

async function requireAuth(redirectTo) {
  return new Promise(resolve => {
    NX.ready(async () => {
      const user = await NX.getUser();
      if (!user) { window.location.href = `nexora_login.html?redirect=${redirectTo||window.location.pathname}`; resolve(false); }
      else resolve(true);
    });
  });
}
