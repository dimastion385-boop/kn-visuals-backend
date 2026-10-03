const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, authorization",
      "access-control-allow-methods": "GET,POST,OPTIONS"
    }
  });

const sha256 = async (text) => {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
};

const token = () => crypto.randomUUID();

async function body(req) {
  try { return await req.json(); } catch { return {}; }
}

async function auth(req, env) {
  const h = req.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) return null;
  const t = h.slice(7);
  const row = await env.DB.prepare(
    "SELECT id, username, plan FROM users WHERE id = ?"
  ).bind(Number(t)).first();
  return row || null;
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204 });

    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/api/health") {
      return json({ ok: true, service: "KN Visuals Backend" });
    }

    if (path === "/api/register" && req.method === "POST") {
      const b = await body(req);
      const username = String(b.username || "").trim();
      const password = String(b.password || "");
      if (username.length < 3 || password.length < 6)
        return json({ error: "Username >= 3, password >= 6" }, 400);

      const exists = await env.DB.prepare(
        "SELECT id FROM users WHERE username = ?"
      ).bind(username).first();
      if (exists) return json({ error: "User already exists" }, 409);

      const hash = await sha256(password);
      const result = await env.DB.prepare(
        "INSERT INTO users (username,password_hash) VALUES (?,?)"
      ).bind(username, hash).run();

      return json({ ok: true, userId: result.meta.last_row_id, plan: "free" }, 201);
    }

    if (path === "/api/login" && req.method === "POST") {
      const b = await body(req);
      const username = String(b.username || "").trim();
      const password = String(b.password || "");
      const hash = await sha256(password);

      const user = await env.DB.prepare(
        "SELECT id,username,plan FROM users WHERE username=? AND password_hash=?"
      ).bind(username, hash).first();

      if (!user) return json({ error: "Invalid credentials" }, 401);

      // Prototype token: user ID. Replace with signed short-lived tokens before production.
      return json({ ok: true, token: String(user.id), userId: user.id, plan: user.plan });
    }

    const user = await auth(req, env);
    if (!user) return json({ error: "Unauthorized" }, 401);

    if (path === "/api/me" && req.method === "GET") {
      return json({ id: user.id, username: user.username, plan: user.plan });
    }

    if (path === "/api/license/check" && req.method === "POST") {
      const b = await body(req);
      const key = String(b.licenseKey || "").trim();
      const deviceId = String(b.deviceId || "").trim();

      if (!key) return json({ valid: false });

      const license = await env.DB.prepare(
        "SELECT id,plan,active,device_id,user_id FROM licenses WHERE license_key=?"
      ).bind(key).first();

      if (!license || !license.active)
        return json({ valid: false, reason: "invalid_or_inactive" });

      if (license.user_id && license.user_id !== user.id)
        return json({ valid: false, reason: "assigned_to_other_user" });

      if (license.device_id && deviceId && license.device_id !== deviceId)
        return json({ valid: false, reason: "assigned_to_other_device" });

      if (!license.user_id) {
        await env.DB.prepare(
          "UPDATE licenses SET user_id=?,device_id=? WHERE id=?"
        ).bind(user.id, deviceId || null, license.id).run();
      }

      await env.DB.prepare(
        "UPDATE users SET plan=? WHERE id=?"
      ).bind(license.plan, user.id).run();

      return json({ valid: true, plan: license.plan });
    }

    if (path === "/api/configs" && req.method === "GET") {
      const rows = await env.DB.prepare(
        "SELECT name,config_json,updated_at FROM configs WHERE user_id=? ORDER BY name"
      ).bind(user.id).all();
      return json({ configs: rows.results || [] });
    }

    if (path === "/api/configs" && req.method === "POST") {
      const b = await body(req);
      const name = String(b.name || "").trim();
      const config = JSON.stringify(b.config ?? {});
      if (!name || name.length > 64) return json({ error: "Invalid config name" }, 400);

      await env.DB.prepare(
        `INSERT INTO configs(user_id,name,config_json,updated_at)
         VALUES(?,?,?,CURRENT_TIMESTAMP)
         ON CONFLICT(user_id,name) DO UPDATE SET
         config_json=excluded.config_json, updated_at=CURRENT_TIMESTAMP`
      ).bind(user.id, name, config).run();

      return json({ ok: true });
    }

    return json({ error: "Not found" }, 404);
  }
};
