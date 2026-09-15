"use strict";

/* --------------------------------------------------------------------------
   Config
   -------------------------------------------------------------------------- */
const CFG = Object.assign({ SUPABASE_URL: "", SUPABASE_ANON_KEY: "", LOGIN_DOMAIN: "example.com" }, window.CHORE_CONFIG || {});

const HAS_KEYS =
  /^https:\/\/.+\.supabase\.co\/?$/.test(CFG.SUPABASE_URL.trim()) &&
  CFG.SUPABASE_ANON_KEY.trim().length > 20;

const LOG_PREVIEW = 15;

// People log in with just their name; Supabase needs an email behind the scenes.
const loginEmail = (name) => {
  const clean = name.trim().toLowerCase().replace(/\s+/g, "");
  return clean.includes("@") ? clean : `${clean}@${CFG.LOGIN_DOMAIN}`;
};

/* --------------------------------------------------------------------------
   Date helpers (local time; the database decides "today" in Europe/Zurich)
   -------------------------------------------------------------------------- */
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const todayISO = () => iso(new Date());
const monthOf = (day) => day.slice(0, 7) + "-01";
const addMonths = (month, n) => {
  const d = fromISO(month);
  return iso(new Date(d.getFullYear(), d.getMonth() + n, 1));
};
const daysBetween = (a, b) => Math.round((fromISO(b) - fromISO(a)) / 86400000);

const LOCALE = "de-CH";
const fmtMonth = new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric" });
const fmtMonthName = new Intl.DateTimeFormat(LOCALE, { month: "long" });
const fmtDay = new Intl.DateTimeFormat(LOCALE, { weekday: "long", day: "numeric", month: "long" });
const fmtShort = new Intl.DateTimeFormat(LOCALE, { weekday: "short", day: "numeric", month: "short" });
const fmtTime = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit" });

/* --------------------------------------------------------------------------
   Storage: Supabase when configured, localStorage demo otherwise.
   Both expose the same methods.
   -------------------------------------------------------------------------- */
function remoteStore() {
  const db = window.supabase.createClient(CFG.SUPABASE_URL.trim(), CFG.SUPABASE_ANON_KEY.trim());
  const ok = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };

  return {
    kind: "supabase",

    async me() {
      const { data } = await db.auth.getSession();
      const user = data.session && data.session.user;
      if (!user) return null;
      return ok(await db.from("profiles").select("id,name,is_admin").eq("id", user.id).maybeSingle());
    },
    async signIn(email, password) {
      ok(await db.auth.signInWithPassword({ email, password }));
    },
    async signOut() {
      await db.auth.signOut();
    },

    // Completions from `from` onwards, plus every special-job completion ever
    // (so a job done last year doesn't reappear as open).
    async load(from, month) {
      const [profiles, tasks, recent, special, goals] = (await Promise.all([
        db.from("profiles").select("id,name,is_admin").order("name"),
        db.from("tasks").select("*").order("created_at"),
        db.from("completions").select("*").gte("done_on", from),
        db.from("completions").select("*, tasks!inner(kind)").eq("tasks.kind", "special"),
        db.from("monthly_goals").select("points").lte("month", month).order("month", { ascending: false }).limit(1),
      ])).map(ok);

      const byId = new Map();
      for (const { tasks: _join, ...row } of [...recent, ...special]) byId.set(row.id, row);
      return { profiles, tasks, completions: [...byId.values()], goal: goals.length ? goals[0].points : null };
    },

    async complete(taskId, userId) {
      ok(await db.from("completions").insert({ task_id: taskId, user_id: userId }));
    },
    async undo(id) {
      const rows = ok(await db.from("completions").delete().eq("id", id).select("id"));
      if (!rows.length) throw new Error("Du kannst nur deine eigenen Ämtli von heute rückgängig machen.");
    },
    async addTask(task) {
      ok(await db.from("tasks").insert(task));
    },
    async updateTask(id, patch) {
      const rows = ok(await db.from("tasks").update(patch).eq("id", id).select("id"));
      if (!rows.length) throw new Error("Nur Admins können Ämtli ändern.");
    },
    async setGoal(month, points) {
      ok(await db.from("monthly_goals").upsert({ month, points, updated_at: new Date().toISOString() }));
    },
  };
}

