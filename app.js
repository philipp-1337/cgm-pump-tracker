const STORAGE_KEY = "cgm-tracker-v3";
const LEGACY_STORAGE_KEY = "cgm-tracker-v2";
const DEVICE_KEYS = ["dex", "pod"];

const DEFAULT_CONFIG = {
  dex: {
    key: "dex",
    label: "Dexcom G7",
    intervalDays: 10,
    positions: ["Rechter Arm", "Linker Arm", "Rechter Bauch", "Linker Bauch"],
    colorClass: "dex",
    defaultRestDays: 10,
  },
  pod: {
    key: "pod",
    label: "Omnipod 5",
    intervalDays: 3,
    positions: ["Rechtes Bein", "Linkes Bein", "Rechter Bauch", "Linker Bauch", "Rechter Arm", "Linker Arm"],
    colorClass: "pod",
    defaultRestDays: 6,
  },
};

const SYNC_WINDOW_DAYS = 2;

const selectedTags = new Set();
let calendarMonthOffset = 0;

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

function addMonths(date, amount) {
  const copy = new Date(date);
  copy.setMonth(copy.getMonth() + amount);
  return copy;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
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

function roundToNearestMinutes(value, minutes) {
  const copy = new Date(value);
  const stepMs = minutes * 60000;
  return new Date(Math.round(copy.getTime() / stepMs) * stepMs);
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

function formatMonth(value) {
  return new Date(value).toLocaleDateString("de-DE", { month: "long", year: "numeric" });
}

function daysBetween(from, to) {
  const start = new Date(from);
  const end = new Date(to);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return Math.round((end - start) / 86400000);
}

function createDefaultConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

function getDevice(deviceKey) {
  return state.config[deviceKey];
}

function getDevices() {
  return DEVICE_KEYS.map((key) => state.config[key]);
}

function createSiteStateForDevice(deviceKey, config = state?.config || createDefaultConfig()) {
  const entries = {};
  config[deviceKey].positions.forEach((position) => {
    entries[position] = { paused: false, restDays: config[deviceKey].defaultRestDays };
  });
  return entries;
}

function createInitialState() {
  const config = createDefaultConfig();
  return {
    config,
    current: null,
    history: [],
    sites: {
      dex: createSiteStateForDevice("dex", config),
      pod: createSiteStateForDevice("pod", config),
    },
    createdAt: new Date().toISOString(),
  };
}

function normalizeConfig(sourceConfig) {
  const config = createDefaultConfig();
  DEVICE_KEYS.forEach((deviceKey) => {
    const source = sourceConfig?.[deviceKey] || {};
    config[deviceKey] = {
      ...config[deviceKey],
      label: typeof source.label === "string" && source.label.trim() ? source.label.trim() : config[deviceKey].label,
      intervalDays: Math.max(1, Math.min(30, Number(source.intervalDays) || config[deviceKey].intervalDays)),
      positions: Array.isArray(source.positions) && source.positions.length
        ? source.positions.map((value) => String(value).trim()).filter(Boolean)
        : config[deviceKey].positions,
    };
  });
  return config;
}

function sortHistoryEntries(historyEntries = state.history) {
  return historyEntries.slice().sort((a, b) => new Date(b.at) - new Date(a.at));
}

function normalizePositionKey(position) {
  return String(position || "").trim().toLowerCase();
}

function isBellyPosition(position) {
  return normalizePositionKey(position).includes("bauch");
}

function getPositionZone(position) {
  const key = normalizePositionKey(position);
  if (key.includes("arm")) return "arm";
  if (key.includes("bauch")) return "belly";
  if (key.includes("bein")) return "leg";
  return "generic";
}

function getPositionSideLabel(position) {
  const key = normalizePositionKey(position);
  if (key.includes("link")) return "L";
  if (key.includes("recht")) return "R";
  return "";
}

function makeSvgNode(tag, attributes = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, value));
  return node;
}

