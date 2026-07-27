const state = {
  me: null,
  team: null,
  editing: false
};

const authLeft = document.getElementById("authLeft");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const editBtn = document.getElementById("editBtn");
const cancelBtn = document.getElementById("cancelBtn");
const saveBtn = document.getElementById("saveBtn");
const teamGrid = document.getElementById("teamGrid");
const saveMessage = document.getElementById("saveMessage");
const loginAdmin = document.getElementById("login-admin");
const loginNavLink = document.getElementById("loginNavLink");
const refreshLoginsBtn = document.getElementById("refreshLoginsBtn");
const uniqueUsersCount = document.getElementById("uniqueUsersCount");
const totalLoginsCount = document.getElementById("totalLoginsCount");
const loginTableBody = document.getElementById("loginTableBody");
const loginMessage = document.getElementById("loginMessage");

function escapeAttribute(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function setMessage(text, type = "") {
  saveMessage.textContent = text;
  saveMessage.className = `save-message ${type}`.trim();
}

function avatarFallback(name) {
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  return `<div class="avatar" style="display:grid;place-items:center;font-weight:900">${initial}</div>`;
}

function renderAuth() {
  if (!state.me || !state.me.loggedIn) {
    authLeft.innerHTML = `
      <div class="avatar"></div>
      <div>
        <div class="auth-title">Nicht angemeldet</div>
        <div class="auth-sub">Das Regelwerk kann trotzdem angesehen werden.</div>
      </div>`;
    loginBtn.hidden = false;
    logoutBtn.hidden = true;
    editBtn.hidden = true;
    loginAdmin.hidden = true;
    loginNavLink.hidden = true;
    state.editing = false;
    updateEditButtons();
    return;
  }

  const user = state.me.user;
  const avatar = user.avatarUrl
    ? `<img class="avatar" src="${escapeAttribute(user.avatarUrl)}" alt="">`
    : avatarFallback(user.username);

  const badge = state.me.isOwner
    ? '<span class="status-badge status-owner">Owner-Zugriff</span>'
    : '<span class="status-badge status-view">Nur ansehen</span>';

  authLeft.innerHTML = `
    ${avatar}
    <div>
      <div class="auth-title">${user.username} ${badge}</div>
      <div class="auth-sub">Discord-ID: ${user.id}</div>
    </div>`;

  loginBtn.hidden = true;
  logoutBtn.hidden = false;
  editBtn.hidden = !state.me.isOwner;
  loginAdmin.hidden = !state.me.isOwner;
  loginNavLink.hidden = !state.me.isOwner;
  updateEditButtons();

  if (state.me.isOwner) {
    loadLoginHistory();
  }
}

function createViewCard(member) {
  const article = document.createElement("article");
  article.className = "team-card";

  const badge = document.createElement("div");
  badge.className = "badge";
  badge.textContent = member.badge;

  const content = document.createElement("div");
  content.className = "team-content";

  const role = document.createElement("span");
  role.className = "role";
  role.textContent = member.role;

  const name = document.createElement("div");
  name.className = "member-name";
  name.textContent = member.name;

  const description = document.createElement("p");
  description.className = "member-description";
  description.textContent = member.description;

  content.append(role, name, description);
  article.append(badge, content);
  return article;
}

function createEditCard(member) {
  const article = document.createElement("article");
  article.className = "team-card";
  article.dataset.id = member.id;

  const badge = document.createElement("div");
  badge.className = "badge";
  badge.textContent = member.badge;

  const content = document.createElement("div");
  content.className = "team-content";

  const role = document.createElement("span");
  role.className = "role";
  role.textContent = member.role;

  const name = document.createElement("input");
  name.className = "edit-field edit-name";
  name.type = "text";
  name.maxLength = 80;
  name.value = member.name;
  name.setAttribute("aria-label", `Name für ${member.role}`);

  const description = document.createElement("textarea");
  description.className = "edit-field edit-description";
  description.maxLength = 500;
  description.value = member.description;
  description.setAttribute("aria-label", `Beschreibung für ${member.role}`);

  content.append(role, name, description);
  article.append(badge, content);
  return article;
}

function renderTeam() {
  teamGrid.replaceChildren();
  if (!state.team) return;

  for (const member of state.team.members) {
    teamGrid.append(state.editing ? createEditCard(member) : createViewCard(member));
  }
}

function updateEditButtons() {
  const owner = Boolean(state.me && state.me.isOwner);
  editBtn.hidden = !owner || state.editing;
  cancelBtn.hidden = !owner || !state.editing;
  saveBtn.hidden = !owner || !state.editing;
}

function startEditing() {
  if (!state.me?.isOwner) return;
  state.editing = true;
  setMessage("");
  renderTeam();
  updateEditButtons();
}

function cancelEditing() {
  state.editing = false;
  setMessage("Änderungen wurden verworfen.");
  renderTeam();
  updateEditButtons();
}

function collectTeam() {
  return {
    members: [...teamGrid.querySelectorAll(".team-card")].map((card) => ({
      id: card.dataset.id,
      name: card.querySelector(".edit-name").value,
      description: card.querySelector(".edit-description").value
    }))
  };
}

async function saveTeam() {
  saveBtn.disabled = true;
  setMessage("Änderungen werden gespeichert …");

  try {
    const response = await fetch("/api/team", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(collectTeam())
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Speichern fehlgeschlagen.");
    }

    state.team = data;
    state.editing = false;
    renderTeam();
    updateEditButtons();
    setMessage("✓ Änderungen wurden dauerhaft gespeichert.", "ok");
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    saveBtn.disabled = false;
  }
}

async function logout() {
  await fetch("/auth/logout", { method: "POST" });
  window.location.href = "/";
}


function formatDate(value) {
  if (!value) return "–";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "–";

  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function setLoginMessage(text, type = "") {
  loginMessage.textContent = text;
  loginMessage.className = `save-message ${type}`.trim();
}

function renderLoginHistory(data) {
  uniqueUsersCount.textContent = String(data.uniqueUsers || 0);
  totalLoginsCount.textContent = String(data.totalLogins || 0);
  loginTableBody.replaceChildren();

  if (!Array.isArray(data.users) || data.users.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.textContent = "Bisher hat sich noch niemand erfolgreich angemeldet.";
    row.append(cell);
    loginTableBody.append(row);
    return;
  }

  for (const user of data.users) {
    const row = document.createElement("tr");

    const accountCell = document.createElement("td");
    const displayName = document.createElement("strong");
    displayName.textContent = user.username || "Unbekannt";
    const username = document.createElement("div");
    username.className = "auth-sub";
    username.textContent = user.rawUsername ? `@${user.rawUsername}` : "";
    accountCell.append(displayName, username);

    const idCell = document.createElement("td");
    idCell.className = "discord-id";
    idCell.textContent = user.id || "–";

    const firstCell = document.createElement("td");
    firstCell.textContent = formatDate(user.firstLoginAt);

    const lastCell = document.createElement("td");
    lastCell.textContent = formatDate(user.lastLoginAt);

    const countCell = document.createElement("td");
    countCell.textContent = String(user.loginCount || 0);

    row.append(accountCell, idCell, firstCell, lastCell, countCell);
    loginTableBody.append(row);
  }
}

async function loadLoginHistory() {
  if (!state.me?.isOwner) return;

  refreshLoginsBtn.disabled = true;
  setLoginMessage("Anmeldeliste wird geladen …");

  try {
    const response = await fetch("/api/admin/logins");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Anmeldeliste konnte nicht geladen werden.");
    }

    renderLoginHistory(data);
    setLoginMessage(
      data.updatedAt
        ? `Zuletzt aktualisiert: ${formatDate(data.updatedAt)}`
        : "Noch keine Anmeldung gespeichert.",
      "ok"
    );
  } catch (error) {
    setLoginMessage(error.message, "error");
  } finally {
    refreshLoginsBtn.disabled = false;
  }
}

async function load() {
  try {
    const [meResponse, teamResponse] = await Promise.all([
      fetch("/api/me"),
      fetch("/api/team")
    ]);

    state.me = await meResponse.json();
    state.team = await teamResponse.json();

    renderAuth();
    renderTeam();
  } catch {
    setMessage("Die Serverdaten konnten nicht geladen werden.", "error");
  }
}

editBtn.addEventListener("click", startEditing);
cancelBtn.addEventListener("click", cancelEditing);
saveBtn.addEventListener("click", saveTeam);
logoutBtn.addEventListener("click", logout);
refreshLoginsBtn.addEventListener("click", loadLoginHistory);

const search = document.getElementById("search");
const sections = [...document.querySelectorAll(".rules-section")];
const navLinks = [...document.querySelectorAll("nav a")];

search.addEventListener("input", () => {
  const query = search.value.trim().toLowerCase();
  sections.forEach((section) => {
    const matches = !query || section.textContent.toLowerCase().includes(query);
    section.classList.toggle("hidden-by-search", !matches);
  });
});

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      navLinks.forEach((link) => link.classList.remove("active"));
      const active = document.querySelector(`nav a[href="#${entry.target.id}"]`);
      if (active) active.classList.add("active");
    }
  });
}, { rootMargin: "-25% 0px -65% 0px" });

sections.forEach((section) => observer.observe(section));

const acceptBtn = document.getElementById("acceptBtn");
const accepted = document.getElementById("accepted");

function updateAcceptance() {
  const isAccepted = localStorage.getItem("pm_rules_accepted") === "yes";
  accepted.style.display = isAccepted ? "block" : "none";
  acceptBtn.textContent = isAccepted ? "Akzeptiert" : "Regelwerk akzeptieren";
  acceptBtn.disabled = isAccepted;
}

acceptBtn.addEventListener("click", () => {
  localStorage.setItem("pm_rules_accepted", "yes");
  updateAcceptance();
});

updateAcceptance();
load();
