const Api = (() => {
  const KEY = "gz_token";

  function getToken() {
    return localStorage.getItem(KEY);
  }

  function setToken(t) {
    localStorage.setItem(KEY, t);
  }

  function clearToken() {
    localStorage.removeItem(KEY);
  }

  async function request(path, options) {
    const headers = { "Content-Type": "application/json" };
    const token = getToken();
    if (token) headers["Authorization"] = "Bearer " + token;
    const res = await fetch(path, { ...(options || {}), headers });
    let body = {};
    try {
      body = await res.json();
    } catch (e) {
      body = { success: false, message: "Server error" };
    }
    if (res.status === 401 && !path.includes("/api/auth/login")) {
      clearToken();
      location.href = "/login.html";
      throw new Error("Unauthorized");
    }
    if (!body.success) throw new Error(body.message || "Request failed");
    return body.data;
  }

  function requireAuth() {
    if (!getToken()) location.href = "/login.html";
  }

  function logout() {
    clearToken();
    location.href = "/login.html";
  }

  return {
    getToken,
    setToken,
    clearToken,
    requireAuth,
    logout,
    login: (email, password) =>
      request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
    sendNotification: (title, body, imageUrl) =>
      request("/api/notifications/send", {
        method: "POST",
        body: JSON.stringify({ title, body, imageUrl: imageUrl || "" }),
      }),
    getHistory: (page, limit, cursor) =>
      request(`/api/notifications/history?page=${page || 1}&limit=${limit || 20}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),
    getStats: () => request("/api/notifications/stats"),
    getUsers: (page, limit, q, cursor) =>
      request(`/api/users?page=${page || 1}&limit=${limit || 20}${q ? `&q=${encodeURIComponent(q)}` : ""}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),
    getDeposits: (page, limit, uid) =>
      request(`/api/deposits?page=${page || 1}&limit=${limit || 20}${uid ? `&uid=${encodeURIComponent(uid)}` : ""}`),
    banUser: (uid, reason) =>
      request(`/api/users/${uid}/ban`, { method: "POST", body: JSON.stringify({ reason: reason || "" }) }),
    unbanUser: (uid) => request(`/api/users/${uid}/unban`, { method: "POST", body: "{}" }),
    getSettings: () => request("/api/settings"),
    saveSettings: (s) =>
      request("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          supportUrl: s.supportUrl || "",
          announcement: s.announcement || "",
          rules: s.rules || "",
          referCoins: s.referCoins !== undefined ? s.referCoins : 5,
          downloadUrl: s.downloadUrl || "",
          latestVersion: s.latestVersion || "",
          faq: s.faq || "",
          about: s.about || "",
          privacy: s.privacy || "",
          terms: s.terms || "",
          banners: Array.isArray(s.banners) ? s.banners : [],
        }),
      }),
    getHealth: () => fetch("/api/health").then((r) => r.json()),
    getPaymentConfig: () => request("/api/payment-config"),
    savePaymentConfig: (zapKey) =>
      request("/api/payment-config", {
        method: "PUT",
        body: JSON.stringify({ zapKey }),
      }),
    getCategories: () => fetch("/api/categories").then((r) => r.json()).then((b) => { if (!b.success) throw new Error(b.message); return b.data; }),
    addCategory: (name, img) =>
      request("/api/categories", { method: "POST", body: JSON.stringify({ name, img }) }),
    updateCategory: (id, name, img) =>
      request(`/api/categories/${id}`, { method: "PUT", body: JSON.stringify({ name, img }) }),
    deleteCategory: (id) => request(`/api/categories/${id}`, { method: "DELETE" }),
    getMatches: (categoryId, status) => {
      const p = new URLSearchParams();
      if (categoryId) p.set("categoryId", categoryId);
      if (status) p.set("status", status);
      const q = p.toString() ? "?" + p.toString() : "";
      return fetch("/api/matches" + q).then((r) => r.json()).then((b) => { if (!b.success) throw new Error(b.message); return b.data; });
    },
    getMatch: (id) => fetch(`/api/matches/${id}`).then((r) => r.json()).then((b) => { if (!b.success) throw new Error(b.message); return b.data; }),
    createMatch: (payload) => request("/api/matches", { method: "POST", body: JSON.stringify(payload) }),
    updateMatch: (id, payload) => request(`/api/matches/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
    deleteMatch: (id) => request(`/api/matches/${id}`, { method: "DELETE" }),
  };
})();