function localStore() {
  const KEY = "chores:demo-de-2";
  const ME = "chores:demo-me";
  let data = null;

  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
  };
  const db = () => {
    if (data) return data;
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "null");
      if (saved && saved.v === 1) return (data = saved);
    } catch {}
    data = seedDemo();
    save();
    return data;
  };
  const copy = (x) => JSON.parse(JSON.stringify(x));

  return {
    kind: "local",

    demoProfiles: () => copy(db().profiles),
    async me() {
      let id = null;
      try { id = localStorage.getItem(ME); } catch {}
      return copy(db().profiles.find((p) => p.id === id) || null);
    },
    async signIn(id) {
      try { localStorage.setItem(ME, id); } catch {}
    },
    async signOut() {
      try { localStorage.removeItem(ME); } catch {}
    },

    async load(_from, month) {
      const s = db();
      const goal = s.goals
        .filter((g) => g.month <= month)
        .sort((a, b) => b.month.localeCompare(a.month))[0];
      return copy({ profiles: s.profiles, tasks: s.tasks, completions: s.completions, goal: goal ? goal.points : null });
    },

    // Same rules as the check_completion trigger in schema.sql.
    async complete(taskId, userId) {
      const s = db();
      const t = s.tasks.find((x) => x.id === taskId);
      if (!t || t.archived) throw new Error("Dieses Ämtli gibt es nicht mehr.");
      const today = todayISO();
      if (s.completions.some((c) => c.task_id === taskId && (t.kind === "special" || c.done_on === today))) {
        throw new Error(t.kind === "special" ? `„${t.title}“ wurde schon erledigt.` : `„${t.title}“ wurde heute schon erledigt.`);
      }
      s.completions.push({
        id: s.nextId++, task_id: taskId, user_id: userId, done_on: today,
        points: t.points, created_at: new Date().toISOString(),
      });
      save();
    },
    async undo(id) {
      const s = db();
      s.completions = s.completions.filter((c) => c.id !== id);
      save();
    },
    async addTask(task) {
      const s = db();
      s.tasks.push({ ...task, id: s.nextId++, archived: false, created_by: null, created_at: new Date().toISOString() });
      save();
    },
    async updateTask(id, patch) {
      const t = db().tasks.find((x) => x.id === id);
      if (!t) throw new Error("Dieses Ämtli gibt es nicht mehr.");
      Object.assign(t, patch);
      save();
    },
    async setGoal(month, points) {
      const s = db();
      s.goals = s.goals.filter((g) => g.month !== month);
      s.goals.push({ month, points });
      save();
    },

    reset() {
      try {
        localStorage.removeItem(KEY);
        localStorage.removeItem(ME);
      } catch {}
      data = null;
    },
  };
}

function seedDemo() {
  const today = todayISO();
  const t0 = fromISO(today);
  const offset = (n) => iso(new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + n));
  const stamp = (day) => `${day}T17:00:00.000Z`;

  const profiles = [
    { id: "admin", name: "Admin", is_admin: true },
    { id: "renata", name: "Renata", is_admin: false },
    { id: "adi", name: "Adi", is_admin: false },
    { id: "jan", name: "Jan", is_admin: false },
    { id: "elisabeth", name: "Elisabeth", is_admin: false },
  ];
  const family = profiles.filter((p) => !p.is_admin).map((p) => p.id);

  const tasks = [
    ["Geschirrspüler ausräumen", 5, "daily", null, ""],
    ["Abfall rausbringen", 3, "daily", null, "Karton und Papier am Dienstag"],
    ["Tisch decken und abräumen", 4, "daily", null, ""],
    ["Wohnzimmer staubsaugen", 6, "daily", null, ""],
    ["Fenster putzen", 30, "special", offset(5), "Erdgeschoss, innen und aussen"],
    ["Garage aufräumen", 40, "special", offset(12), ""],
    ["Beim Sonntagszmittag helfen", 15, "special", null, ""],
    ["Auto waschen", 20, "special", offset(-1), ""],
  ].map(([title, points, kind, due_on, notes], i) => ({
    id: i + 1, title, notes, points, kind, due_on, archived: false,
    created_by: "admin", created_at: stamp(offset(-40 + i)),
  }));

  // Deterministic "random" history for the days so far this month.
  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const completions = [];
  let nextId = 1;
  for (let d = 1; d < t0.getDate(); d++) {
    const day = iso(new Date(t0.getFullYear(), t0.getMonth(), d));
    for (const t of tasks.filter((x) => x.kind === "daily")) {
      if (rand() < 0.6) {
        completions.push({
          id: nextId++, task_id: t.id, user_id: family[Math.floor(rand() * family.length)],
          done_on: day, points: t.points, created_at: stamp(day),
        });
      }
    }
  }
  completions.push({ id: nextId++, task_id: 8, user_id: "adi", done_on: offset(-2), points: 20, created_at: stamp(offset(-2)) });

  return { v: 1, profiles, tasks, completions, goals: [{ month: monthOf(today), points: 100 }], nextId: 1000 };
}

