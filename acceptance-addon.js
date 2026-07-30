const fs = require("fs");
const path = require("path");

const serverFile = path.join(__dirname, "server.js");
const htmlFile = path.join(__dirname, "public", "index.html");
const appFile = path.join(__dirname, "public", "app.js");
const dataDir = path.join(__dirname, "data");
const acceptanceFile = path.join(dataDir, "acceptances.json");

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(acceptanceFile)) {
  fs.writeFileSync(
    acceptanceFile,
    JSON.stringify({ updatedAt: null, users: [] }, null, 2),
    "utf8"
  );
}

function patchServer() {
  let source = fs.readFileSync(serverFile, "utf8");
  if (source.includes('app.post("/api/rules/accept"')) return;

  source = source.replace(
    'const LOGINS_FILE = path.join(__dirname, "data", "logins.json");',
    'const LOGINS_FILE = path.join(__dirname, "data", "logins.json");\n' +
    'const ACCEPTANCES_FILE = path.join(__dirname, "data", "acceptances.json");'
  );

  const helpers = `
function readAcceptances() {
  if (!fs.existsSync(ACCEPTANCES_FILE)) {
    return { updatedAt: null, users: [] };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(ACCEPTANCES_FILE, "utf8"));
    return {
      updatedAt: parsed.updatedAt || null,
      users: Array.isArray(parsed.users) ? parsed.users : []
    };
  } catch {
    return { updatedAt: null, users: [] };
  }
}

function recordRuleAcceptance(user) {
  const now = new Date().toISOString();
  const acceptances = readAcceptances();
  const index = acceptances.users.findIndex((entry) => entry.id === user.id);

  const cleanUser = {
    id: String(user.id),
    username: cleanText(user.username || "Unbekannt", 100),
    rawUsername: cleanText(user.rawUsername || "Unbekannt", 100),
    firstAcceptedAt: now,
    lastAcceptedAt: now,
    acceptanceCount: 1
  };

  if (index >= 0) {
    const previous = acceptances.users[index];
    acceptances.users[index] = {
      ...previous,
      username: cleanUser.username,
      rawUsername: cleanUser.rawUsername,
      firstAcceptedAt: previous.firstAcceptedAt || now,
      lastAcceptedAt: now,
      acceptanceCount: Math.max(0, Number(previous.acceptanceCount) || 0) + 1
    };
  } else {
    acceptances.users.push(cleanUser);
  }

  acceptances.updatedAt = now;
  writeJsonAtomic(ACCEPTANCES_FILE, acceptances);
}
`;

  source = source.replace(
    'function cleanText(value, maxLength) {',
    helpers + '\nfunction cleanText(value, maxLength) {'
  );

  const routes = `
app.post("/api/rules/accept", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      error: "Bitte melde dich zuerst mit Discord an, damit deine Zustimmung gespeichert werden kann."
    });
  }

  recordRuleAcceptance(req.session.user);
  res.json({ ok: true, acceptedAt: new Date().toISOString() });
});

app.get("/api/admin/acceptances", requireOwner, (req, res) => {
  const acceptances = readAcceptances();
  const users = [...acceptances.users].sort((a, b) => {
    return String(b.lastAcceptedAt || "").localeCompare(String(a.lastAcceptedAt || ""));
  });

  res.json({
    updatedAt: acceptances.updatedAt,
    uniqueUsers: users.length,
    totalAcceptances: users.reduce(
      (sum, user) => sum + (Number(user.acceptanceCount) || 0),
      0
    ),
    users
  });
});
`;

  source = source.replace(
    'app.put("/api/team", requireOwner, (req, res) => {',
    routes + '\napp.put("/api/team", requireOwner, (req, res) => {'
  );

  fs.writeFileSync(serverFile, source, "utf8");
}

