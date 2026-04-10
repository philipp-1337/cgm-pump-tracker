const STORAGE_KEY = "cgm-tracker-v2";

const DEVICES = {
  dex: {
    key: "dex",
    label: "Dexcom G7",
    intervalDays: 10,
    positions: ["Rechter Arm", "Linker Arm", "Rechter Bauch", "Linker Bauch"],
    colorClass: "dex",
  },
  pod: {
    key: "pod",
    label: "Omnipod 5",
    intervalDays: 3,
    positions: ["Rechtes Bein", "Linkes Bein", "Rechter Bauch", "Linker Bauch", "Rechter Arm", "Linker Arm"],
    colorClass: "pod",
  },
};

const DEFAULT_REST_DAYS = {
  dex: 10,
  pod: 6,
};

const selectedTags = new Set();

function now() {
  return new Date();
}

function startOfToday() {
  const value = now();
  value.setHours(0, 0, 0, 0);
  return value;
}

function addDays(date, amount) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

function addHours(date, amount) {
  const copy = new Date(date);
  copy.setHours(copy.getHours() + amount);
  return copy;
}

function parseDate(value) {
  return new Date(value);
}

function isoDate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function isoDateTimeLocal(value) {
  const d = new Date(value);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

function formatDate(value) {
  return new Date(value).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateTime(value) {
  return new Date(value).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function daysBetween(from, to) {
  const start = new Date(from);
  const end = new Date(to);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return Math.round((end - start) / 86400000);
}

function getSide(position) {
  return position.toLowerCase().includes("link") ? "left" : "right";
}

function createDefaultSiteState(deviceKey) {
  const entries = {};
  DEVICES[deviceKey].positions.forEach((position) => {
    entries[position] = { paused: false, restDays: DEFAULT_REST_DAYS[deviceKey] };
  });
  return entries;
}

function createInitialState() {
  return {
    current: null,
    history: [],
    sites: {
      dex: createDefaultSiteState("dex"),
      pod: createDefaultSiteState("pod"),
    },
    createdAt: new Date().toISOString(),
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return createInitialState();
    return migrateState(saved);
  } catch (error) {
    return createInitialState();
  }
}

function migrateState(state) {
  const next = createInitialState();
  if (state.current) next.current = state.current;
  if (Array.isArray(state.history)) next.history = state.history;

  Object.keys(next.sites).forEach((deviceKey) => {
    const source = state.sites?.[deviceKey] || {};
    DEVICES[deviceKey].positions.forEach((position) => {
      next.sites[deviceKey][position] = {
        paused: Boolean(source[position]?.paused),
        restDays: Number(source[position]?.restDays) || DEFAULT_REST_DAYS[deviceKey],
      };
    });
  });

  return next;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function latestChangeFor(deviceKey, position) {
  return state.history.find((entry) => entry.device === deviceKey && entry.to === position) || null;
}

function reminderText(startAt, intervalDays) {
  const dueAt = addDays(parseDate(startAt), intervalDays);
  const diffMs = dueAt - now();
  const diffHours = Math.ceil(diffMs / 3600000);
  const diffDays = daysBetween(startOfToday(), dueAt);

  if (diffMs < 0) {
    const overdueDays = Math.abs(diffDays);
    return {
      label: overdueDays <= 1 ? "Heute ueberfaellig" : `${overdueDays} Tage ueberfaellig`,
      tone: "is-danger",
      meta: `Faellig seit ${formatDateTime(dueAt)}`,
    };
  }

  if (diffHours <= 6) {
    return {
      label: `In ${Math.max(diffHours, 1)} Stunden faellig`,
      tone: "is-danger",
      meta: `Spaetestens ${formatDateTime(dueAt)}`,
    };
  }

  if (diffDays === 0) {
    return {
      label: "Heute wechseln",
      tone: "is-warning",
      meta: `Faellig um ${formatDateTime(dueAt)}`,
    };
  }

  if (diffDays === 1) {
    return {
      label: "Morgen faellig",
      tone: "is-warning",
      meta: `Faellig am ${formatDateTime(dueAt)}`,
    };
  }

  return {
    label: `Noch ${diffDays} Tage`,
    tone: "is-ok",
    meta: `Faellig am ${formatDateTime(dueAt)}`,
  };
}

function getEligiblePositions(deviceKey, excludePosition, targetDate) {
  const positions = DEVICES[deviceKey].positions;
  const target = parseDate(targetDate);
  const options = positions.filter((position) => {
    if (position === excludePosition) return false;
    const siteState = state.sites[deviceKey][position];
    if (siteState.paused) return false;

    const latest = latestChangeFor(deviceKey, position);
    if (!latest) return true;

    const availableAt = addDays(parseDate(latest.at), siteState.restDays);
    return availableAt <= target;
  });

  return options;
}

function suggestNextPosition(deviceKey, excludePosition, referenceDate) {
  const currentPosition = state.current?.[deviceKey]?.position || "";
  const ordered = DEVICES[deviceKey].positions.slice();
  const oppositeSideFirst = ordered.sort((a, b) => {
    const aScore = getSide(a) === getSide(currentPosition) ? 1 : 0;
    const bScore = getSide(b) === getSide(currentPosition) ? 1 : 0;
    return aScore - bScore;
  });

  const eligible = getEligiblePositions(deviceKey, excludePosition, referenceDate);
  const preferred = oppositeSideFirst.find((position) => eligible.includes(position));
  if (preferred) return preferred;

  return ordered.find((position) => position !== excludePosition && !state.sites[deviceKey][position].paused) || currentPosition;
}

function makeHistoryEntry(deviceKey, fromPosition, toPosition, at, rating, note, tags) {
  return {
    id: `${deviceKey}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    device: deviceKey,
    from: fromPosition,
    to: toPosition,
    at,
    rating,
    note,
    tags,
  };
}

function bootstrapHistoryFromCurrent() {
  if (!state.current || state.history.length > 0) return;
  Object.keys(DEVICES).forEach((deviceKey) => {
    const currentEntry = state.current[deviceKey];
    state.history.unshift(
      makeHistoryEntry(deviceKey, currentEntry.position, currentEntry.position, currentEntry.startAt, 3, "Initialer Startwert", [])
    );
  });
  saveState();
}

function populateSetupSelects() {
  Object.keys(DEVICES).forEach((deviceKey) => {
    const select = document.getElementById(`${deviceKey}-pos`);
    select.innerHTML = "";
    DEVICES[deviceKey].positions.forEach((position) => {
      const option = document.createElement("option");
      option.value = position;
      option.textContent = position;
      select.appendChild(option);
    });
  });
}

function updateChangePositionOptions() {
  const deviceKey = document.getElementById("change-device").value;
  const select = document.getElementById("change-position");
  const currentPosition = state.current?.[deviceKey]?.position || "";
  const referenceDate = document.getElementById("change-at").value || new Date().toISOString();
  const suggestion = suggestNextPosition(deviceKey, currentPosition, referenceDate);

  select.innerHTML = "";
  DEVICES[deviceKey].positions.forEach((position) => {
    const option = document.createElement("option");
    const paused = state.sites[deviceKey][position].paused;
    option.value = position;
    option.textContent = paused ? `${position} (pausiert)` : position;
    option.disabled = paused;
    if (position === suggestion) option.selected = true;
    select.appendChild(option);
  });
}

function renderStatus() {
  const wrapper = document.getElementById("status-grid");
  wrapper.innerHTML = "";

  Object.keys(DEVICES).forEach((deviceKey) => {
    const currentEntry = state.current?.[deviceKey];
    if (!currentEntry) return;

    const template = document.getElementById("status-card-template").content.firstElementChild.cloneNode(true);
    template.querySelector(".device-chip").textContent = DEVICES[deviceKey].label;
    template.querySelector(".device-chip").classList.add(DEVICES[deviceKey].colorClass);
    template.querySelector(".status-position").textContent = currentEntry.position;

    const reminder = reminderText(currentEntry.startAt, DEVICES[deviceKey].intervalDays);
    const reminderNode = template.querySelector(".status-reminder");
    reminderNode.textContent = reminder.label;
    reminderNode.classList.add(reminder.tone);

    const latest = state.history.find((entry) => entry.device === deviceKey);
    const tags = latest?.tags?.length ? ` · ${latest.tags.join(", ")}` : "";
    template.querySelector(".status-meta").textContent = `Seit ${formatDate(currentEntry.startAt)} · ${reminder.meta}${tags}`;

    wrapper.appendChild(template);
  });
}

function buildSchedule() {
  if (!state.current) return [];

  const items = [];
  const horizon = addDays(startOfToday(), 45);

  Object.keys(DEVICES).forEach((deviceKey) => {
    let startAt = parseDate(state.current[deviceKey].startAt);
    let fromPosition = state.current[deviceKey].position;

    for (let i = 0; i < 6; i += 1) {
      const dueAt = addDays(startAt, DEVICES[deviceKey].intervalDays);
      if (dueAt > horizon) break;

      const suggestion = suggestNextPosition(deviceKey, fromPosition, dueAt.toISOString());
      const eligible = getEligiblePositions(deviceKey, fromPosition, dueAt.toISOString());

      items.push({
        id: `${deviceKey}-${i}`,
        device: deviceKey,
        dueAt,
        fromPosition,
        toPosition: suggestion,
        blocked: eligible.length === 0,
      });

      startAt = dueAt;
      fromPosition = suggestion;
    }
  });

  return items.sort((a, b) => a.dueAt - b.dueAt).slice(0, 10);
}

function renderTimeline() {
  const wrapper = document.getElementById("timeline");
  const schedule = buildSchedule();
  wrapper.innerHTML = "";

  if (schedule.length === 0) {
    wrapper.innerHTML = '<div class="empty-state">Sobald aktuelle Werte gesetzt sind, erscheinen hier die naechsten Wechsel.</div>';
    return;
  }

  schedule.forEach((item) => {
    const card = document.createElement("article");
    card.className = "timeline-item";

    const top = document.createElement("div");
    top.className = "timeline-top";

    const title = document.createElement("div");
    title.innerHTML = `<p class="section-kicker">${DEVICES[item.device].label}</p><div class="timeline-title">${formatDateTime(item.dueAt)}</div>`;

    const tagWrap = document.createElement("div");
    tagWrap.className = "timeline-tags";
    tagWrap.appendChild(makePill(item.blocked ? "keine freie Stelle" : item.toPosition));

    top.appendChild(title);
    top.appendChild(tagWrap);

    const meta = document.createElement("p");
    meta.className = "timeline-meta";
    meta.textContent = item.blocked
      ? `Von ${item.fromPosition}. Alle anderen Positionen sind pausiert oder noch in Ruhezeit.`
      : `Von ${item.fromPosition} nach ${item.toPosition}.`;

    card.appendChild(top);
    card.appendChild(meta);
    wrapper.appendChild(card);
  });
}

function makePill(text) {
  const node = document.createElement("span");
  node.className = "pill";
  node.textContent = text;
  return node;
}

function renderHistory() {
  const wrapper = document.getElementById("history-list");
  wrapper.innerHTML = "";

  if (state.history.length === 0) {
    wrapper.innerHTML = '<div class="empty-state">Noch keine Wechsel gespeichert.</div>';
    return;
  }

  state.history.slice(0, 12).forEach((entry) => {
    const item = document.createElement("article");
    item.className = "history-item";

    const top = document.createElement("div");
    top.className = "history-top";

    const title = document.createElement("div");
    title.innerHTML = `<div class="history-title">${DEVICES[entry.device].label}: ${entry.to}</div><div class="history-meta">${formatDateTime(entry.at)} · von ${entry.from}</div>`;

    const rating = document.createElement("div");
    rating.className = "rating";
    rating.textContent = "★".repeat(Number(entry.rating || 0));

    top.appendChild(title);
    top.appendChild(rating);
    item.appendChild(top);

    if (entry.tags?.length) {
      const tags = document.createElement("div");
      tags.className = "history-tags";
      entry.tags.forEach((tag) => tags.appendChild(makePill(tag)));
      item.appendChild(tags);
    }

    if (entry.note) {
      const note = document.createElement("p");
      note.textContent = entry.note;
      item.appendChild(note);
    }

    wrapper.appendChild(item);
  });
}

function renderSettings() {
  const wrapper = document.getElementById("settings-grid");
  wrapper.innerHTML = "";

  Object.keys(DEVICES).forEach((deviceKey) => {
    const card = document.createElement("article");
    card.className = "setting-card";
    card.innerHTML = `<div class="setting-top"><div><p class="section-kicker">${DEVICES[deviceKey].label}</p><h3>Verfuegbare Positionen</h3></div><p class="setting-note">Ruhezeit pro Stelle in Tagen.</p></div>`;

    DEVICES[deviceKey].positions.forEach((position) => {
      const row = document.createElement("div");
      row.className = "toggle-row";

      const siteState = state.sites[deviceKey][position];
      const latest = latestChangeFor(deviceKey, position);
      const latestText = latest ? `Zuletzt genutzt: ${formatDate(latest.at)}` : "Noch nicht genutzt";

      const label = document.createElement("label");
      label.className = "toggle";
      label.innerHTML = `<input type="checkbox" data-kind="paused" data-device="${deviceKey}" data-position="${position}" ${siteState.paused ? "checked" : ""}><span>${position} pausieren</span>`;

      const rest = document.createElement("label");
      rest.className = "toggle";
      rest.innerHTML = `<span>Ruhezeit</span><input type="number" min="1" max="30" value="${siteState.restDays}" data-kind="rest" data-device="${deviceKey}" data-position="${position}" style="width:76px"></label>`;

      const meta = document.createElement("div");
      meta.className = "setting-note";
      meta.textContent = latestText;

      row.appendChild(label);
      row.appendChild(rest);
      row.appendChild(meta);
      card.appendChild(row);
    });

    wrapper.appendChild(card);
  });
}

function renderVisibility() {
  const hasCurrent = Boolean(state.current);
  document.getElementById("setup-panel").hidden = hasCurrent;
  document.getElementById("tracker-panel").hidden = !hasCurrent;
}

function renderAll() {
  renderVisibility();
  if (!state.current) return;
  renderStatus();
  renderTimeline();
  renderHistory();
  renderSettings();
  updateChangePositionOptions();
}

function handleSetupSubmit(event) {
  event.preventDefault();
  const dexDate = document.getElementById("dex-date").value;
  const podDate = document.getElementById("pod-date").value;
  if (!dexDate || !podDate) {
    alert("Bitte beide Daten eingeben.");
    return;
  }

  state.current = {
    dex: {
      position: document.getElementById("dex-pos").value,
      startAt: `${dexDate}T12:00`,
    },
    pod: {
      position: document.getElementById("pod-pos").value,
      startAt: `${podDate}T12:00`,
    },
  };

  state.history = [
    makeHistoryEntry("dex", state.current.dex.position, state.current.dex.position, state.current.dex.startAt, 3, "Initialer Startwert", []),
    makeHistoryEntry("pod", state.current.pod.position, state.current.pod.position, state.current.pod.startAt, 3, "Initialer Startwert", []),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  saveState();
  primeChangeForm();
  renderAll();
}

function handleChangeSubmit(event) {
  event.preventDefault();
  const deviceKey = document.getElementById("change-device").value;
  const toPosition = document.getElementById("change-position").value;
  const at = document.getElementById("change-at").value;
  const rating = Number(document.getElementById("change-rating").value);
  const note = document.getElementById("change-note").value.trim();
  const currentEntry = state.current[deviceKey];

  if (!at || !toPosition) {
    alert("Bitte Wechselzeit und Position auswaehlen.");
    return;
  }

  const siteState = state.sites[deviceKey][toPosition];
  if (siteState.paused) {
    alert("Diese Position ist aktuell pausiert.");
    return;
  }

  const eligible = getEligiblePositions(deviceKey, currentEntry.position, at);
  if (!eligible.includes(toPosition) && toPosition !== currentEntry.position) {
    const proceed = confirm("Die Ruhezeit fuer diese Position ist noch nicht abgelaufen. Trotzdem speichern?");
    if (!proceed) return;
  }

  const entry = makeHistoryEntry(deviceKey, currentEntry.position, toPosition, at, rating, note, Array.from(selectedTags));
  state.current[deviceKey] = { position: toPosition, startAt: at };
  state.history.unshift(entry);
  saveState();

  resetChangeForm();
  renderAll();
}

function resetChangeForm() {
  document.getElementById("change-note").value = "";
  document.getElementById("change-rating").value = "3";
  selectedTags.clear();
  document.querySelectorAll(".tag-btn").forEach((button) => button.classList.remove("is-selected"));
  primeChangeForm();
}

function primeChangeForm() {
  document.getElementById("change-at").value = isoDateTimeLocal(now());
  updateChangePositionOptions();
}

function handleTagClicks(event) {
  const button = event.target.closest(".tag-btn");
  if (!button) return;

  const tag = button.dataset.tag;
  if (selectedTags.has(tag)) {
    selectedTags.delete(tag);
    button.classList.remove("is-selected");
  } else {
    selectedTags.add(tag);
    button.classList.add("is-selected");
  }
}

function handleSettingsChange(event) {
  const target = event.target;
  const deviceKey = target.dataset.device;
  const position = target.dataset.position;
  const kind = target.dataset.kind;
  if (!deviceKey || !position || !kind) return;

  if (kind === "paused") {
    state.sites[deviceKey][position].paused = target.checked;
  }

  if (kind === "rest") {
    const restDays = Math.max(1, Math.min(30, Number(target.value) || DEFAULT_REST_DAYS[deviceKey]));
    state.sites[deviceKey][position].restDays = restDays;
    target.value = restDays;
  }

  saveState();
  renderAll();
}

function exportState() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `cgm-tracker-backup-${isoDate(now())}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function resetTracker() {
  const confirmed = confirm("Tracker und Logbuch wirklich zuruecksetzen?");
  if (!confirmed) return;

  localStorage.removeItem(STORAGE_KEY);
  state = createInitialState();
  seedSetupDefaults();
  renderAll();
}

function seedSetupDefaults() {
  const todayValue = isoDate(now());
  const minDate = isoDate(addDays(now(), -365));

  document.getElementById("dex-date").max = todayValue;
  document.getElementById("pod-date").max = todayValue;
  document.getElementById("dex-date").min = minDate;
  document.getElementById("pod-date").min = minDate;

  document.getElementById("dex-pos").value = "Rechter Arm";
  document.getElementById("pod-pos").value = "Rechter Bauch";
  document.getElementById("dex-date").value = todayValue;
  document.getElementById("pod-date").value = todayValue;
}

function attachEvents() {
  document.getElementById("setup-form").addEventListener("submit", handleSetupSubmit);
  document.getElementById("change-form").addEventListener("submit", handleChangeSubmit);
  document.getElementById("change-device").addEventListener("change", updateChangePositionOptions);
  document.getElementById("change-at").addEventListener("change", updateChangePositionOptions);
  document.getElementById("tag-group").addEventListener("click", handleTagClicks);
  document.getElementById("settings-grid").addEventListener("change", handleSettingsChange);
  document.getElementById("export-json").addEventListener("click", exportState);
  document.getElementById("reset-btn").addEventListener("click", resetTracker);
}

let state = loadState();

function init() {
  populateSetupSelects();
  seedSetupDefaults();
  bootstrapHistoryFromCurrent();
  attachEvents();

  if (state.current) {
    primeChangeForm();
  }

  renderAll();
}

init();
