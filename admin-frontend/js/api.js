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
    getHistory: (page, limit) =>
      request(`/api/notifications/history?page=${page || 1}&limit=${limit || 20}`),
    getStats: () => request("/api/notifications/stats"),
    getHealth: () => fetch("/api/health").then((r) => r.json()),
  };
})();
