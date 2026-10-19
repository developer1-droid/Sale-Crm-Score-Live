// Talks to the deployed CRM exactly like a logged-in browser would:
// Firebase email/password -> idToken -> POST /api/auth/login -> `session` cookie.
// Every data call sends that cookie; a 401 triggers one re-login + retry.

const IDENTITY_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword';
const REFRESH_URL = 'https://securetoken.googleapis.com/v1/token';
const REQUEST_TIMEOUT_MS = 60_000;
// Firebase idTokens live 1h; refresh a little early.
const ID_TOKEN_REFRESH_MS = 50 * 60 * 1000;

function withTimeout(ms) {
  return AbortSignal.timeout(ms);
}

function readSessionCookie(res) {
  const all = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie') || ''];
  for (const line of all) {
    const m = /(?:^|,\s*)session=([^;]+)/.exec(line);
    if (m) return m[1];
  }
  return null;
}

function firestoreValue(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(firestoreValue);
  if ('mapValue' in v) {
    return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, firestoreValue(x)]));
  }
  return null;
}

export function createCrmClient({ baseUrl, apiKey, projectId, email, password }) {
  let session = null;
  let idToken = null;
  let refreshToken = null;
  let idTokenAt = 0;
  let loginPromise = null;

  async function firebaseSignIn() {
    const res = await fetch(`${IDENTITY_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
      signal: withTimeout(REQUEST_TIMEOUT_MS),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.idToken) {
      throw new Error(`Firebase sign-in failed: ${json?.error?.message || res.status}`);
    }
    idToken = json.idToken;
    refreshToken = json.refreshToken;
    idTokenAt = Date.now();
  }

  async function freshIdToken() {
    if (idToken && Date.now() - idTokenAt < ID_TOKEN_REFRESH_MS) return idToken;
    if (!refreshToken) {
      await firebaseSignIn();
      return idToken;
    }
    const res = await fetch(`${REFRESH_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
      signal: withTimeout(REQUEST_TIMEOUT_MS),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.id_token) {
      await firebaseSignIn();
      return idToken;
    }
    idToken = json.id_token;
    refreshToken = json.refresh_token || refreshToken;
    idTokenAt = Date.now();
    return idToken;
  }

  async function doLogin() {
    await firebaseSignIn();
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
      signal: withTimeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`CRM login failed (${res.status}): ${body?.error || 'unknown error'}`);
    }
    const cookie = readSessionCookie(res);
    if (!cookie) throw new Error('CRM login succeeded but no session cookie was returned');
    session = cookie;
  }

  // Concurrent callers share one in-flight login.
  function login() {
    if (!loginPromise) {
      loginPromise = doLogin().finally(() => { loginPromise = null; });
    }
    return loginPromise;
  }

  async function getJson(path, { retried = false, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    if (!session) await login();
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { Cookie: `session=${session}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: withTimeout(timeoutMs),
    });
    if (res.status === 401 && !retried) {
      session = null;
      await login();
      return getJson(path, { retried: true, timeoutMs });
    }
    if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
    return res.json();
  }

  // systemSettings/globalCutoffDates is only reachable through Firestore (the page
  // reads it with the client SDK), so read it over Firestore REST as the same user.
  async function getCutoffDates() {
    const token = await freshIdToken();
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}`
      + '/databases/(default)/documents/systemSettings/globalCutoffDates';
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: withTimeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 404) return { crmFms: '', soFms: '', designReq: '' };
    if (!res.ok) throw new Error(`Firestore cutoffs -> HTTP ${res.status}`);
    const json = await res.json();
    const fields = json.fields || {};
    const decoded = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, firestoreValue(v)]));
    return { crmFms: '', soFms: '', designReq: '', ...decoded };
  }

  return { login, getJson, getCutoffDates };
}
