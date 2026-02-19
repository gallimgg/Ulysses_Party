// 1) CONFIG: paste yours from Supabase Project Settings -> API
const SUPABASE_URL = "https://zxvsdhwgmhtmhjmaoadz.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_a7T2SKKrhnWqdV35YK8Wuw_h-auUpW9";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const els = {
  userName: document.getElementById("userName"),
  grid: document.getElementById("characterGrid"),
  status: document.getElementById("status"),
  assignments: document.getElementById("assignments"),
  refreshBtn: document.getElementById("refreshBtn"),
};

let characters = [];
let picksById = new Map(); // character_id -> { character_id, character_name, user_name, picked_at }

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

async function loadCharacters() {
  const res = await fetch("./character_list.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load character_list.json");
  const data = await res.json();
  characters = Array.isArray(data.characters) ? data.characters : [];
  characters.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

async function loadPicks() {
  const { data, error } = await supabase
    .from("character_picks")
    .select("character_id, character_name, user_name, picked_at")
    .order("character_id", { ascending: true });

  if (error) throw error;

  picksById = new Map();
  for (const row of data) picksById.set(row.character_id, row);
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
        <div class="meta">${escapeHtml(c.importance || "")} • ${escapeHtml(c.occupation || "Unspecified")}</div>
      </div>
      <div class="meta">${escapeHtml(genderLabel(c.id))}</div>
    `;

    const desc = document.createElement("div");
    desc.className = "desc";
    desc.textContent = c.description || "";

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

async function pickCharacter(character) {
  const userName = sanitizeName(els.userName.value);
  if (!userName) {
    setStatus("Please enter your name first.");
    els.userName.focus();
    return;
  }

  setStatus(`Saving your pick: ${character.name}...`);

  // Primary key on character_id ensures only one pick per character.
  const { error } = await supabase.from("character_picks").insert([{
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

async function refresh() {
  await loadPicks();
  renderGrid();
  renderAssignments();
}

function subscribeRealtime() {
  supabase
    .channel("character-picks-live")
    .on("postgres_changes",
      { event: "*", schema: "public", table: "character_picks" },
      async () => {
        try { await refresh(); } catch (_) {}
      }
    )
    .subscribe();
}

async function boot() {
  try {
    setStatus("Loading...");
    await loadCharacters();
    await refresh();
    setStatus("");

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
