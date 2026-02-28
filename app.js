/**
 * app.js — Single-file leak checker webtool (Node built-in only)
 * - Serves a simple HTML page at /
 * - API: GET /api/hibp/breaches?email=you@example.com
 *
 * Deploy on Render:
 * - Build Command: (leave empty) or "echo no build"
 * - Start Command: node app.js
 * - Env var: HIBP_API_KEY = <your key>
 *
 * Notes:
 * - Uses HIBP official API (requires key)
 * - Includes a button that opens the Odido checker page (no scraping)
 */

const http = require("http");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;

function isLikelyEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(html);
}

const HTML = `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Odido / Datalek Check Tool</title>
  <style>
    body { font-family: system-ui, Arial, sans-serif; margin: 24px; line-height: 1.4; }
    .card { max-width: 760px; padding: 18px; border: 1px solid #ddd; border-radius: 12px; }
    input { width: 100%; padding: 10px; font-size: 16px; margin: 8px 0 12px; }
    button { padding: 10px 14px; font-size: 16px; cursor: pointer; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; }
    .muted { color: #666; font-size: 14px; }
    pre { background: #f6f6f6; padding: 12px; border-radius: 10px; overflow:auto; }
    .ok { color: #0a7; font-weight: 600; }
    .bad { color: #c22; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Check: (mogelijk) gelekte gegevens</h1>
    <p class="muted">
      Deze tool checkt je e-mail op bekende datalekken via Have I Been Pwned (officiële API).
      Voor de Odido-specifieke check opent hij de publieke Odido-checker pagina (geen scraping).
    </p>

    <h2>1) HIBP e-mail check</h2>
    <label for="email">E-mailadres</label>
    <input id="email" placeholder="jij@voorbeeld.nl" autocomplete="email" />

    <div class="row">
      <button id="checkBtn">Check via HIBP</button>
      <button id="openOdidoCheckerBtn" title="Opent de Odido checker in nieuw tabblad">
        Open Odido checker
      </button>
    </div>

    <p id="status" class="muted"></p>
    <div id="result"></div>

    <hr style="margin:18px 0">

    <p class="muted">
      Let op: “niet gevonden” betekent alleen “niet gevonden in bekende/verwerkte lekken”.
      Zet 2FA aan en gebruik unieke wachtwoorden.
    </p>
  </div>

<script>
  const emailEl = document.getElementById("email");
  const statusEl = document.getElementById("status");
  const resultEl = document.getElementById("result");
  const checkBtn = document.getElementById("checkBtn");
  const openOdidoCheckerBtn = document.getElementById("openOdidoCheckerBtn");

  openOdidoCheckerBtn.addEventListener("click", () => {
    // Publieke Odido-gerelateerde checker pagina
    window.open("https://www.datagelekt.nl/odido/", "_blank", "noopener,noreferrer");
  });

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[c]));
  }

  checkBtn.addEventListener("click", async () => {
    const email = emailEl.value.trim();
    resultEl.innerHTML = "";
    statusEl.textContent = "Bezig met checken…";

    try {
      const resp = await fetch(\`/api/hibp/breaches?email=\${encodeURIComponent(email)}\`);
      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        if (resp.status === 429 && data.retryAfterSeconds) {
          statusEl.innerHTML = \`<span class="bad">Rate limit</span> — probeer over \${esc(data.retryAfterSeconds)}s opnieuw.\`;
        } else {
          statusEl.innerHTML = \`<span class="bad">Fout</span>: \${esc(data.error || "Onbekende fout")}\`;
        }
        if (data.details) resultEl.innerHTML = \`<pre>\${esc(data.details)}</pre>\`;
        return;
      }

      if (data.breached === false) {
        statusEl.innerHTML = \`<span class="ok">Niet gevonden</span> in HIBP-breaches.\`;
        return;
      }

      statusEl.innerHTML = \`<span class="bad">Gevonden</span> — dit e-mailadres staat in \${esc(data.breaches?.length || 0)} breach(es).\`;

      const list = (data.breaches || []).map(b => {
        const name = b.Name || b.Title || "Onbekend";
        const domain = b.Domain ? \` (\${b.Domain})\` : "";
        return \`- \${name}\${domain}\`;
      }).join("\\n");

      resultEl.innerHTML = \`<pre>\${esc(list)}</pre>\`;
    } catch (e) {
      statusEl.innerHTML = \`<span class="bad">Fout</span>: \${esc(e)}\`;
    }
  });
</script>
</body>
</html>`;

async function handleHibp(req, res, urlObj) {
  const email = (urlObj.searchParams.get("email") || "").trim();

  if (!isLikelyEmail(email)) {
    return sendJson(res, 400, { ok: false, error: "Voer een geldig e-mailadres in." });
  }

  const apiKey = process.env.HIBP_API_KEY;
  if (!apiKey) {
    return sendJson(res, 500, {
      ok: false,
      error: "Server mist HIBP_API_KEY. Zet deze als environment variable op Render."
    });
  }

  const hibpUrl =
    "https://haveibeenpwned.com/api/v3/breachedaccount/" +
    encodeURIComponent(email) +
    "?truncateResponse=true";

  // Node 18+ has global fetch
  const hibpResp = await fetch(hibpUrl, {
    headers: {
      "hibp-api-key": apiKey,
      "user-agent": "odido-checker-tool/1.0 (render-deploy)",
      "accept": "application/json",
    },
  });

  if (hibpResp.status === 404) {
    return sendJson(res, 200, { ok: true, breached: false, breaches: [] });
  }

  if (hibpResp.status === 429) {
    const retryAfter = hibpResp.headers.get("retry-after");
    return sendJson(res, 429, {
      ok: false,
      error: "Rate limit geraakt bij HIBP. Probeer later opnieuw.",
      retryAfterSeconds: retryAfter ? Number(retryAfter) : null,
    });
  }

  if (!hibpResp.ok) {
    const text = await hibpResp.text().catch(() => "");
    return sendJson(res, hibpResp.status, {
      ok: false,
      error: "HIBP API error",
      status: hibpResp.status,
      details: text.slice(0, 500),
    });
  }

  const breaches = await hibpResp.json();
  return sendJson(res, 200, { ok: true, breached: true, breaches });
}

const server = http.createServer(async (req, res) => {
  try {
    const urlObj = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const path = urlObj.pathname;

    if (req.method === "GET" && path === "/") {
      return sendHtml(res, 200, HTML);
    }

    if (req.method === "GET" && path === "/api/hibp/breaches") {
      return await handleHibp(req, res, urlObj);
    }

    // health check
    if (req.method === "GET" && path === "/healthz") {
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: "Server error", details: String(err) });
  }
});

server.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
});
