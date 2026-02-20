// =====================
// CONFIG (Supabase)
// =====================
console.log("app.js loaded at", new Date().toISOString());


const SUPABASE_URL = "https://zxvsdhwgmhtmhjmaoadz.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_a7T2SKKrhnWqdV35YK8Wuw_h-auUpW9";

// IMPORTANT: don't name any variable `supabase`
let sb = null;

function initSupabaseClient() {
  const hasSupabase = !!(window.supabase && typeof window.supabase.createClient === "function");
  if (!hasSupabase) return null;

  return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}


// =====================
// DOM
// =====================
const els = {
  userName: document.getElementById("userName"),
  grid: document.getElementById("characterGrid"),
  status: document.getElementById("status"),
  assignments: document.getElementById("assignments"),
  refreshBtn: document.getElementById("refreshBtn"),
};

let characters = [];            // loaded from character_list.json
let picksById = new Map();      // character_id -> pick row

function setStatus(msg) {
  els.status.textContent = msg || "";
}

function sanitizeName(raw) {
  return (raw || "").trim().replace(/\s+/g, " ").slice(0, 60);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function genderLabel(id) {
  if (id >= 1 && id <= 15) return "Male (1–15)";
  if (id >= 16 && id <= 29) return "Female (16–29)";
  return "Unknown";
}

// =====================
// LOAD CHARACTERS (local JSON)
// =====================
async function loadCharacters() {
  let data = null;

  try {
    const res = await fetch(`./character_list.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Could not load character_list.json. Make sure it’s in the repo root.");
    data = await res.json();
  } catch (err) {
    if (window.CHARACTER_LIST && Array.isArray(window.CHARACTER_LIST.characters)) {
      data = window.CHARACTER_LIST;
    } else {
      throw err;
    }
  }

  if (!data || !Array.isArray(data.characters)) {
    throw new Error("character_list data must have a top-level { \"characters\": [...] } shape.");
  }

  // normalize + sort
  characters = data.characters
    .map(c => ({
      id: Number(c.id),
      name: c.name ?? "",
      importance: c.importance ?? "",
      occupation: c.occupation ?? "",
      description: c.description ?? ""
    }))
    .filter(c => Number.isInteger(c.id))
    .sort((a, b) => a.id - b.id);
}


// =====================
// LOAD PICKS (Supabase)
// =====================
async function loadPicks() {
  if (!sb) {
    picksById = new Map();
    return;
  }

  const { data, error } = await sb
    .from("character_picks")
    .select("character_id, character_name, user_name, picked_at")
    .order("character_id", { ascending: true });

  if (error) throw error;

  picksById = new Map();
  for (const row of data) picksById.set(row.character_id, row);
}

// =====================
// RENDER
// =====================
function renderGrid() {
  els.grid.innerHTML = "";

  for (const c of characters) {
    const taken = picksById.has(c.id);
    const takenBy = taken ? picksById.get(c.id).user_name : null;

    const card = document.createElement("div");
    card.className = `character ${taken ? "taken" : ""}`;

    const top = document.createElement("div");
    top.className = "top";
    top.innerHTML = `
      <div>
        <div class="name">${escapeHtml(c.name)} <span class="meta">(#${c.id})</span></div>
        <div class="meta">${escapeHtml(c.importance)} • ${escapeHtml(c.occupation || "Unspecified")}</div>
      </div>
      <div class="meta">${escapeHtml(genderLabel(c.id))}</div>
    `;

    const desc = document.createElement("div");
    desc.className = "desc";
    desc.textContent = c.description;

    const btn = document.createElement("button");
    btn.className = "btn pick";
    btn.type = "button";
    btn.disabled = taken;
    btn.textContent = taken ? `Taken by ${takenBy}` : "Pick this character";
    btn.addEventListener("click", async () => pickCharacter(c));

    card.appendChild(top);
    card.appendChild(desc);
    card.appendChild(btn);
    els.grid.appendChild(card);
  }
}

function renderAssignments() {
  els.assignments.innerHTML = "";

  const picks = [...picksById.values()].sort((a, b) => a.character_id - b.character_id);
  if (picks.length === 0) {
    els.assignments.innerHTML = `<div class="assignment"><div class="what">No picks yet.</div></div>`;
    return;
  }

  for (const p of picks) {
    const div = document.createElement("div");
    div.className = "assignment";
    div.innerHTML = `
      <div class="who">${escapeHtml(p.user_name)}</div>
      <div class="what">picked <strong>${escapeHtml(p.character_name)}</strong> (#${p.character_id})</div>
    `;
    els.assignments.appendChild(div);
  }
}

// =====================
// ACTION: PICK
// =====================
async function pickCharacter(character) {
  const userName = sanitizeName(els.userName.value);
  if (!userName) {
    setStatus("Please enter your name first.");
    els.userName.focus();
    return;
  }

  if (!sb) {
    setStatus("Supabase is not available right now, so picks cannot be saved.");
    return;
  }

  setStatus(`Saving your pick: ${character.name}...`);

  // character_id is PRIMARY KEY in the table, so only one person can take each id.
  const { error } = await sb.from("character_picks").insert([{
  character_id: character.id,
  character_name: character.name,
  user_name: userName
  }]);

  if (error) {
    setStatus(`Could not save. It may already be taken. (${error.message})`);
    await refresh();
    return;
  }

  setStatus(`Saved! You picked ${character.name}.`);
  await refresh();
}

// =====================
// REFRESH + LIVE UPDATES
// =====================
async function refresh() {
  await loadPicks();
  renderGrid();
  renderAssignments();
}

function subscribeRealtime() {
  if (!sb) return;

  sb
    .channel("character-picks-live")
    .on("postgres_changes",
      { event: "*", schema: "public", table: "character_picks" },
      async () => { try { await refresh(); } catch (_) {} }
    )
    .subscribe();
}

// =====================
// BOOT
// =====================
async function boot() {
  try {
    sb = initSupabaseClient();

    setStatus("Loading characters...");
    await loadCharacters();

    // ✅ Render characters immediately (assume all available until picks load)
    picksById = new Map();
    renderGrid();
    renderAssignments();

    setStatus("Loading current picks...");
    try {
      await refresh();
      setStatus("");
    } catch (e) {
      console.error(e);
      // ✅ Still show characters; just warn that picks couldn't load
      setStatus(`Characters loaded, but picks couldn't load: ${e.message || e}`);
    }

    if (!sb) {
      setStatus("Characters loaded, but Supabase failed to initialize (check internet/CDN/script blocking).");
    }

    els.refreshBtn.addEventListener("click", async () => {
      try {
        setStatus("Refreshing...");
        await refresh();
        setStatus("");
      } catch (e) {
        setStatus(`Refresh failed: ${e.message || e}`);
      }
    });

    try { subscribeRealtime(); } catch (_) {}
  } catch (e) {
    console.error(e);
    setStatus(`Startup failed: ${e.message || e}`);
  }
}

boot();