let store = null;

/* --------------------------------------------------------------------------
   State
   -------------------------------------------------------------------------- */
const state = {
  me: null,                    // { id, name, is_admin }
  profiles: [],
  tasks: [],
  completions: [],             // [{ id, task_id, user_id, done_on, points, created_at }]
  goal: null,                  // goal for state.month
  month: monthOf(todayISO()),  // month shown in the scoreboard and log
  actAs: null,                 // admins can check chores off for someone else
  logAll: false,
  busy: new Set(),             // "t<id>" / "c<id>" with a request in flight
  lastSync: null,
  error: "",
};

const el = (id) => document.getElementById(id);
const isAdmin = () => !!(state.me && state.me.is_admin);
const nameOf = (id) => (state.profiles.find((p) => p.id === id) || { name: "jemand" }).name;
const taskById = (id) => state.tasks.find((t) => t.id === id);
const canUndo = (c) =>
  c.id > 0 && (isAdmin() || (c.user_id === state.me.id && c.done_on === todayISO()));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function pointsByUser(month) {
  const totals = new Map();
  for (const c of state.completions) {
    if (monthOf(c.done_on) === month) totals.set(c.user_id, (totals.get(c.user_id) || 0) + c.points);
  }
  return totals;
}

/** Tiny DOM builder. Text children are always inserted as text, never HTML. */
function h(tag, props, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k in node) node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid != null && kid !== false) node.append(kid);
  }
  return node;
}

const empty = (msg) => h("li", { class: "empty" }, state.lastSync ? msg : "Wird geladen…");

function errText(e) {
  const msg = (e && e.message) || String(e);
  if (/duplicate key/i.test(msg)) return "Das hat schon jemand abgehakt.";
  if (/invalid login credentials/i.test(msg)) return "Name oder Passwort stimmt nicht.";
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return "Keine Verbindung zum Server – bitte Internet prüfen.";
  return msg;
}

let toastTimer = 0;
function toast(msg, isErr = false) {
  const t = el("toast");
  t.textContent = msg;
  t.classList.toggle("err", isErr);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), isErr ? 6000 : 2500);
}

/* --------------------------------------------------------------------------
   Sync + actions
   -------------------------------------------------------------------------- */
let inFlight = false;
let again = false;

async function refresh() {
  if (!state.me) return;
  if (inFlight) {
    again = true;
    return;
  }
  inFlight = true;
  try {
    const cur = monthOf(todayISO());
    const data = await store.load(state.month < cur ? state.month : cur, state.month);
    Object.assign(state, data);
    state.me = data.profiles.find((p) => p.id === state.me.id) || state.me;
    state.error = "";
    state.lastSync = new Date();
  } catch (e) {
    state.error = errText(e);
  } finally {
    inFlight = false;
    if (again) {
      again = false;
      refresh();
    } else {
      render();
    }
  }
}

async function complete(t) {
  const key = `t${t.id}`;
  if (state.busy.has(key)) return;
  const userId = isAdmin() ? state.actAs : state.me.id;

  // optimistic
  const temp = { id: -1, task_id: t.id, user_id: userId, done_on: todayISO(), points: t.points, created_at: new Date().toISOString() };
  state.busy.add(key);
  state.completions = [...state.completions, temp];
  render();

  try {
    await store.complete(t.id, userId);
  } catch (e) {
    toast(errText(e), true);
  }
  state.busy.delete(key);
  state.completions = state.completions.filter((c) => c !== temp);
  await refresh();
}

async function undo(c) {
  const key = `c${c.id}`;
  if (state.busy.has(key)) return;
  if (c.user_id !== state.me.id && !confirm(`${c.points} Punkte von ${nameOf(c.user_id)} wieder abziehen?`)) return;

  state.busy.add(key);
  render();
  try {
    await store.undo(c.id);
  } catch (e) {
    toast(errText(e), true);
  }
  state.busy.delete(key);
  await refresh();
}