function createPositionIcon(position) {
  const zone = getPositionZone(position);
  const svg = makeSvgNode("svg", {
    viewBox: "0 0 24 24",
    "aria-hidden": "true",
    class: "position-icon-svg",
  });

  const strokeAttrs = {
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.8",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  };

  if (zone === "arm") {
    svg.appendChild(makeSvgNode("path", {
      ...strokeAttrs,
      d: "M9 6.5c1.3-1.8 4.6-1.8 5.8.3.7 1.1.4 2.5-.1 3.7l-1.2 2.6c-.4.9-.3 1.9.3 2.6l.6.8c.6.8.4 2-.4 2.5-.8.5-1.9.3-2.5-.5l-1.1-1.5c-.8-1.1-1-2.5-.5-3.8l1-2.5c.3-.8.4-1.7 0-2.5-.4-.8-1.4-1.1-2-.5L7.8 9.4",
    }));
    return svg;
  }

  if (zone === "belly") {
    svg.appendChild(makeSvgNode("path", {
      ...strokeAttrs,
      d: "M8 7.5c1.2-1.3 2.5-2 4-2s2.8.7 4 2",
    }));
    svg.appendChild(makeSvgNode("path", {
      ...strokeAttrs,
      d: "M7.5 9.5c.5 4.6.9 7 4.5 7s4-2.4 4.5-7",
    }));
    svg.appendChild(makeSvgNode("path", {
      ...strokeAttrs,
      d: "M10 12h4",
    }));
    return svg;
  }

  if (zone === "leg") {
    svg.appendChild(makeSvgNode("path", {
      ...strokeAttrs,
      d: "M10 5.5h4l-1 6.2 1.9 6.8M10.8 11.7 8.6 18.5",
    }));
    return svg;
  }

  svg.appendChild(makeSvgNode("circle", {
    cx: "12",
    cy: "12",
    r: "4.5",
    ...strokeAttrs,
  }));
  return svg;
}

function createPositionChip(position) {
  const chip = document.createElement("span");
  chip.className = `position-chip is-${getPositionZone(position)}`;
  chip.setAttribute("aria-label", position);
  chip.title = position;

  const iconWrap = document.createElement("span");
  iconWrap.className = "position-icon";
  iconWrap.appendChild(createPositionIcon(position));

  const text = document.createElement("span");
  text.className = "position-chip-label";
  text.textContent = position.replace(/^Rechter\s|^Rechtes\s|^Linker\s|^Linkes\s/i, "");

  const side = document.createElement("span");
  side.className = "position-side";
  side.textContent = getPositionSideLabel(position);

  chip.appendChild(iconWrap);
  chip.appendChild(text);
  if (side.textContent) chip.appendChild(side);
  return chip;
}

function isAllowedDeviceCombination(dexPosition, podPosition) {
  if (!dexPosition || !podPosition) return true;
  if (getSide(dexPosition) === getSide(podPosition)) return true;
  return isBellyPosition(dexPosition) && isBellyPosition(podPosition);
}

function findLatestHistoryEntry(deviceKey, predicate, historyEntries = state.history, latestAt = null) {
  const cutoff = latestAt ? parseDate(latestAt) : null;
  return sortHistoryEntries(historyEntries).find((entry) => (
    entry.device === deviceKey
    && predicate(entry)
    && (!cutoff || parseDate(entry.at) <= cutoff)
  )) || null;
}

function getPositionAt(deviceKey, at, historyEntries = state.history) {
  const latest = findLatestHistoryEntry(deviceKey, () => true, historyEntries, at);
  if (latest) return latest.to;
  return state.current?.[deviceKey]?.position || "";
}

function getPairPositions(deviceKey, candidatePosition, at, historyEntries = state.history) {
  const positions = {
    dex: getPositionAt("dex", at, historyEntries),
    pod: getPositionAt("pod", at, historyEntries),
  };

  positions[deviceKey] = candidatePosition;
  return positions;
}

function canSwitchSides(fromPosition, toPosition, jointSwitch = false) {
  if (!fromPosition || !toPosition) return true;
  if (getSide(fromPosition) === getSide(toPosition)) return true;
  if (jointSwitch) return true;
  return isBellyPosition(fromPosition) || isBellyPosition(toPosition);
}

function hoursBetween(from, to) {
  return Math.round((parseDate(to) - parseDate(from)) / 3600000);
}

function normalizeSites(sourceSites, config) {
  const nextSites = {};
  DEVICE_KEYS.forEach((deviceKey) => {
    nextSites[deviceKey] = {};
    config[deviceKey].positions.forEach((position) => {
      const existing = sourceSites?.[deviceKey]?.[position];
      nextSites[deviceKey][position] = {
        paused: Boolean(existing?.paused),
        restDays: Math.max(1, Math.min(30, Number(existing?.restDays) || config[deviceKey].defaultRestDays)),
      };
    });
  });
  return nextSites;
}

function normalizeCurrent(sourceCurrent, config) {
  if (!sourceCurrent) return null;
  const nextCurrent = {};
  DEVICE_KEYS.forEach((deviceKey) => {
    const deviceCurrent = sourceCurrent[deviceKey];
    const firstPosition = config[deviceKey].positions[0];
    nextCurrent[deviceKey] = {
      position: config[deviceKey].positions.includes(deviceCurrent?.position) ? deviceCurrent.position : firstPosition,
      startAt: deviceCurrent?.startAt || `${isoDate(now())}T12:00`,
    };
  });
  return nextCurrent;
}

function migrateState(savedState) {
  const config = normalizeConfig(savedState.config || DEFAULT_CONFIG);
  return {
    config,
    current: normalizeCurrent(savedState.current, config),
    history: Array.isArray(savedState.history) ? savedState.history : [],
    sites: normalizeSites(savedState.sites, config),
    createdAt: savedState.createdAt || new Date().toISOString(),
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return createInitialState();
    return migrateState(JSON.parse(raw));
  } catch (error) {
    return createInitialState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function syncStateWithConfig() {
  state.sites = normalizeSites(state.sites, state.config);
  state.current = normalizeCurrent(state.current, state.config);
}

function latestChangeFor(deviceKey, position) {
  return findLatestHistoryEntry(deviceKey, (entry) => entry.to === position) || null;
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

function getEligiblePositions(
  deviceKey,
  excludePosition,
  targetDate,
  historyEntries = state.history,
  options = {}
) {
  const positions = getDevice(deviceKey).positions;
  const target = parseDate(targetDate);
  const partnerDeviceKey = deviceKey === "dex" ? "pod" : "dex";
  const partnerPosition = options.partnerPosition ?? getPositionAt(partnerDeviceKey, targetDate, historyEntries);
  const jointSwitch = Boolean(options.jointSwitch);

  return positions.filter((position) => {
    if (position === excludePosition) return false;
    const siteState = state.sites[deviceKey][position];
    if (!siteState || siteState.paused) return false;

    if (!canSwitchSides(excludePosition, position, jointSwitch)) return false;

    const pairPositions = {
      dex: deviceKey === "dex" ? position : partnerPosition,
      pod: deviceKey === "pod" ? position : partnerPosition,
    };
    if (!isAllowedDeviceCombination(pairPositions.dex, pairPositions.pod)) return false;

    const latest = findLatestHistoryEntry(deviceKey, (entry) => entry.to === position, historyEntries, targetDate);
    if (!latest) return true;

    const availableAt = addDays(parseDate(latest.at), siteState.restDays);
    return availableAt <= target;
  });
}

function explainBlockedChange(deviceKey, fromPosition, targetDate, historyEntries = state.history) {
  const partnerDeviceKey = deviceKey === "dex" ? "pod" : "dex";
  const partnerPosition = getPositionAt(partnerDeviceKey, targetDate, historyEntries);
  const sameSideOptions = getDevice(deviceKey).positions.filter((position) => (
    position !== fromPosition
    && getSide(position) === getSide(partnerPosition)
  ));

  if (!partnerPosition) {
    return "Keine gueltige Kombination verfuegbar.";
  }

  if (!sameSideOptions.length && !isBellyPosition(partnerPosition)) {
    return "Kombinationsregel blockiert.";
  }

  if (!isBellyPosition(fromPosition) && !sameSideOptions.length) {
    return "Warten auf gemeinsamen Wechsel.";
  }

  return "Erlaubte Stellen noch nicht frei.";
}

function getSide(position) {
  return position.toLowerCase().includes("link") ? "left" : "right";
}

function suggestNextPosition(deviceKey, excludePosition, referenceDate, historyEntries = state.history, currentPositionOverride) {
  const currentPosition = currentPositionOverride || state.current?.[deviceKey]?.position || "";
  const ordered = getDevice(deviceKey).positions.slice();
  const oppositeSideFirst = ordered.sort((a, b) => {
    const aScore = getSide(a) === getSide(currentPosition) ? 1 : 0;
    const bScore = getSide(b) === getSide(currentPosition) ? 1 : 0;
    return aScore - bScore;
  });

  const eligible = getEligiblePositions(deviceKey, excludePosition, referenceDate, historyEntries);
  const preferred = oppositeSideFirst.find((position) => eligible.includes(position));
  if (preferred) return preferred;

  return ordered.find((position) => (
    position !== excludePosition
    && !state.sites[deviceKey][position]?.paused
    && canSwitchSides(excludePosition, position)
    && (() => {
      const partnerDeviceKey = deviceKey === "dex" ? "pod" : "dex";
      const partnerPosition = getPositionAt(partnerDeviceKey, referenceDate, historyEntries);
      const pairPositions = {
        dex: deviceKey === "dex" ? position : partnerPosition,
        pod: deviceKey === "pod" ? position : partnerPosition,
      };
      return isAllowedDeviceCombination(pairPositions.dex, pairPositions.pod);
    })()
  )) || currentPosition;
}

function findSyncOpportunity(blockedDeviceKey, blockedDueAt, simulatedCurrent, simulatedHistory) {
  const partnerDeviceKey = blockedDeviceKey === "dex" ? "pod" : "dex";
  const partnerDevice = getDevice(partnerDeviceKey);
  const partnerDueAt = addDays(parseDate(simulatedCurrent[partnerDeviceKey].startAt), partnerDevice.intervalDays);
  const diffHours = hoursBetween(blockedDueAt, partnerDueAt);

  if (diffHours < 0 || diffHours > SYNC_WINDOW_DAYS * 24) return null;

  const jointAt = partnerDueAt.toISOString();
  const blockedFrom = simulatedCurrent[blockedDeviceKey].position;
  const partnerFrom = simulatedCurrent[partnerDeviceKey].position;
  const blockedEligible = getEligiblePositions(blockedDeviceKey, blockedFrom, jointAt, simulatedHistory, { jointSwitch: true });
  const partnerEligibleBase = getEligiblePositions(partnerDeviceKey, partnerFrom, jointAt, simulatedHistory, { jointSwitch: true });

  if (blockedEligible.length === 0 || partnerEligibleBase.length === 0) return null;

  for (const blockedTo of blockedEligible) {
    const partnerEligible = getEligiblePositions(partnerDeviceKey, partnerFrom, jointAt, simulatedHistory, {
      jointSwitch: true,
      partnerPosition: blockedTo,
    });
    const partnerTo = partnerEligible.find((candidate) => isAllowedDeviceCombination(
      blockedDeviceKey === "dex" ? blockedTo : candidate,
      blockedDeviceKey === "pod" ? blockedTo : candidate
    ));

    if (!partnerTo) continue;

    return {
      at: jointAt,
      partnerDeviceKey,
      blockedFrom,
      partnerFrom,
      blockedTo,
      partnerTo,
    };
  }

  return null;
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
  DEVICE_KEYS.forEach((deviceKey) => {
    const currentEntry = state.current[deviceKey];
    state.history.unshift(
      makeHistoryEntry(deviceKey, currentEntry.position, currentEntry.position, currentEntry.startAt, 3, "Initialer Startwert", [])
    );
  });
  state.history.sort((a, b) => new Date(b.at) - new Date(a.at));
  saveState();
}

function populatePositionSelect(deviceKey, selectId) {
  const select = document.getElementById(selectId);
  select.innerHTML = "";
  getDevice(deviceKey).positions.forEach((position) => {
    const option = document.createElement("option");
    option.value = position;
    option.textContent = position;
    select.appendChild(option);
  });
}

function populateStaticSelects() {
  populatePositionSelect("dex", "dex-pos");
  populatePositionSelect("pod", "pod-pos");
}

function populateChangeDeviceSelect() {
  const select = document.getElementById("change-device");
  const currentValue = select.value;
  select.innerHTML = "";

  getDevices().forEach((device) => {
    const option = document.createElement("option");
    option.value = device.key;
    option.textContent = device.label;
    select.appendChild(option);
  });

  select.value = DEVICE_KEYS.includes(currentValue) ? currentValue : DEVICE_KEYS[0];
}

function updateChangePositionOptions() {
  const deviceKey = document.getElementById("change-device").value;
  const select = document.getElementById("change-position");
  const currentPosition = state.current?.[deviceKey]?.position || "";
  const referenceDate = document.getElementById("change-at").value || now().toISOString();
  const suggestion = suggestNextPosition(deviceKey, currentPosition, referenceDate);

  select.innerHTML = "";
  getDevice(deviceKey).positions.forEach((position) => {
    const option = document.createElement("option");
    const paused = state.sites[deviceKey][position]?.paused;
    const isCurrent = position === currentPosition;
    const invalidTransition = !getEligiblePositions(deviceKey, currentPosition, referenceDate).includes(position);
    option.value = position;
    option.textContent = isCurrent
      ? `${position} (aktuell)`
      : paused
      ? `${position} (pausiert)`
      : invalidTransition
        ? `${position} (gerade nicht moeglich)`
        : position;
    option.disabled = isCurrent || paused || invalidTransition;
    if (position === suggestion) option.selected = true;
    select.appendChild(option);
  });

  updateChangeHint(deviceKey, referenceDate);
}

function updateChangeHint(deviceKey, referenceDate) {
  const hint = document.getElementById("change-hint-copy");
  if (!hint) return;

  const partnerDeviceKey = deviceKey === "dex" ? "pod" : "dex";
  const partnerLabel = getDevice(partnerDeviceKey).label;
  const partnerPosition = getPositionAt(partnerDeviceKey, referenceDate);
  const availablePositions = getEligiblePositions(
    deviceKey,
    state.current?.[deviceKey]?.position || "",
    referenceDate
  );

  if (!partnerPosition) {
    hint.textContent = "Die Kombinationsregel wird aktiv, sobald fuer beide Geraete eine aktuelle Position hinterlegt ist.";
    return;
  }

  if (availablePositions.length === 0) {
    hint.textContent = `${partnerLabel} steht zu diesem Zeitpunkt auf ${partnerPosition}. Gerade ist keine neue, gueltige Stelle verfuegbar.`;
    return;
  }

  hint.textContent = `${partnerLabel} steht zu diesem Zeitpunkt auf ${partnerPosition}. Auswaehlbar bleiben nur neue Stellen, die zur Seitenlogik passen und deren Ruhezeit abgelaufen ist.`;
}

function renderStaticLabels() {
  document.getElementById("hero-eyebrow").textContent = getDevices().map((device) => device.label).join(" + ");
  document.getElementById("dex-setup-label").textContent = getDevice("dex").label;
  document.getElementById("pod-setup-label").textContent = getDevice("pod").label;
  document.getElementById("dex-setup-interval").textContent = `Intervall ${getDevice("dex").intervalDays} Tage`;
  document.getElementById("pod-setup-interval").textContent = `Intervall ${getDevice("pod").intervalDays} Tage`;
  document.getElementById("config-dex-title").textContent = getDevice("dex").label;
  document.getElementById("config-pod-title").textContent = getDevice("pod").label;
}

function renderConfigForm() {
  DEVICE_KEYS.forEach((deviceKey) => {
    const device = getDevice(deviceKey);
    document.getElementById(`config-${deviceKey}-label`).value = device.label;
    document.getElementById(`config-${deviceKey}-interval`).value = device.intervalDays;
    document.getElementById(`config-${deviceKey}-positions`).value = device.positions.join("\n");
  });
}

function renderStatus() {
  const wrapper = document.getElementById("status-grid");
  wrapper.innerHTML = "";

  getDevices().forEach((device) => {
    const currentEntry = state.current?.[device.key];
    if (!currentEntry) return;

    const template = document.getElementById("status-card-template").content.firstElementChild.cloneNode(true);
    template.classList.add(`status-card--${device.colorClass}`);
    template.querySelector(".device-chip").textContent = device.label;
    template.querySelector(".device-chip").classList.add(device.colorClass);
    template.querySelector(".status-position").textContent = currentEntry.position;

    const reminder = reminderText(currentEntry.startAt, device.intervalDays);
    const reminderNode = template.querySelector(".status-reminder");
    reminderNode.textContent = reminder.label;
    reminderNode.classList.add(reminder.tone);

    const latest = findLatestHistoryEntry(device.key, () => true);
    const tags = latest?.tags?.length ? ` · ${latest.tags.join(", ")}` : "";
    template.querySelector(".status-meta").textContent = `Seit ${formatDate(currentEntry.startAt)} · ${reminder.meta}${tags}`;

    wrapper.appendChild(template);
  });
}

function buildSchedule(horizonDays = 60) {
  if (!state.current) return [];

  const items = [];
  const simulatedHistory = sortHistoryEntries(state.history);
  const simulatedCurrent = JSON.parse(JSON.stringify(state.current));
  const counts = Object.fromEntries(DEVICE_KEYS.map((deviceKey) => [deviceKey, 0]));
  const horizon = addDays(startOfToday(), horizonDays);

  while (true) {
    const nextItem = getDevices().reduce((best, device) => {
      if (counts[device.key] >= 14) return best;
      const dueAt = addDays(parseDate(simulatedCurrent[device.key].startAt), device.intervalDays);
      if (dueAt > horizon) return best;
      if (!best || dueAt < best.dueAt) return { deviceKey: device.key, dueAt };
      return best;
    }, null);

    if (!nextItem) break;

    const fromPosition = simulatedCurrent[nextItem.deviceKey].position;
    const dueAtIso = nextItem.dueAt.toISOString();
    const eligible = getEligiblePositions(nextItem.deviceKey, fromPosition, dueAtIso, simulatedHistory);
    const suggestion = suggestNextPosition(nextItem.deviceKey, fromPosition, dueAtIso, simulatedHistory, fromPosition);
    const blockedReason = eligible.length === 0
      ? explainBlockedChange(nextItem.deviceKey, fromPosition, dueAtIso, simulatedHistory)
      : "";

    if (eligible.length === 0) {
      const syncOpportunity = findSyncOpportunity(nextItem.deviceKey, nextItem.dueAt, simulatedCurrent, simulatedHistory);
      if (syncOpportunity) {
        items.push({
          id: `${nextItem.deviceKey}-${counts[nextItem.deviceKey]}-${syncOpportunity.at}`,
          device: nextItem.deviceKey,
          dueAt: parseDate(syncOpportunity.at),
          fromPosition: syncOpportunity.blockedFrom,
          toPosition: syncOpportunity.blockedTo,
          blocked: false,
          syncPlanned: true,
        });

        items.push({
          id: `${syncOpportunity.partnerDeviceKey}-${counts[syncOpportunity.partnerDeviceKey]}-${syncOpportunity.at}`,
          device: syncOpportunity.partnerDeviceKey,
          dueAt: parseDate(syncOpportunity.at),
          fromPosition: syncOpportunity.partnerFrom,
          toPosition: syncOpportunity.partnerTo,
          blocked: false,
          syncPlanned: true,
        });

        simulatedHistory.unshift(
          makeHistoryEntry(nextItem.deviceKey, syncOpportunity.blockedFrom, syncOpportunity.blockedTo, syncOpportunity.at, 0, "Geplanter Synchronwechsel", [])
        );
        simulatedHistory.unshift(
          makeHistoryEntry(syncOpportunity.partnerDeviceKey, syncOpportunity.partnerFrom, syncOpportunity.partnerTo, syncOpportunity.at, 0, "Geplanter Synchronwechsel", [])
        );
        simulatedCurrent[nextItem.deviceKey] = { position: syncOpportunity.blockedTo, startAt: syncOpportunity.at };
        simulatedCurrent[syncOpportunity.partnerDeviceKey] = { position: syncOpportunity.partnerTo, startAt: syncOpportunity.at };
        counts[nextItem.deviceKey] += 1;
        counts[syncOpportunity.partnerDeviceKey] += 1;
        continue;
      }
    }

    items.push({
      id: `${nextItem.deviceKey}-${counts[nextItem.deviceKey]}-${dueAtIso}`,
      device: nextItem.deviceKey,
      dueAt: nextItem.dueAt,
      fromPosition,
      toPosition: suggestion,
      blocked: eligible.length === 0,
      blockedReason,
    });

    simulatedHistory.unshift(
      makeHistoryEntry(nextItem.deviceKey, fromPosition, suggestion, dueAtIso, 0, "Geplanter Wechsel", [])
    );
    simulatedCurrent[nextItem.deviceKey] = { position: suggestion, startAt: dueAtIso };
    counts[nextItem.deviceKey] += 1;
  }

  return items.sort((a, b) => a.dueAt - b.dueAt);
}

function groupScheduleByDay(schedule) {
  const groups = [];
  const byDay = new Map();

  schedule.forEach((item) => {
    const key = isoDate(item.dueAt);
    if (!byDay.has(key)) {
      const group = { key, date: item.dueAt, items: [] };
      byDay.set(key, group);
      groups.push(group);
    }
    byDay.get(key).items.push(item);
  });

  groups.forEach((group) => {
    const sidesFrom = new Set(group.items.map((item) => getSide(item.fromPosition)));
    const sidesTo = new Set(group.items.map((item) => getSide(item.toPosition)));
    const hasBothDevices = new Set(group.items.map((item) => item.device)).size > 1;
    const timestamps = new Set(group.items.map((item) => parseDate(item.dueAt).getTime()));
    const fromSide = sidesFrom.size === 1 ? [...sidesFrom][0] : null;
    const toSide = sidesTo.size === 1 ? [...sidesTo][0] : null;

    group.hasBothDevices = hasBothDevices;
    group.isSharedMoment = timestamps.size === 1;
    group.isSideSwitch = Boolean(hasBothDevices && fromSide && toSide && fromSide !== toSide);
    group.fromSide = fromSide;
    group.toSide = toSide;
  });

  return groups;
}

function makePill(text, className = "") {
  const node = document.createElement("span");
  node.className = `pill ${className}`.trim();
  node.textContent = text;
  return node;
}

function makeCalendarPill(text, className = "", fullLabel = text) {
  const node = makePill(text, `calendar-pill ${className}`.trim());
  node.title = fullLabel;
  node.setAttribute("aria-label", fullLabel);
  return node;
}

function renderTimeline() {
  const wrapper = document.getElementById("timeline");
  const schedule = buildSchedule(45);
  const groupedSchedule = groupScheduleByDay(schedule);
  wrapper.innerHTML = "";

  if (groupedSchedule.length === 0) {
    wrapper.innerHTML = '<div class="empty-state">Sobald aktuelle Werte gesetzt sind, erscheinen hier die naechsten Wechsel.</div>';
    return;
  }

  groupedSchedule.slice(0, 10).forEach((group) => {
    const card = document.createElement("article");
    card.className = `timeline-item${group.isSideSwitch ? " is-side-switch" : ""}${group.hasBothDevices && !group.isSideSwitch ? " is-joint-day" : ""}`;

    const top = document.createElement("div");
    top.className = "timeline-top";

    const title = document.createElement("div");
    title.innerHTML = `<p class="section-kicker">${group.hasBothDevices ? (group.isSharedMoment ? "Gemeinsamer Wechsel" : "Wechsel am selben Tag") : getDevice(group.items[0].device).label}</p><div class="timeline-title">${formatDateTime(group.date)}</div>`;

    const tagWrap = document.createElement("div");
    tagWrap.className = "timeline-tags";
    if (group.isSideSwitch) {
      tagWrap.appendChild(makePill(`Seitenwechsel ${group.fromSide === "left" ? "links" : "rechts"} -> ${group.toSide === "left" ? "links" : "rechts"}`, "is-collision"));
    }

    top.appendChild(title);
    top.appendChild(tagWrap);
    card.appendChild(top);

    group.items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "timeline-entry";

      const label = document.createElement("p");
      label.className = "timeline-meta";
      const line = document.createElement("span");
      line.className = "timeline-line";

      const devicePill = makePill(getDevice(item.device).label, `is-${getDevice(item.device).colorClass}`);
      line.appendChild(devicePill);

      if (item.blocked) {
        const copy = document.createElement("span");
        copy.className = "timeline-copy";
        copy.textContent = "bleibt auf";
        line.appendChild(copy);
        line.appendChild(createPositionChip(item.fromPosition));

        if (item.blockedReason) {
          const reason = document.createElement("span");
          reason.className = "timeline-copy is-muted";
          reason.textContent = item.blockedReason;
          line.appendChild(reason);
        }
      } else {
        const fromCopy = document.createElement("span");
        fromCopy.className = "timeline-copy";
        fromCopy.textContent = "von";
        line.appendChild(fromCopy);
        line.appendChild(createPositionChip(item.fromPosition));

        const arrow = document.createElement("span");
        arrow.className = "timeline-arrow";
        arrow.textContent = "->";
        line.appendChild(arrow);

        line.appendChild(createPositionChip(item.toPosition));

        if (item.syncPlanned) {
          line.appendChild(makePill("Sync", "is-collision"));
        }
      }

      label.appendChild(line);
      row.appendChild(label);
      card.appendChild(row);
    });

    wrapper.appendChild(card);
  });
}

function buildCalendarMonths(offset) {
  const anchor = addMonths(startOfMonth(now()), offset);
  return window.innerWidth <= 860 ? [anchor] : [anchor, addMonths(anchor, 1)];
}

function eventsByDay(schedule, monthDate) {
  const start = startOfMonth(monthDate);
  const end = endOfMonth(monthDate);
  const map = new Map();

  schedule.forEach((item) => {
    if (item.dueAt < start || item.dueAt > end) return;
    const key = isoDate(item.dueAt);
    if (!map.has(key)) map.set(key, { items: [] });
    map.get(key).items.push(item);
  });

  map.forEach((group, key) => {
    const dayGroups = groupScheduleByDay(group.items);
    map.set(key, dayGroups[0]);
  });

  return map;
}

function renderCalendar() {
  const wrapper = document.getElementById("calendar-wrap");
  const schedule = buildSchedule(90);
  const months = buildCalendarMonths(calendarMonthOffset);
  wrapper.innerHTML = "";

  months.forEach((monthDate) => {
    const card = document.createElement("section");
    card.className = "calendar-card";

    const title = document.createElement("div");
    title.className = "calendar-head";
    title.innerHTML = `<h4>${formatMonth(monthDate)}</h4><p class="panel-note">Geplante Wechsel und Kollisionen im Monatsraster.</p>`;
    card.appendChild(title);

    const weekdays = document.createElement("div");
    weekdays.className = "calendar-weekdays";
    ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].forEach((label) => {
      const node = document.createElement("div");
      node.textContent = label;
      weekdays.appendChild(node);
    });
    card.appendChild(weekdays);

    const grid = document.createElement("div");
    grid.className = "calendar-grid";

    const monthStart = startOfMonth(monthDate);
    const monthEnd = endOfMonth(monthDate);
    const offset = (monthStart.getDay() + 6) % 7;
    const firstGridDate = addDays(monthStart, -offset);
    const dayEvents = eventsByDay(schedule, monthDate);

    for (let index = 0; index < 42; index += 1) {
      const currentDate = addDays(firstGridDate, index);
      const dayKey = isoDate(currentDate);
      const dayGroup = dayEvents.get(dayKey);
      const events = dayGroup?.items || [];
      const isOutside = currentDate.getMonth() !== monthDate.getMonth();
      const isToday = dayKey === isoDate(now());

      const cell = document.createElement("article");
      cell.className = `calendar-day${isOutside ? " is-outside" : ""}${isToday ? " is-today" : ""}${dayGroup?.isSideSwitch ? " is-side-switch" : ""}`;

      const dayNumber = document.createElement("div");
      dayNumber.className = "calendar-day-number";
      dayNumber.textContent = String(currentDate.getDate());
      cell.appendChild(dayNumber);

      const eventList = document.createElement("div");
      eventList.className = "calendar-events";
      events.slice(0, 3).forEach((event) => {
        const device = getDevice(event.device);
        const pill = makeCalendarPill(device.key.toUpperCase(), `is-${device.colorClass}`, device.label);
        eventList.appendChild(pill);
      });

      if (events.length > 3) {
        eventList.appendChild(makeCalendarPill(`+${events.length - 3}`, "", `${events.length - 3} weitere Wechsel`));
      }

      if (dayGroup?.isSideSwitch) {
        eventList.appendChild(makeCalendarPill("SW", "is-collision", "Seitenwechsel"));
      } else if (events.length > 1) {
        eventList.appendChild(makeCalendarPill("2x", "is-collision", "Kollision"));
      }

      cell.appendChild(eventList);
      grid.appendChild(cell);
    }

    card.appendChild(grid);
    wrapper.appendChild(card);
  });
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
    title.innerHTML = `<div class="history-title">${getDevice(entry.device).label}: ${entry.to}</div><div class="history-meta">${formatDateTime(entry.at)} · von ${entry.from}</div>`;

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

  getDevices().forEach((device) => {
    const card = document.createElement("article");
    card.className = "setting-card";
    card.innerHTML = `<div class="setting-top"><div><p class="section-kicker">${device.label}</p><h3>Verfuegbare Positionen</h3></div><p class="setting-note">Ruhezeit pro Stelle in Tagen.</p></div>`;

    device.positions.forEach((position) => {
      const row = document.createElement("div");
      row.className = "toggle-row";

      const siteState = state.sites[device.key][position];
      const latest = latestChangeFor(device.key, position);
      const latestText = latest ? `Zuletzt genutzt: ${formatDate(latest.at)}` : "Noch nicht genutzt";

      const label = document.createElement("label");
      label.className = "toggle";
      label.innerHTML = `<input type="checkbox" data-kind="paused" data-device="${device.key}" data-position="${position}" ${siteState.paused ? "checked" : ""}><span>${position} pausieren</span>`;

      const rest = document.createElement("label");
      rest.className = "toggle";
      rest.innerHTML = `<span>Ruhezeit</span><input type="number" min="1" max="30" value="${siteState.restDays}" data-kind="rest" data-device="${device.key}" data-position="${position}" style="width:76px"></label>`;

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
  renderStaticLabels();
  renderConfigForm();
  renderVisibility();
  populateStaticSelects();
  populateChangeDeviceSelect();
  if (!state.current) return;
  renderStatus();
  renderTimeline();
  renderCalendar();
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
      startAt: dexDate,
    },
    pod: {
      position: document.getElementById("pod-pos").value,
      startAt: podDate,
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

  if (toPosition === currentEntry.position) {
    alert("Bitte immer eine neue Stelle waehlen.");
    return;
  }

  const eligible = getEligiblePositions(deviceKey, currentEntry.position, at);
  if (!eligible.includes(toPosition)) {
    alert("Diese Stelle ist mit der aktuellen Seitenlogik oder Ruhezeit gerade nicht moeglich.");
    return;
  }

  const entry = makeHistoryEntry(deviceKey, currentEntry.position, toPosition, at, rating, note, Array.from(selectedTags));
  state.current[deviceKey] = { position: toPosition, startAt: at };
  state.history.unshift(entry);
  state.history = sortHistoryEntries(state.history);
  saveState();

  resetChangeForm();
  renderAll();
}

function parsePositions(value) {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, array) => array.indexOf(item) === index);
}

function handleConfigSubmit(event) {
  event.preventDefault();
  const nextConfig = createDefaultConfig();

  DEVICE_KEYS.forEach((deviceKey) => {
    const label = document.getElementById(`config-${deviceKey}-label`).value.trim();
    const intervalDays = Math.max(1, Math.min(30, Number(document.getElementById(`config-${deviceKey}-interval`).value) || getDevice(deviceKey).intervalDays));
    const positions = parsePositions(document.getElementById(`config-${deviceKey}-positions`).value);

    if (!label || positions.length === 0) {
      throw new Error(`${deviceKey} config invalid`);
    }

    nextConfig[deviceKey] = {
      ...nextConfig[deviceKey],
      label,
      intervalDays,
      positions,
    };
  });

  state.config = nextConfig;
  syncStateWithConfig();
  saveState();
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
    const restDays = Math.max(1, Math.min(30, Number(target.value) || getDevice(deviceKey).defaultRestDays));
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

function escapeCsv(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function exportCsv() {
  const header = ["geraet", "zeitpunkt", "von", "nach", "rating", "tags", "notiz"];
  const rows = state.history.map((entry) => [
    getDevice(entry.device).label,
    formatDateTime(entry.at),
    entry.from,
    entry.to,
    entry.rating,
    (entry.tags || []).join(" | "),
    entry.note || "",
  ]);

  const content = [header, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `cgm-tracker-history-${isoDate(now())}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function resetTracker() {
  const confirmed = confirm("Tracker und Logbuch wirklich zuruecksetzen?");
  if (!confirmed) return;

  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  state = createInitialState();
  seedSetupDefaults();
  renderAll();
}

function seedSetupDefaults() {
  const nowValue = roundToNearestMinutes(now(), 5);
  const todayValue = isoDateTimeLocal(nowValue);
  const minDate = isoDateTimeLocal(addDays(nowValue, -365));

  document.getElementById("dex-date").max = todayValue;
  document.getElementById("pod-date").max = todayValue;
  document.getElementById("dex-date").min = minDate;
  document.getElementById("pod-date").min = minDate;

  document.getElementById("dex-pos").value = getDevice("dex").positions[0];
  document.getElementById("pod-pos").value = getDevice("pod").positions[0];
  document.getElementById("dex-date").value = todayValue;
  document.getElementById("pod-date").value = todayValue;
}

function shiftCalendar(amount) {
  calendarMonthOffset += amount;
  renderCalendar();
}

function attachEvents() {
  document.getElementById("setup-form").addEventListener("submit", handleSetupSubmit);
  document.getElementById("change-form").addEventListener("submit", handleChangeSubmit);
  document.getElementById("config-form").addEventListener("submit", (event) => {
    try {
      handleConfigSubmit(event);
    } catch (error) {
      alert("Bitte fuer beide Geraeteslots Namen und mindestens eine Position angeben.");
    }
  });
  document.getElementById("change-device").addEventListener("change", updateChangePositionOptions);
  document.getElementById("change-at").addEventListener("change", updateChangePositionOptions);
  document.getElementById("tag-group").addEventListener("click", handleTagClicks);
  document.getElementById("settings-grid").addEventListener("change", handleSettingsChange);
  document.getElementById("export-json").addEventListener("click", exportState);
  document.getElementById("export-csv").addEventListener("click", exportCsv);
  document.getElementById("reset-btn").addEventListener("click", resetTracker);
  document.getElementById("calendar-prev").addEventListener("click", () => shiftCalendar(-1));
  document.getElementById("calendar-next").addEventListener("click", () => shiftCalendar(1));
  document.querySelector(".action-menu-panel").addEventListener("click", () => {
    const menu = document.querySelector(".action-menu");
    if (window.innerWidth <= 860) menu.removeAttribute("open");
  });
  window.addEventListener("resize", renderCalendar);
}

let state = loadState();

function init() {
  syncStateWithConfig();
  populateStaticSelects();
  populateChangeDeviceSelect();
  renderStaticLabels();
  renderConfigForm();
  seedSetupDefaults();
  bootstrapHistoryFromCurrent();
  attachEvents();

  if (state.current) {
    primeChangeForm();
  }

  renderAll();
  saveState();
}

init();
