const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const dotenv = require("dotenv");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DISCORD_API = "https://discord.com/api/v10";
const TEAM_FILE = path.join(__dirname, "data", "team.json");
const LOGINS_FILE = path.join(__dirname, "data", "logins.json");

const requiredEnv = [
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "DISCORD_REDIRECT_URI",
  "OWNER_DISCORD_ID",
  "SESSION_SECRET"
];

const missingEnv = requiredEnv.filter((name) => !process.env[name]);
if (missingEnv.length > 0) {
  console.error(`Fehlende Einstellungen in .env: ${missingEnv.join(", ")}`);
  process.exit(1);
}

if (!/^\d{15,22}$/.test(process.env.OWNER_DISCORD_ID)) {
  console.error("OWNER_DISCORD_ID muss deine numerische Discord-Benutzer-ID sein.");
  process.exit(1);
}

app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "https://cdn.discordapp.com", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.json({ limit: "100kb" }));
app.use(session({
  name: "pm_session",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 12
  }
}));

function isOwner(req) {
  return Boolean(
    req.session.user &&
    req.session.user.id === process.env.OWNER_DISCORD_ID
  );
}

function requireOwner(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Du bist nicht mit Discord angemeldet." });
  }
  if (!isOwner(req)) {
    return res.status(403).json({ error: "Nur der eingetragene Owner darf Änderungen speichern." });
  }
  next();
}

function readTeam() {
  return JSON.parse(fs.readFileSync(TEAM_FILE, "utf8"));
}

function readLogins() {
  if (!fs.existsSync(LOGINS_FILE)) {
    return { updatedAt: null, users: [] };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(LOGINS_FILE, "utf8"));
    return {
      updatedAt: parsed.updatedAt || null,
      users: Array.isArray(parsed.users) ? parsed.users : []
    };
  } catch {
    return { updatedAt: null, users: [] };
  }
}

function writeJsonAtomic(filePath, value) {
  const tempFile = `${filePath}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tempFile, filePath);
}

function recordSuccessfulLogin(user) {
  const now = new Date().toISOString();
  const logins = readLogins();
  const index = logins.users.findIndex((entry) => entry.id === user.id);

  const cleanUser = {
    id: String(user.id),
    username: cleanText(user.global_name || user.username || "Unbekannt", 100),
    rawUsername: cleanText(user.username || "Unbekannt", 100),
    firstLoginAt: now,
    lastLoginAt: now,
    loginCount: 1
  };

  if (index >= 0) {
    const previous = logins.users[index];
    logins.users[index] = {
      ...previous,
      username: cleanUser.username,
      rawUsername: cleanUser.rawUsername,
      firstLoginAt: previous.firstLoginAt || now,
      lastLoginAt: now,
      loginCount: Math.max(0, Number(previous.loginCount) || 0) + 1
    };
  } else {
    logins.users.push(cleanUser);
  }

  logins.updatedAt = now;
  writeJsonAtomic(LOGINS_FILE, logins);
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function validateTeamPayload(payload) {
  const current = readTeam();
  if (!payload || !Array.isArray(payload.members)) {
    throw new Error("Ungültige Teamdaten.");
  }

  const incomingById = new Map(payload.members.map((member) => [member.id, member]));

  const members = current.members.map((member) => {
    const incoming = incomingById.get(member.id);
    if (!incoming) {
      throw new Error(`Die Rolle ${member.role} fehlt.`);
    }

    const name = cleanText(incoming.name, 80);
    const description = cleanText(incoming.description, 500);

    if (!name || !description) {
      throw new Error(`Name und Beschreibung für ${member.role} dürfen nicht leer sein.`);
    }

    return {
      ...member,
      name,
      description
    };
  });

  return {
    updatedAt: new Date().toISOString(),
    members
  };
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    client_secret: process.env.DISCORD_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.DISCORD_REDIRECT_URI
  });

  const response = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord-Tokenfehler: ${response.status} ${text}`);
  }

  return response.json();
}

async function fetchDiscordUser(accessToken) {
  const response = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    throw new Error(`Discord-Benutzer konnte nicht geladen werden: ${response.status}`);
  }

  return response.json();
}

app.get("/auth/discord", (req, res) => {
  const state = crypto.randomBytes(24).toString("hex");
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    response_type: "code",
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    scope: "identify",
    state,
    prompt: "consent"
  });

  res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
});

app.get("/auth/discord/callback", async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect("/?login=denied");
  }

  if (!code || !state || state !== req.session.oauthState) {
    return res.status(400).send("Ungültige oder abgelaufene Discord-Anmeldung.");
  }

  delete req.session.oauthState;

  try {
    const token = await exchangeCode(String(code));
    const user = await fetchDiscordUser(token.access_token);

    req.session.user = {
      id: user.id,
      username: user.global_name || user.username,
      rawUsername: user.username,
      avatar: user.avatar || null
    };

    recordSuccessfulLogin(user);
    req.session.save(() => res.redirect("/?login=success"));
  } catch (error) {
    console.error(error);
    res.status(500).send("Die Discord-Anmeldung ist fehlgeschlagen.");
  }
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("pm_session");
    res.json({ ok: true });
  });
});

app.get("/api/me", (req, res) => {
  const user = req.session.user || null;
  res.json({
    loggedIn: Boolean(user),
    isOwner: isOwner(req),
    user: user ? {
      id: user.id,
      username: user.username,
      rawUsername: user.rawUsername,
      avatarUrl: user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
        : null
    } : null
  });
});

app.get("/api/team", (req, res) => {
  res.json(readTeam());
});

app.get("/api/admin/logins", requireOwner, (req, res) => {
  const logins = readLogins();
  const users = [...logins.users].sort((a, b) => {
    return String(b.lastLoginAt || "").localeCompare(String(a.lastLoginAt || ""));
  });

  res.json({
    updatedAt: logins.updatedAt,
    uniqueUsers: users.length,
    totalLogins: users.reduce((sum, user) => sum + (Number(user.loginCount) || 0), 0),
    users
  });
});

app.put("/api/team", requireOwner, (req, res) => {
  try {
    const validated = validateTeamPayload(req.body);
    const tempFile = `${TEAM_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(validated, null, 2), "utf8");
    fs.renameSync(tempFile, TEAM_FILE);
    res.json(validated);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.use(express.static(path.join(__dirname, "public"), {
  extensions: ["html"]
}));

app.use((req, res) => {
  res.status(404).send("Seite nicht gefunden.");
});

app.listen(PORT, () => {
  console.log(`Projekt Mittelberg läuft auf http://localhost:${PORT}`);
});