async function archive(t) {
  if (!confirm(`„${t.title}“ entfernen? Bereits verdiente Punkte bleiben.`)) return;
  try {
    await store.updateTask(t.id, { archived: true });
    toast(`„${t.title}“ entfernt.`);
  } catch (e) {
    toast(errText(e), true);
  }
  if (document.activeElement) document.activeElement.blur();
  refresh();
}

async function signIn(...args) {
  el("login-err").textContent = "";
  try {
    await store.signIn(...args);
    const me = await store.me();
    if (!me) throw new Error("Angemeldet, aber zu diesem Konto gibt es kein Profil. Wurde schema.sql ausgeführt?");
    setMe(me);
  } catch (e) {
    el("login-err").textContent = errText(e);
  }
}

function setMe(me) {
  Object.assign(state, {
    me, actAs: me ? me.id : null,
    profiles: [], tasks: [], completions: [], goal: null,
    month: monthOf(todayISO()), logAll: false, lastSync: null, error: "",
  });
  showView();
  if (me) refresh();
}

/* --------------------------------------------------------------------------
   Render
   -------------------------------------------------------------------------- */
function showView() {
  const on = !!state.me;
  el("login").hidden = on;
  el("app").hidden = !on;
  el("account").hidden = !on;
  el("foot").hidden = !on;

  if (on) return render();

  el("sub").textContent = "Ämtli erledigen, Punkte sammeln, Monatsziel erreichen.";
  el("login-form").hidden = store.kind !== "supabase";
  el("demo-login").hidden = store.kind !== "local";
  if (store.kind === "local") {
    el("demo-people").replaceChildren(...store.demoProfiles().map((p) =>
      h("button", { type: "button", onclick: () => signIn(p.id) }, p.is_admin ? `${p.name} · verteilt die Ämtli` : p.name)
    ));
  }
}

function render() {
  if (!state.me) return;
  const today = todayISO();
  if (!state.profiles.some((p) => p.id === state.actAs)) state.actAs = state.me.id;

  renderTop(today);
  renderScores(today);
  renderDaily(today);
  renderSpecial(today);
  renderLog();
  renderAdmin();
  renderStatus();
}

function renderTop(today) {
  el("me-name").textContent = state.me.name;

  const cur = monthOf(today);
  const mine = pointsByUser(cur).get(state.me.id) || 0;
  const month = fmtMonthName.format(fromISO(cur));
  const goal = state.month === cur ? state.goal : null;
  el("sub").textContent = isAdmin() && !mine
    ? "Du verteilst die Ämtli und setzt das Ziel. Alle anderen sammeln Punkte."
    : goal
      ? `Bisher ${mine} von ${goal} Punkten im ${month}.`
      : `Bisher ${plural(mine, "Punkt", "Punkte")} im ${month}.`;

  el("act-as-wrap").hidden = !isAdmin();
  const sel = el("act-as");
  if (isAdmin() && document.activeElement !== sel) {
    sel.replaceChildren(...state.profiles.map((p) =>
      h("option", { value: p.id }, p.id === state.me.id ? `${p.name} (ich)` : p.name)
    ));
    sel.value = state.actAs;
  }
}

function renderScores(today) {
  const cur = monthOf(today);
  el("score-title").textContent = fmtMonth.format(fromISO(state.month));
  el("next-month").disabled = state.month >= cur;

  const goal = state.goal;
  const bits = [goal ? `Ziel: ${goal} Punkte pro Person` : "noch kein Ziel gesetzt"];
  if (state.month === cur) {
    const first = fromISO(cur);
    const left = daysBetween(today, iso(new Date(first.getFullYear(), first.getMonth() + 1, 0))) + 1;
    bits.push(`noch ${plural(left, "Tag", "Tage")}`);
  } else {
    bits.push("Monat ist vorbei");
  }
  el("score-hint").textContent = bits.join(" · ");

  // Admins only show up once they've actually earned something.
  const pts = pointsByUser(state.month);
  const people = state.profiles
    .filter((p) => !p.is_admin || pts.get(p.id))
    .sort((a, b) => (pts.get(b.id) || 0) - (pts.get(a.id) || 0) || a.name.localeCompare(b.name));

  if (!people.length) return el("scores").replaceChildren(empty("Noch sammelt niemand Punkte."));

  el("scores").replaceChildren(...people.map((p) => {
    const n = pts.get(p.id) || 0;
    const reached = !!goal && n >= goal;
    const pct = goal ? Math.min(100, Math.round((n / goal) * 100)) : 0;
    return h("li", { class: "score" + (p.id === state.me.id ? " is-me" : "") + (reached ? " is-reached" : "") },
      h("span", { class: "score-name" }, p.name),
      h("div", {
        class: "bar", role: "progressbar",
        "aria-label": `${p.name}: ${plural(n, "Punkt", "Punkte")}`, "aria-valuemin": 0, "aria-valuemax": goal || 0, "aria-valuenow": n,
      }, h("i", { style: `width:${pct}%` })),
      h("span", { class: "score-num" }, goal ? `${n} / ${goal}` : `${n} Pkt.`, reached ? " ✓" : ""));
  }));
}

