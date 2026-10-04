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

  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

async function body(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

async function auth(req, env) {
  const header = req.headers.get("authorization") || "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  const token = header.slice(7).trim();

  if (!/^\d+$/.test(token)) {
    return null;
  }

  const user = await env.DB.prepare(
    "SELECT id, username, plan FROM users WHERE id = ?"
  )
    .bind(Number(token))
    .first();

  return user || null;
}

async function runAI(env, prompt) {
  const result = await env.AI.run(
    "@cf/meta/llama-3.1-8b-instruct-fp8",
    {
      messages: [
        {
          role: "system",
          content:
            "Ты AI-помощник приложения KN Visuals. Отвечай понятно и кратко."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 256,
      temperature: 0.6
    }
  );

  return result?.response || "";
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }

    const url = new URL(req.url);
    const path = url.pathname;

    // =========================
    // HEALTH
    // =========================

    if (path === "/api/health" && req.method === "GET") {
      return json({
        ok: true,
        service: "KN Visuals Backend",
        ai: !!env.AI,
        db: !!env.DB
      });
    }

    // =========================
    // AI TEST
    // Открывается обычной ссылкой
    // =========================

    if (path === "/api/ai-test" && req.method === "GET") {
      if (!env.AI) {
        return json(
          {
            ok: false,
            error: "Workers AI binding is missing"
          },
          500
        );
      }

      try {
        const answer = await runAI(
          env,
          "Ответь одним коротким предложением: AI работает?"
        );

        return json({
          ok: true,
          answer
        });
      } catch (error) {
        return json(
          {
            ok: false,
            error: String(error)
          },
          500
        );
      }
    }

    // =========================
    // REGISTER
    // =========================

    if (path === "/api/register" && req.method === "POST") {
      const b = await body(req);

      const username = String(b.username || "").trim();
      const password = String(b.password || "");

      if (username.length < 3) {
        return json(
          {
            error: "Username must contain at least 3 characters"
          },
          400
        );
      }

      if (password.length < 6) {
        return json(
          {
            error: "Password must contain at least 6 characters"
          },
          400
        );
      }

      const exists = await env.DB.prepare(
        "SELECT id FROM users WHERE username = ?"
      )
        .bind(username)
        .first();

      if (exists) {
        return json(
          {
            error: "User already exists"
          },
          409
        );
      }

      const hash = await sha256(password);

      const result = await env.DB.prepare(
        "INSERT INTO users (username, password_hash, plan) VALUES (?, ?, ?)"
      )
        .bind(username, hash, "free")
        .run();

      return json(
        {
          ok: true,
          userId: result.meta.last_row_id,
          plan: "free"
        },
        201
      );
    }

    // =========================
    // LOGIN
    // =========================

    if (path === "/api/login" && req.method === "POST") {
      const b = await body(req);

      const username = String(b.username || "").trim();
      const password = String(b.password || "");

      const hash = await sha256(password);

      const user = await env.DB.prepare(
        "SELECT id, username, plan FROM users WHERE username = ? AND password_hash = ?"
      )
        .bind(username, hash)
        .first();

      if (!user) {
        return json(
          {
            error: "Invalid credentials"
          },
          401
        );
      }

      return json({
        ok: true,

        // Prototype token.
        // Перед production лучше заменить на подписанный JWT.
        token: String(user.id),

        userId: user.id,
        plan: user.plan
      });
    }

    // =========================
    // AUTH
    // =========================
if (path === "/api/ai-screen" && req.method === "POST") {
  const b = await body(req);

  const prompt = String(
    b.prompt || "Опиши, что видно на изображении."
  ).slice(0, 2000);

  const image = String(b.image || "");

  if (!image) {
    return json({ ok: false, error: "image_required" }, 400);
  }

  try {
    const result = await env.AI.run(
      "@cf/meta/llama-3.2-11b-vision-instruct",
      {
        prompt,
        image
      }
    );

    return json({
      ok: true,
      result
    });
  } catch (e) {
    return json({
      ok: false,
      error: String(e)
    }, 502);
  }
}
    const user = await auth(req, env);

    if (!user) {
      return json(
        {
          error: "Unauthorized"
        },
        401
      );
    }

    // =========================
    // ME
    // =========================

    if (path === "/api/me" && req.method === "GET") {
      return json({
        id: user.id,
        username: user.username,
        plan: user.plan
      });
    }

    // =========================
    // AI
    // =========================

    if (path === "/api/ai" && req.method === "POST") {
      if (!env.AI) {
        return json(
          {
            ok: false,
            error: "Workers AI binding is missing"
          },
          500
        );
      }

      const b = await body(req);
      const prompt = String(b.prompt || "").trim();

      if (!prompt) {
        return json(
          {
            error: "Prompt is required"
          },
          400
        );
      }

      if (prompt.length > 4000) {
        return json(
          {
            error: "Prompt is too long"
          },
          400
        );
      }

      try {
        const answer = await runAI(env, prompt);

        return json({
          ok: true,
          answer,
          plan: user.plan
        });
      } catch (error) {
        return json(
          {
            ok: false,
            error: String(error)
          },
          500
        );
      }
    }

    // =========================
    // LICENSE CHECK
    // =========================

    if (path === "/api/license/check" && req.method === "POST") {
      const b = await body(req);

      const key = String(b.licenseKey || "").trim();
      const deviceId = String(b.deviceId || "").trim();

      if (!key) {
        return json({
          valid: false,
          reason: "empty_key"
        });
      }

      const license = await env.DB.prepare(
        `SELECT id, plan, active, device_id, user_id
         FROM licenses
         WHERE license_key = ?`
      )
        .bind(key)
        .first();

      if (!license || !license.active) {
        return json({
          valid: false,
          reason: "invalid_or_inactive"
        });
      }

      if (
        license.user_id !== null &&
        license.user_id !== user.id
      ) {
        return json({
          valid: false,
          reason: "assigned_to_other_user"
        });
      }

      if (
        license.device_id &&
        deviceId &&
        license.device_id !== deviceId
      ) {
        return json({
          valid: false,
          reason: "assigned_to_other_device"
        });
      }

      // Первый успешный вход по ключу
      // привязывает ключ к пользователю и устройству.
      if (!license.user_id) {
        await env.DB.prepare(
          `UPDATE licenses
           SET user_id = ?, device_id = ?
           WHERE id = ?`
        )
          .bind(
            user.id,
            deviceId || null,
            license.id
          )
          .run();
      }

      await env.DB.prepare(
        "UPDATE users SET plan = ? WHERE id = ?"
      )
        .bind(license.plan, user.id)
        .run();

      return json({
        valid: true,
        plan: license.plan
      });
    }

    // =========================
    // CONFIGS GET
    // =========================

    if (path === "/api/configs" && req.method === "GET") {
      const rows = await env.DB.prepare(
        `SELECT name, config_json, updated_at
         FROM configs
         WHERE user_id = ?
         ORDER BY name`
      )
        .bind(user.id)
        .all();

      return json({
        configs: rows.results || []
      });
    }

    // =========================
    // CONFIGS SAVE
    // =========================

    if (path === "/api/configs" && req.method === "POST") {
      const b = await body(req);

      const name = String(b.name || "").trim();
      const config = JSON.stringify(b.config ?? {});

      if (!name || name.length > 64) {
        return json(
          {
            error: "Invalid config name"
          },
          400
        );
      }

      await env.DB.prepare(
        `INSERT INTO configs
          (user_id, name, config_json, updated_at)
         VALUES
          (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id, name)
         DO UPDATE SET
          config_json = excluded.config_json,
          updated_at = CURRENT_TIMESTAMP`
      )
        .bind(user.id, name, config)
        .run();

      return json({
        ok: true
      });
    }

    // =========================
    // NOT FOUND
    // =========================

    return json(
      {
        error: "Not found"
      },
      404
    );
  }
};