function patchHtml() {
  let html = fs.readFileSync(htmlFile, "utf8");
  if (html.includes('id="acceptance-admin"')) return;

  html = html.replace(
    '<a id="loginNavLink" href="#login-admin" hidden>Anmeldungen</a>',
    '<a id="loginNavLink" href="#login-admin" hidden>Anmeldungen</a>\n' +
    '        <a id="acceptanceNavLink" href="#acceptance-admin" hidden>Regelwerk akzeptiert</a>'
  );

  const panel = `
      <section id="acceptance-admin" class="login-admin" hidden>
        <div class="login-admin-head">
          <div>
            <span class="eyebrow">Nur für den Owner sichtbar</span>
            <h2>Regelwerk akzeptiert</h2>
            <p>Hier siehst du, welche Discord-Konten auf „Regelwerk akzeptieren“ gedrückt haben.</p>
          </div>
          <button id="refreshAcceptancesBtn" class="btn" type="button">Liste aktualisieren</button>
        </div>

        <div class="login-stats">
          <div class="login-stat">
            <strong id="uniqueAcceptancesCount">0</strong>
            <span>verschiedene Benutzer</span>
          </div>
          <div class="login-stat">
            <strong id="totalAcceptancesCount">0</strong>
            <span>Bestätigungen insgesamt</span>
          </div>
        </div>

        <div class="login-table-wrap">
          <table class="login-table">
            <thead>
              <tr>
                <th>Discord-Konto</th>
                <th>Discord-ID</th>
                <th>Erste Zustimmung</th>
                <th>Letzte Zustimmung</th>
                <th>Anzahl</th>
              </tr>
            </thead>
            <tbody id="acceptanceTableBody">
              <tr><td colspan="5">Liste wird geladen …</td></tr>
            </tbody>
          </table>
        </div>

        <div class="privacy-note">
          Gespeichert werden nur Discord-ID, Anzeigename, Benutzername sowie Zeitpunkt und Anzahl der Bestätigungen.
          Die Liste ist ausschließlich für den eingetragenen Owner abrufbar.
        </div>
        <div id="acceptanceMessage" class="save-message" aria-live="polite"></div>
      </section>
`;

  html = html.replace(
    '      <div class="notice">',
    panel + '\n      <div class="notice">'
  );

  html = html.replace(
    'Die Bestätigung wird nur lokal in deinem Browser gespeichert.',
    'Die Bestätigung wird deinem angemeldeten Discord-Konto zugeordnet und für den Owner gespeichert.'
  );

  fs.writeFileSync(htmlFile, html, "utf8");
}