function renderDaily(today) {
  const tasks = state.tasks.filter((t) => t.kind === "daily" && !t.archived);
  const doneToday = new Map(state.completions.filter((c) => c.done_on === today).map((c) => [c.task_id, c]));
  const doneCount = tasks.filter((t) => doneToday.has(t.id)).length;

  el("daily-hint").textContent = fmtDay.format(fromISO(today)) + (tasks.length ? ` · ${doneCount}/${tasks.length} erledigt` : "");

  if (!tasks.length) {
    return el("daily").replaceChildren(empty(isAdmin() ? "Noch keine täglichen Ämtli – füge unter «Verwalten» welche hinzu." : "Noch keine täglichen Ämtli."));
  }
  const sorted = [...tasks].sort((a, b) => doneToday.has(a.id) - doneToday.has(b.id));
  el("daily").replaceChildren(...sorted.map((t) => taskRow(t, doneToday.get(t.id), null)));
}

function renderSpecial(today) {
  const doneBy = new Map();
  for (const c of state.completions) {
    const t = taskById(c.task_id);
    if (t && t.kind === "special") doneBy.set(t.id, c);
  }

  const open = state.tasks
    .filter((t) => t.kind === "special" && !t.archived && !doneBy.has(t.id))
    .sort((a, b) => (a.due_on || "9999").localeCompare(b.due_on || "9999") || b.points - a.points);
  const cur = monthOf(today);
  const recent = [...doneBy.values()]
    .filter((c) => monthOf(c.done_on) === cur)
    .sort((a, b) => b.done_on.localeCompare(a.done_on));

  el("special-hint").textContent = open.length ? `${open.length} offen` : "";
  el("special").replaceChildren(...(open.length
    ? open.map((t) => taskRow(t, null, dueLabel(t, today)))
    : [empty(recent.length ? "Alles erledigt – super!" : isAdmin() ? "Noch keine Spezial-Ämtli – füge unter «Verwalten» eins hinzu." : "Gerade keine Spezial-Ämtli.")]));

  el("special-done-wrap").hidden = !recent.length;
  el("special-done-sum").textContent = `Diesen Monat erledigt (${recent.length})`;
  el("special-done").replaceChildren(...recent.map((c) =>
    taskRow(taskById(c.task_id), c, `erledigt ${fmtShort.format(fromISO(c.done_on))}`)
  ));
}

function dueLabel(t, today) {
  if (!t.due_on) return "ohne Frist";
  const days = daysBetween(today, t.due_on);
  const date = fmtShort.format(fromISO(t.due_on));
  if (days < 0) return h("span", { class: "overdue" }, `überfällig · war fällig am ${date}`);
  if (days === 0) return h("span", { class: "soon" }, "heute fällig");
  if (days === 1) return h("span", { class: "soon" }, "morgen fällig");
  return `fällig ${date} · in ${days} Tagen`;
}

function taskRow(t, c, meta) {
  let action;
  if (c) {
    action = [h("span", { class: "done-by" }, "✓ ", nameOf(c.user_id))];
    if (canUndo(c)) {
      action.push(h("button", {
        type: "button", class: "ghost small", disabled: state.busy.has(`c${c.id}`), onclick: () => undo(c),
      }, "Rückgängig"));
    }
  } else {
    const other = isAdmin() && state.actAs !== state.me.id ? nameOf(state.actAs) : "";
    action = h("button", {
      type: "button", class: "small", disabled: state.busy.has(`t${t.id}`), onclick: () => complete(t),
    }, other ? `${other} hat's gemacht` : "Hab ich gemacht");
  }

  const metaBits = [meta, t.notes].filter(Boolean);
  return h("li", { class: "task" + (c ? " is-done" : "") },
    h("span", { class: "pts" }, `+${c ? c.points : t.points}`),
    h("div", { class: "task-main" },
      h("span", { class: "task-title" }, t.title),
      metaBits.length ? h("small", { class: "task-meta" }, metaBits.flatMap((b, i) => (i ? [" · ", b] : [b]))) : null),
    h("div", { class: "task-act" }, action));
}

