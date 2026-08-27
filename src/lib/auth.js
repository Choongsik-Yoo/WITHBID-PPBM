import crypto from "node:crypto";

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const encode = (value) => Buffer.from(value).toString("base64url");

export function normalizeUsers(users = []) {
  const unique = new Map();
  for (const item of users) {
    const email = normalizeEmail(item.email);
    if (!/^\S+@\S+\.\S+$/.test(email)) continue;
    unique.set(email, {
      name:String(item.name || email).trim(), email,
      role:item.role === "admin" ? "admin" : "member",
      enabled:item.enabled !== false,
    });
  }
  return [...unique.values()];
}

export function createSession(user, secret, now = Date.now()) {
  const payload = encode(JSON.stringify({
    email:user.email, name:user.name, role:user.role,
    exp:now + 8 * 60 * 60 * 1000,
  }));
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function readSession(token, secret, users, now = Date.now()) {
  try {
    const [payload, signature] = String(token || "").split(".");
    if (!payload || !signature) return null;
    const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!session.exp || session.exp <= now) return null;
    const user = normalizeUsers(users).find((item) => item.email === normalizeEmail(session.email) && item.enabled);
    return user ? { ...user, exp:session.exp } : null;
  } catch { return null; }
}

export function cookieValue(request, name) {
  const cookies = String(request.headers.cookie || "").split(";");
  for (const cookie of cookies) {
    const [key, ...parts] = cookie.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return "";
}

export async function verifyGoogleCredential(credential, clientId, fetchImpl = fetch) {
  if (!credential) throw new Error("Google 로그인 정보가 없습니다.");
  const response = await fetchImpl(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  const profile = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("Google 로그인 정보를 확인할 수 없습니다.");
  if (profile.aud !== clientId) throw new Error("이 앱용 Google 로그인 정보가 아닙니다.");
  if (![true,"true"].includes(profile.email_verified) || !profile.email) throw new Error("인증이 완료된 Google 이메일이 아닙니다.");
  return { email:normalizeEmail(profile.email), name:String(profile.name || "") };
}

export function newSecret() { return crypto.randomBytes(32).toString("hex"); }