function patchApp() {
  let source = fs.readFileSync(appFile, "utf8");
  if (source.includes("loadAcceptanceHistory")) return;

  source = source.replace(
    'const loginMessage = document.getElementById("loginMessage");',
    'const loginMessage = document.getElementById("loginMessage");\n' +
    'const acceptanceAdmin = document.getElementById("acceptance-admin");\n' +
    'const acceptanceNavLink = document.getElementById("acceptanceNavLink");\n' +
    'const refreshAcceptancesBtn = document.getElementById("refreshAcceptancesBtn");\n' +
    'const uniqueAcceptancesCount = document.getElementById("uniqueAcceptancesCount");\n' +
    'const totalAcceptancesCount = document.getElementById("totalAcceptancesCount");\n' +
    'const acceptanceTableBody = document.getElementById("acceptanceTableBody");\n' +
    'const acceptanceMessage = document.getElementById("acceptanceMessage");'
  );

  source = source.replace(
    'loginNavLink.hidden = true;',
    'loginNavLink.hidden = true;\n    acceptanceAdmin.hidden = true;\n    acceptanceNavLink.hidden = true;'
  );

  source = source.replace(
    'loginNavLink.hidden = !state.me.isOwner;',
    'loginNavLink.hidden = !state.me.isOwner;\n  acceptanceAdmin.hidden = !state.me.isOwner;\n  acceptanceNavLink.hidden = !state.me.isOwner;'
  );

  source = source.replace(
    'loadLoginHistory();',
    'loadLoginHistory();\n    loadAcceptanceHistory();'
  );

  const frontend = `
function setAcceptanceMessage(text, type = "") {
  acceptanceMessage.textContent = text;
  acceptanceMessage.className = \`save-message \${type}\`.trim();
}

function renderAcceptanceHistory(data) {
  uniqueAcceptancesCount.textContent = String(data.uniqueUsers || 0);
  totalAcceptancesCount.textContent = String(data.totalAcceptances || 0);
  acceptanceTableBody.replaceChildren();

  if (!Array.isArray(data.users) || data.users.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.textContent = "Bisher hat noch niemand das Regelwerk bestätigt.";
    row.append(cell);
    acceptanceTableBody.append(row);
    return;
  }

  for (const user of data.users) {
    const row = document.createElement("tr");

    const accountCell = document.createElement("td");
    const displayName = document.createElement("strong");
    displayName.textContent = user.username || "Unbekannt";
    const username = document.createElement("div");
    username.className = "auth-sub";
    username.textContent = user.rawUsername ? \`@\${user.rawUsername}\` : "";
    accountCell.append(displayName, username);

    const idCell = document.createElement("td");
    idCell.className = "discord-id";
    idCell.textContent = user.id || "–";

    const firstCell = document.createElement("td");
    firstCell.textContent = formatDate(user.firstAcceptedAt);

    const lastCell = document.createElement("td");
    lastCell.textContent = formatDate(user.lastAcceptedAt);

    const countCell = document.createElement("td");
    countCell.textContent = String(user.acceptanceCount || 0);

    row.append(accountCell, idCell, firstCell, lastCell, countCell);
    acceptanceTableBody.append(row);
  }
}

async function loadAcceptanceHistory() {
  if (!state.me?.isOwner) return;
  refreshAcceptancesBtn.disabled = true;
  setAcceptanceMessage("Bestätigungsliste wird geladen …");

  try {
    const response = await fetch("/api/admin/acceptances");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Bestätigungsliste konnte nicht geladen werden.");
    }

    renderAcceptanceHistory(data);
    setAcceptanceMessage(
      data.updatedAt
        ? \`Zuletzt aktualisiert: \${formatDate(data.updatedAt)}\`
        : "Noch keine Zustimmung gespeichert.",
      "ok"
    );
  } catch (error) {
    setAcceptanceMessage(error.message, "error");
  } finally {
    refreshAcceptancesBtn.disabled = false;
  }
}
`;

  source = source.replace(
    'async function load() {',
    frontend + '\nasync function load() {'
  );

  source = source.replace(
    'refreshLoginsBtn.addEventListener("click", loadLoginHistory);',
    'refreshLoginsBtn.addEventListener("click", loadLoginHistory);\n' +
    'refreshAcceptancesBtn.addEventListener("click", loadAcceptanceHistory);'
  );

  const oldHandler = `acceptBtn.addEventListener("click", () => {
  localStorage.setItem("pm_rules_accepted", "yes");
  updateAcceptance();
});`;

  const newHandler = `acceptBtn.addEventListener("click", async () => {
  acceptBtn.disabled = true;

  try {
    const response = await fetch("/api/rules/accept", { method: "POST" });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Die Zustimmung konnte nicht gespeichert werden.");
    }

    localStorage.setItem("pm_rules_accepted", "yes");
    updateAcceptance();

    if (state.me?.isOwner) {
      loadAcceptanceHistory();
    }
  } catch (error) {
    alert(error.message);
    acceptBtn.disabled = false;
  }
});`;

  source = source.replace(oldHandler, newHandler);

  fs.writeFileSync(appFile, source, "utf8");
}

patchServer();
patchHtml();
patchApp();

console.log("Regelwerk-Akzeptierungsübersicht wurde eingebaut.");