function renderLog() {
  const rows = state.completions
    .filter((c) => monthOf(c.done_on) === state.month)
    .sort((a, b) => b.done_on.localeCompare(a.done_on) || String(b.created_at).localeCompare(String(a.created_at)));
  const total = rows.reduce((sum, c) => sum + c.points, 0);

  el("log-title").textContent = `Verlauf · ${fmtMonthName.format(fromISO(state.month))}`;
  el("log-hint").textContent = rows.length ? `${rows.length} Ämtli · ${plural(total, "Punkt", "Punkte")}` : "";

  const shown = state.logAll ? rows : rows.slice(0, LOG_PREVIEW);
  el("log").replaceChildren(...(shown.length
    ? shown.map((c) => {
        const t = taskById(c.task_id);
        return h("li", {},
          h("span", { class: "log-date" }, fmtShort.format(fromISO(c.done_on))),
          h("span", { class: "log-what" }, h("b", {}, nameOf(c.user_id)), " · ", t ? t.title : "ein entferntes Ämtli"),
          h("span", { class: "log-pts" }, `+${c.points}`),
          canUndo(c)
            ? h("button", { type: "button", class: "ghost small", disabled: state.busy.has(`c${c.id}`), onclick: () => undo(c) }, "Rückgängig")
            : h("span"));
      })
    : [empty("Diesen Monat wurde noch nichts abgehakt.")]));

  const more = el("log-more");
  more.hidden = rows.length <= LOG_PREVIEW;
  more.textContent = state.logAll ? "Weniger anzeigen" : `Alle ${rows.length} anzeigen`;
}

function renderAdmin() {
  el("admin").hidden = !isAdmin();
  if (!isAdmin()) return;

  el("goal-title").textContent = `Ziel für ${fmtMonth.format(fromISO(state.month))}`;
  const goalInput = el("goal-input");
  if (document.activeElement !== goalInput && !goalInput.dataset.dirty) goalInput.value = state.goal ?? "";

  // Don't wipe out an edit that's in progress when the background refresh lands.
  const host = el("task-admin");
  const editing = host.contains(document.activeElement) ||
    [...host.querySelectorAll("input")].some((i) => i.value !== i.defaultValue);
  if (editing) return;

  // Finished special jobs have nothing left to manage.
  const doneIds = new Set(state.completions.map((c) => c.task_id));
  const list = state.tasks
    .filter((t) => !t.archived && !(t.kind === "special" && doneIds.has(t.id)))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title));
  host.replaceChildren(...(list.length ? list.map(adminRow) : [empty("Noch keine Ämtli.")]));
}

function adminRow(t) {
  const title = h("input", { type: "text", class: "grow", maxLength: 80, defaultValue: t.title, "aria-label": "Name des Ämtli" });
  const points = h("input", { type: "number", min: 1, max: 1000, step: 1, defaultValue: t.points, "aria-label": "Punkte" });
  const due = t.kind === "special"
    ? h("input", { type: "date", defaultValue: t.due_on || "", "aria-label": "Fällig bis" })
    : null;

  const save = async () => {
    const patch = { title: title.value.trim(), points: Math.round(Number(points.value)) };
    if (due) patch.due_on = due.value || null;
    if (!patch.title || !(patch.points >= 1)) return toast("Ein Ämtli braucht einen Namen und mindestens 1 Punkt.", true);
    try {
      await store.updateTask(t.id, patch);
      for (const input of [title, points, due]) if (input) input.defaultValue = input.value;
      if (document.activeElement) document.activeElement.blur();
      toast(`„${patch.title}“ gespeichert.`);
    } catch (e) {
      toast(errText(e), true);
    }
    refresh();
  };

  return h("li", { class: "admin-row" },
    h("span", { class: "kind-tag" + (t.kind === "special" ? " is-special" : "") }, t.kind === "daily" ? "täglich" : "spezial"),
    title, points, due || h("span"),
    h("button", { type: "button", class: "small", onclick: save }, "Speichern"),
    h("button", { type: "button", class: "ghost small", onclick: () => archive(t) }, "Entfernen"));
}

