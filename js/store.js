(function () {
  const {
    addDays,
    daysBetween,
    formatDateTime,
    getSide,
    isBellyPosition,
    isoDate,
    isoDateTimeLocal,
    now,
    parseCsv,
    parseDate,
    parseImportDate,
    startOfToday,
  } = window.CgmTrackerUtils;

  const STORAGE_KEY = "cgm-tracker-v3";
  const LEGACY_STORAGE_KEY = "cgm-tracker-v2";
  const DEVICE_KEYS = ["dex", "pod"];
  const SYNC_WINDOW_DAYS = 2;

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

  function createDefaultConfig() {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }

  function createSiteStateForDevice(deviceKey, config = store.state?.config || createDefaultConfig()) {
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

  function normalizeHistoryEntry(entry, config, index = 0) {
    const device = DEVICE_KEYS.includes(entry?.device) ? entry.device : null;
    if (!device) return null;

    const at = parseImportDate(entry?.at);
    if (!(at instanceof Date) || Number.isNaN(at.getTime())) return null;

    const positions = config[device].positions;
    const fallbackPosition = positions[0];
    const from = positions.includes(entry?.from) ? entry.from : positions.includes(entry?.to) ? entry.to : fallbackPosition;
    const to = positions.includes(entry?.to) ? entry.to : from;
    const rating = Math.max(0, Math.min(5, Number(entry?.rating) || 0));
    const note = typeof entry?.note === "string" ? entry.note.trim() : "";
    const tags = Array.isArray(entry?.tags)
      ? entry.tags.map((tag) => String(tag).trim()).filter(Boolean)
      : [];

    return {
      id: typeof entry?.id === "string" && entry.id.trim()
        ? entry.id
        : `${device}-import-${at.getTime()}-${index}`,
      device,
      from,
      to,
      at: at.toISOString(),
      rating,
      note,
      tags,
    };
  }

  function normalizeHistoryEntries(historyEntries, config) {
    if (!Array.isArray(historyEntries)) return [];

    return historyEntries
      .map((entry, index) => normalizeHistoryEntry(entry, config, index))
      .filter(Boolean)
      .sort((a, b) => new Date(b.at) - new Date(a.at));
  }

  function sortHistoryEntries(historyEntries = store.state.history) {
    return historyEntries.slice().sort((a, b) => new Date(b.at) - new Date(a.at));
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
      history: normalizeHistoryEntries(savedState.history, config),
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store.state));
    window.CgmTrackerSync?.push(store.state);
  }

  function setState(nextState) {
    store.state = migrateState(nextState);
  }

  function resetState() {
    store.state = createInitialState();
  }

  function syncStateWithConfig() {
    store.state.sites = normalizeSites(store.state.sites, store.state.config);
    store.state.current = normalizeCurrent(store.state.current, store.state.config);
  }

  function getDevice(deviceKey) {
    return store.state.config[deviceKey];
  }

  function getDevices() {
    return DEVICE_KEYS.map((key) => store.state.config[key]);
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
        label: overdueDays <= 1 ? "Heute überfällig" : `${overdueDays} Tage überfällig`,
        tone: "is-danger",
        meta: `Fällig seit ${formatDateTime(dueAt)}`,
      };
    }

    if (diffHours <= 6) {
      return {
        label: `In ${Math.max(diffHours, 1)} Stunden fällig`,
        tone: "is-danger",
        meta: `Spätestens ${formatDateTime(dueAt)}`,
      };
    }

    if (diffDays === 0) {
      return {
        label: "Heute wechseln",
        tone: "is-warning",
        meta: `Fällig um ${formatDateTime(dueAt)}`,
      };
    }

    if (diffDays === 1) {
      return {
        label: "Morgen fällig",
        tone: "is-warning",
        meta: `Fällig am ${formatDateTime(dueAt)}`,
      };
    }

    return {
      label: `Noch ${diffDays} Tage`,
      tone: "is-ok",
      meta: `Fällig am ${formatDateTime(dueAt)}`,
    };
  }

  function isAllowedDeviceCombination(dexPosition, podPosition) {
    if (!dexPosition || !podPosition) return true;
    if (getSide(dexPosition) === getSide(podPosition)) return true;
    return isBellyPosition(dexPosition) && isBellyPosition(podPosition);
  }

  function findLatestHistoryEntry(deviceKey, predicate, historyEntries = store.state.history, latestAt = null) {
    const cutoff = latestAt ? parseDate(latestAt) : null;
    return sortHistoryEntries(historyEntries).find((entry) => (
      entry.device === deviceKey
      && predicate(entry)
      && (!cutoff || parseDate(entry.at) <= cutoff)
    )) || null;
  }

  function getPositionAt(deviceKey, at, historyEntries = store.state.history) {
    const latest = findLatestHistoryEntry(deviceKey, () => true, historyEntries, at);
    if (latest) return latest.to;
    return store.state.current?.[deviceKey]?.position || "";
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

  function getEligiblePositions(
    deviceKey,
    excludePosition,
    targetDate,
    historyEntries = store.state.history,
    options = {}
  ) {
    const positions = getDevice(deviceKey).positions;
    const target = parseDate(targetDate);
    const partnerDeviceKey = deviceKey === "dex" ? "pod" : "dex";
    const partnerPosition = options.partnerPosition ?? getPositionAt(partnerDeviceKey, targetDate, historyEntries);
    const jointSwitch = Boolean(options.jointSwitch);

    return positions.filter((position) => {
      if (position === excludePosition) return false;
      const siteState = store.state.sites[deviceKey][position];
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

  function explainBlockedChange(deviceKey, fromPosition, targetDate, historyEntries = store.state.history) {
    const partnerDeviceKey = deviceKey === "dex" ? "pod" : "dex";
    const partnerPosition = getPositionAt(partnerDeviceKey, targetDate, historyEntries);
    const sameSideOptions = getDevice(deviceKey).positions.filter((position) => (
      position !== fromPosition
      && getSide(position) === getSide(partnerPosition)
    ));

    if (!partnerPosition) {
      return "Keine gültige Kombination verfügbar.";
    }

    if (!sameSideOptions.length && !isBellyPosition(partnerPosition)) {
      return "Kombinationsregel blockiert.";
    }

    if (!isBellyPosition(fromPosition) && !sameSideOptions.length) {
      return "Warten auf gemeinsamen Wechsel.";
    }

    return "Erlaubte Stellen noch nicht frei.";
  }

  function suggestNextPosition(deviceKey, excludePosition, referenceDate, historyEntries = store.state.history, currentPositionOverride) {
    const currentPosition = currentPositionOverride || store.state.current?.[deviceKey]?.position || "";
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
      && !store.state.sites[deviceKey][position]?.paused
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

    const jointAt = isoDateTimeLocal(partnerDueAt);
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

  function recordChange(deviceKey, toPosition, at, rating, note, tags = []) {
    if (!store.state.current?.[deviceKey]) {
      throw new Error("Für dieses Gerät gibt es noch keinen aktuellen Stand.");
    }

    if (!at || !toPosition) {
      throw new Error("Bitte Wechselzeit und Position auswählen.");
    }

    const currentEntry = store.state.current[deviceKey];
    const siteState = store.state.sites[deviceKey]?.[toPosition];
    if (!siteState) {
      throw new Error("Diese Position ist nicht konfiguriert.");
    }

    if (siteState.paused) {
      throw new Error("Diese Position ist aktuell pausiert.");
    }

    if (toPosition === currentEntry.position) {
      throw new Error("Bitte immer eine neue Stelle wählen.");
    }

    const eligible = getEligiblePositions(deviceKey, currentEntry.position, at);
    if (!eligible.includes(toPosition)) {
      throw new Error("Diese Stelle ist mit der aktuellen Seitenlogik oder Ruhezeit gerade nicht möglich.");
    }

    const entry = makeHistoryEntry(
      deviceKey,
      currentEntry.position,
      toPosition,
      at,
      rating,
      note,
      Array.from(tags)
    );

    store.state.current[deviceKey] = { position: toPosition, startAt: at };
    store.state.history.unshift(entry);
    store.state.history = sortHistoryEntries(store.state.history);
    saveState();

    return entry;
  }

  function buildSchedule(horizonDays = 60) {
    if (!store.state.current) return [];

    const items = [];
    const simulatedHistory = sortHistoryEntries(store.state.history);
    const simulatedCurrent = JSON.parse(JSON.stringify(store.state.current));
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
      const dueAtIso = isoDateTimeLocal(nextItem.dueAt);
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

  function mapCsvLabelToDeviceKey(label, labelMap, fallbackOrder) {
    const normalized = String(label || "").trim();
    if (!normalized) return null;
    if (labelMap.has(normalized)) return labelMap.get(normalized);
    const nextKey = fallbackOrder.shift();
    if (!nextKey) return null;
    labelMap.set(normalized, nextKey);
    return nextKey;
  }

  function buildStateFromCsv(content) {
    const rows = parseCsv(content);
    if (rows.length < 2) {
      throw new Error("CSV enthält keine importierbaren Zeilen.");
    }

    const header = rows[0].map((cell) => cell.trim().replace(/^\uFEFF/, "").toLowerCase());
    const headerIndex = {
      device: header.indexOf("gerät"),
      at: header.indexOf("zeitpunkt"),
      from: header.indexOf("von"),
      to: header.indexOf("nach"),
      rating: header.indexOf("rating"),
      tags: header.indexOf("tags"),
      note: header.indexOf("notiz"),
    };

    if (Object.values(headerIndex).some((index) => index === -1)) {
      throw new Error("CSV-Format wird nicht unterstützt.");
    }

    const labelMap = new Map();
    const fallbackOrder = [...DEVICE_KEYS];
    const labelsByKey = {};
    const positionsByKey = {
      dex: new Set(),
      pod: new Set(),
    };

    const history = rows.slice(1).map((cells, index) => {
      const deviceLabel = cells[headerIndex.device];
      const device = mapCsvLabelToDeviceKey(deviceLabel, labelMap, fallbackOrder);
      if (!device) {
        throw new Error("CSV enthält mehr als zwei Gerätegruppen.");
      }

      labelsByKey[device] = labelsByKey[device] || String(deviceLabel || "").trim() || getDevice(device).label;

      const from = String(cells[headerIndex.from] || "").trim();
      const to = String(cells[headerIndex.to] || "").trim();
      if (from) positionsByKey[device].add(from);
      if (to) positionsByKey[device].add(to);
      const parsedAt = parseImportDate(cells[headerIndex.at]);
      if (!(parsedAt instanceof Date) || Number.isNaN(parsedAt.getTime())) {
        throw new Error(`CSV-Zeile ${index + 2} hat einen ungültigen Zeitpunkt.`);
      }

      return {
        id: `${device}-csv-${index}`,
        device,
        from,
        to,
        at: parsedAt.toISOString(),
        rating: Math.max(0, Math.min(5, Number(cells[headerIndex.rating]) || 0)),
        tags: String(cells[headerIndex.tags] || "")
          .split("|")
          .map((tag) => tag.trim())
          .filter(Boolean),
        note: String(cells[headerIndex.note] || "").trim(),
      };
    });

    const nextConfig = createDefaultConfig();
    DEVICE_KEYS.forEach((deviceKey) => {
      const positions = Array.from(positionsByKey[deviceKey]);
      nextConfig[deviceKey] = {
        ...nextConfig[deviceKey],
        label: labelsByKey[deviceKey] || nextConfig[deviceKey].label,
        positions: positions.length ? positions : nextConfig[deviceKey].positions,
      };
    });

    const normalizedHistory = normalizeHistoryEntries(history, nextConfig);
    const current = normalizedHistory.length ? normalizeCurrent(buildCurrentFromHistory(normalizedHistory), nextConfig) : null;

    return {
      config: nextConfig,
      current,
      history: normalizedHistory,
      sites: normalizeSites(undefined, nextConfig),
      createdAt: new Date().toISOString(),
    };
  }

  function buildConfigFromHistoryEntries(historyEntries, baseConfig = createDefaultConfig()) {
    const nextConfig = normalizeConfig(baseConfig);

    DEVICE_KEYS.forEach((deviceKey) => {
      const positions = historyEntries
        .filter((entry) => entry?.device === deviceKey)
        .flatMap((entry) => [entry.from, entry.to])
        .map((position) => String(position || "").trim())
        .filter(Boolean)
        .filter((position, index, array) => array.indexOf(position) === index);

      if (positions.length) {
        nextConfig[deviceKey].positions = positions;
      }
    });

    return nextConfig;
  }

  function buildCurrentFromHistory(historyEntries) {
    const current = {};
    DEVICE_KEYS.forEach((deviceKey) => {
      const latest = historyEntries.find((entry) => entry.device === deviceKey);
      if (latest) {
        current[deviceKey] = {
          position: latest.to,
          startAt: latest.at,
        };
      }
    });
    return Object.keys(current).length ? current : null;
  }

  const store = {
    DEVICE_KEYS,
    STORAGE_KEY,
    LEGACY_STORAGE_KEY,
    state: loadState(),
    buildConfigFromHistoryEntries,
    buildCurrentFromHistory,
    buildSchedule,
    buildStateFromCsv,
    createDefaultConfig,
    createInitialState,
    explainBlockedChange,
    findLatestHistoryEntry,
    getDevice,
    getDevices,
    getEligiblePositions,
    getPositionAt,
    groupScheduleByDay,
    latestChangeFor,
    makeHistoryEntry,
    migrateState,
    normalizeHistoryEntries,
    recordChange,
    reminderText,
    resetState,
    saveState,
    setState,
    sortHistoryEntries,
    suggestNextPosition,
    syncStateWithConfig,
  };

  window.CgmTrackerStore = store;
})();
