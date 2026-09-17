/* ===================================================================
   BINGO — cliente da API (login, sessão e leitura/escrita do estado)

   Antes desta versão, js/state.js lia e gravava tudo direto no
   localStorage. Agora ele pede pra este arquivo, que fala com o
   backend (api/) por HTTP. O formato dos dados (config/game/cards/
   history) continua o mesmo de sempre — só o "onde fica salvo" mudou.
=================================================================== */

const API_BASE = '/api';
const REFRESH_TOKEN_KEY = 'bingo_refresh_token_v1';

/**
 * Estado da sessão atual: quem está logado e, se for o Master, qual
 * usuário ele escolheu visualizar no filtro do topo (viewingUserId).
 * Quando viewingUserId é diferente do próprio id, a sessão está em
 * modo observação (somente leitura) — ver isObserving().
 */
const Session = {
  accessToken: null,
  refreshToken: null,
  user: null,
  viewingUserId: null,

  isMaster() {
    return !!this.user && this.user.role === 'master';
  },
  isObserving() {
    return this.isMaster() && !!this.viewingUserId && this.viewingUserId !== this.user.id;
  },
};

// sessionStorage (não localStorage) de propósito: a sessão precisa
// sobreviver a um F5, mas não pode sobreviver a fechar o navegador —
// isso é o que garante o logoff automático ao fechar a aba/navegador
// ou desligar o computador, sem precisar de nenhum timer pra isso.
function loadStoredRefreshToken() {
  try {
    return sessionStorage.getItem(REFRESH_TOKEN_KEY);
  } catch (e) {
    return null;
  }
}
function storeRefreshToken(token) {
  try {
    if (token) sessionStorage.setItem(REFRESH_TOKEN_KEY, token);
    else sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch (e) {
    // sessionStorage indisponível (aba anônima restrita etc.) — a sessão
    // simplesmente não sobrevive a um recarregamento da página.
  }
}

const Api = {
  async login(email, password) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error('invalid_credentials');
    const data = await res.json();
    Session.accessToken = data.accessToken;
    Session.refreshToken = data.refreshToken;
    Session.user = data.user;
    Session.viewingUserId = data.user.id;
    storeRefreshToken(data.refreshToken);
    return data.user;
  },

  logout() {
    Session.accessToken = null;
    Session.refreshToken = null;
    Session.user = null;
    Session.viewingUserId = null;
    storeRefreshToken(null);
  },

  /** Tenta reaproveitar a sessão salva (refresh token) ao abrir o app. */
  async trySilentLogin() {
    const refreshToken = loadStoredRefreshToken();
    if (!refreshToken) return null;
    Session.refreshToken = refreshToken;
    const ok = await this._refreshAccessToken();
    if (!ok) {
      storeRefreshToken(null);
      Session.refreshToken = null;
      return null;
    }
    Session.viewingUserId = Session.user.id;
    return Session.user;
  },

  async _refreshAccessToken() {
    if (!Session.refreshToken) return false;
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: Session.refreshToken }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      Session.accessToken = data.accessToken;
      Session.user = data.user;
      return true;
    } catch (e) {
      return false;
    }
  },

  /** fetch autenticado, com uma tentativa automática de renovar o token em 401. */
  async request(path, opts = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (Session.accessToken) headers.Authorization = `Bearer ${Session.accessToken}`;
    let res = await fetch(API_BASE + path, { ...opts, headers });
    if (res.status === 401 && Session.refreshToken) {
      const ok = await this._refreshAccessToken();
      if (ok) {
        headers.Authorization = `Bearer ${Session.accessToken}`;
        res = await fetch(API_BASE + path, { ...opts, headers });
      }
    }
    return res;
  },

  async fetchState(key) {
    const qs = Session.isObserving() ? `?as=${encodeURIComponent(Session.viewingUserId)}` : '';
    const res = await this.request(`/state/${key}${qs}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.value;
  },

  async saveState(key, value) {
    // Defesa extra no cliente — o backend já rejeita isso (403) de
    // qualquer forma, mas evita até tentar a requisição.
    if (Session.isObserving()) return;
    try {
      const res = await this.request(`/state/${key}`, { method: 'PUT', body: JSON.stringify({ value }) });
      if (!res.ok) throw new Error('save_failed');
    } catch (e) {
      if (typeof showToast === 'function') showToast(`Falha ao salvar (${key}). Verifique sua conexão.`);
    }
  },

  async changePassword(currentPassword, newPassword) {
    const res = await this.request('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'error');
    }
  },

  async listUsers() {
    const res = await this.request('/users');
    if (!res.ok) return [];
    const data = await res.json();
    return data.users;
  },

  async createUser(name, email, password, role) {
    const res = await this.request('/users', { method: 'POST', body: JSON.stringify({ name, email, password, role }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'error');
    return body.user;
  },

  async setUserActive(id, active) {
    const res = await this.request(`/users/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) });
    if (!res.ok) throw new Error('error');
  },

  async updateUser(id, { name, email, role }) {
    const res = await this.request(`/users/${id}`, { method: 'PATCH', body: JSON.stringify({ name, email, role }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'error');
    return body.user;
  },

  async deleteUser(id) {
    const res = await this.request(`/users/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('error');
  },

  async resetUserPassword(id, newPassword) {
    const res = await this.request(`/users/${id}/password`, {
      method: 'PATCH',
      body: JSON.stringify({ newPassword }),
    });
    if (!res.ok) throw new Error('error');
  },

  async fetchPermissions() {
    const res = await this.request('/permissions');
    if (!res.ok) return null;
    const data = await res.json();
    return data.value;
  },

  async savePermissions(value) {
    const res = await this.request('/permissions', { method: 'PUT', body: JSON.stringify({ value }) });
    if (!res.ok) throw new Error('error');
  },
};