function renderStatus() {
  const s = el("status");
  s.classList.toggle("err", !!state.error);
  if (state.error) {
    s.textContent = state.error;
    return;
  }
  const where = store.kind === "supabase" ? "synchronisiert" : "Demo · nur in diesem Browser gespeichert";
  s.textContent = state.lastSync ? `${where} · ${fmtTime.format(state.lastSync)}` : "wird geladen…";
}

/* --------------------------------------------------------------------------
   Wiring
   -------------------------------------------------------------------------- */
function init() {
  const banner = el("banner");

  if (HAS_KEYS && !window.supabase) {
    banner.hidden = false;
    banner.textContent = "Die Supabase-Bibliothek konnte nicht geladen werden – bitte Internetverbindung prüfen und neu laden.";
    return;
  }

  store = HAS_KEYS ? remoteStore() : localStore();

  if (store.kind === "local") {
    banner.hidden = false;
    banner.innerHTML =
      "<strong>Demo-Modus.</strong> Supabase ist noch nicht eingerichtet, darum wird alles nur in diesem Browser gespeichert. " +
      "Projekt-URL und Publishable Key in <code>config.js</code> eintragen (Anleitung in <code>README.md</code>).";
    banner.append(h("button", {
      type: "button", class: "ghost small",
      onclick: () => { store.reset(); setMe(null); },
    }, "Demo zurücksetzen"));
  }

  el("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const btn = form.querySelector("button");
    btn.disabled = true;
    await signIn(loginEmail(String(fd.get("email"))), String(fd.get("password")));
    btn.disabled = false;
  });

  el("sign-out").addEventListener("click", async () => {
    await store.signOut();
    setMe(null);
  });

  el("act-as").addEventListener("change", (e) => {
    state.actAs = e.target.value;
    render();
  });

  const goMonth = (n) => {
    state.month = addMonths(state.month, n);
    state.logAll = false;
    delete el("goal-input").dataset.dirty;
    render();
    refresh();
  };
  el("prev-month").addEventListener("click", () => goMonth(-1));
  el("next-month").addEventListener("click", () => goMonth(1));

  el("log-more").addEventListener("click", () => {
    state.logAll = !state.logAll;
    renderLog();
  });

  const taskForm = el("task-form");
  const syncKind = () => {
    el("due-field").hidden = taskForm.elements.kind.value !== "special";
  };
  taskForm.addEventListener("change", syncKind);
  taskForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(taskForm);
    const kind = String(fd.get("kind"));
    const task = {
      title: String(fd.get("title")).trim(),
      notes: String(fd.get("notes")).trim(),
      points: Math.round(Number(fd.get("points"))),
      kind,
      due_on: kind === "special" && fd.get("due_on") ? String(fd.get("due_on")) : null,
    };
    if (!task.title || !(task.points >= 1)) return toast("Ein Ämtli braucht einen Namen und mindestens 1 Punkt.", true);

    const btn = taskForm.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      await store.addTask(task);
      taskForm.reset();
      syncKind();
      toast(`„${task.title}“ hinzugefügt.`);
    } catch (err) {
      toast(errText(err), true);
    }
    btn.disabled = false;
    refresh();
  });

  const goalInput = el("goal-input");
  goalInput.addEventListener("input", () => (goalInput.dataset.dirty = "1"));
  el("goal-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const points = Math.round(Number(goalInput.value));
    if (!(points >= 0)) return;
    try {
      await store.setGoal(state.month, points);
      delete goalInput.dataset.dirty;
      goalInput.blur();
      toast(`Ziel für ${fmtMonthName.format(fromISO(state.month))}: ${points} Punkte pro Person.`);
    } catch (err) {
      toast(errText(err), true);
    }
    refresh();
  });

  el("refresh").addEventListener("click", refresh);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refresh();
  });
  setInterval(() => {
    if (document.visibilityState === "visible") refresh();
  }, 30000);

  store.me()
    .then(setMe)
    .catch((e) => {
      setMe(null);
      el("login-err").textContent = errText(e);
    });
}

document.addEventListener("DOMContentLoaded", init);
