(function () {
  const utils = window.CgmTrackerUtils;
  const store = window.CgmTrackerStore;
  const selectedTags = new Set();
  let calendarMonthOffset = 0;

  function populatePositionSelect(deviceKey, selectId) {
    const select = document.getElementById(selectId);
    select.innerHTML = "";
    store.getDevice(deviceKey).positions.forEach((position) => {
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

    store.getDevices().forEach((device) => {
      const option = document.createElement("option");
      option.value = device.key;
      option.textContent = device.label;
      select.appendChild(option);
    });

    select.value = store.DEVICE_KEYS.includes(currentValue) ? currentValue : store.DEVICE_KEYS[0];
  }

  function updateChangeContext(deviceKey) {
    const copy = document.getElementById("change-context-copy");
    if (!copy) return;

    const device = store.getDevice(deviceKey);
    const currentPosition = store.state.current?.[deviceKey]?.position;

    if (!device || !currentPosition) {
      copy.textContent = "Sobald ein aktueller Wechselstand vorhanden ist, wird die bisherige Stelle hier angezeigt.";
      return;
    }

    copy.textContent = `${device.label} sitzt aktuell auf ${currentPosition}. Die Verträglichkeit bezieht sich auf diese bisherige Stelle, bevor du auf die neue Position wechselst.`;
  }

  function updateChangeHint(deviceKey, referenceDate) {
    const hint = document.getElementById("change-hint-copy");
    if (!hint) return;

    const partnerDeviceKey = deviceKey === "dex" ? "pod" : "dex";
    const partnerLabel = store.getDevice(partnerDeviceKey).label;
    const partnerPosition = store.getPositionAt(partnerDeviceKey, referenceDate);
    const availablePositions = store.getEligiblePositions(
      deviceKey,
      store.state.current?.[deviceKey]?.position || "",
      referenceDate
    );

    if (!partnerPosition) {
      hint.textContent = "Die Kombinationsregel wird aktiv, sobald für beide Geräte eine aktuelle Position hinterlegt ist.";
      return;
    }

    if (availablePositions.length === 0) {
      hint.textContent = `${partnerLabel} steht zu diesem Zeitpunkt auf ${partnerPosition}. Gerade ist keine neue, gültige Stelle verfügbar.`;
      return;
    }

    hint.textContent = `${partnerLabel} steht zu diesem Zeitpunkt auf ${partnerPosition}. Auswählbar bleiben nur neue Stellen, die zur Seitenlogik passen und deren Ruhezeit abgelaufen ist.`;
  }

  function updateChangePositionOptions() {
    const deviceKey = document.getElementById("change-device").value;
    const select = document.getElementById("change-position");
    const currentPosition = store.state.current?.[deviceKey]?.position || "";
    const referenceDate = document.getElementById("change-at").value || utils.isoDateTimeLocal(utils.now());
    const suggestion = store.suggestNextPosition(deviceKey, currentPosition, referenceDate);

    select.innerHTML = "";
    store.getDevice(deviceKey).positions.forEach((position) => {
      const option = document.createElement("option");
      const paused = store.state.sites[deviceKey][position]?.paused;
      const isCurrent = position === currentPosition;
      const invalidTransition = !store.getEligiblePositions(deviceKey, currentPosition, referenceDate).includes(position);
      option.value = position;
      option.textContent = isCurrent
        ? `${position} (aktuell)`
        : paused
          ? `${position} (pausiert)`
          : invalidTransition
            ? `${position} (gerade nicht möglich)`
            : position;
      option.disabled = isCurrent || paused || invalidTransition;
      if (position === suggestion) option.selected = true;
      select.appendChild(option);
    });

    updateChangeContext(deviceKey);
    updateChangeHint(deviceKey, referenceDate);
  }

  function renderStaticLabels() {
    document.getElementById("hero-eyebrow").textContent = store.getDevices().map((device) => device.label).join(" + ");
    document.getElementById("dex-setup-label").textContent = store.getDevice("dex").label;
    document.getElementById("pod-setup-label").textContent = store.getDevice("pod").label;
    document.getElementById("dex-setup-interval").textContent = `Intervall ${store.getDevice("dex").intervalDays} Tage`;
    document.getElementById("pod-setup-interval").textContent = `Intervall ${store.getDevice("pod").intervalDays} Tage`;
    document.getElementById("config-dex-title").textContent = store.getDevice("dex").label;
    document.getElementById("config-pod-title").textContent = store.getDevice("pod").label;
  }

  function renderConfigForm() {
    store.DEVICE_KEYS.forEach((deviceKey) => {
      const device = store.getDevice(deviceKey);
      document.getElementById(`config-${deviceKey}-label`).value = device.label;
      document.getElementById(`config-${deviceKey}-interval`).value = device.intervalDays;
      document.getElementById(`config-${deviceKey}-positions`).value = device.positions.join("\n");
    });
  }

  function renderStatus() {
    const wrapper = document.getElementById("status-grid");
    wrapper.innerHTML = "";

    store.getDevices().forEach((device) => {
      const currentEntry = store.state.current?.[device.key];
      if (!currentEntry) return;

      const template = document.getElementById("status-card-template").content.firstElementChild.cloneNode(true);
      template.classList.add(`status-card--${device.colorClass}`);
      template.querySelector(".device-chip").textContent = device.label;
      template.querySelector(".device-chip").classList.add(device.colorClass);
      template.querySelector(".status-position").textContent = currentEntry.position;

      const reminder = store.reminderText(currentEntry.startAt, device.intervalDays);
      const reminderNode = template.querySelector(".status-reminder");
      reminderNode.textContent = reminder.label;
      reminderNode.classList.add(reminder.tone);

      const latest = store.findLatestHistoryEntry(device.key, () => true);
      const tags = latest?.tags?.length ? ` · ${latest.tags.join(", ")}` : "";
      template.querySelector(".status-meta").textContent = `Seit ${utils.formatDate(currentEntry.startAt)} · ${reminder.meta}${tags}`;

      wrapper.appendChild(template);
    });
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
    const schedule = store.buildSchedule(45);
    const groupedSchedule = store.groupScheduleByDay(schedule);
    wrapper.innerHTML = "";

    if (groupedSchedule.length === 0) {
      wrapper.innerHTML = '<div class="empty-state">Sobald aktuelle Werte gesetzt sind, erscheinen hier die nächsten Wechsel.</div>';
      return;
    }

    groupedSchedule.slice(0, 10).forEach((group) => {
      const card = document.createElement("article");
      card.className = `timeline-item${group.isSideSwitch ? " is-side-switch" : ""}${group.hasBothDevices && !group.isSideSwitch ? " is-joint-day" : ""}`;

      const top = document.createElement("div");
      top.className = "timeline-top";

      const title = document.createElement("div");
      title.innerHTML = `<p class="section-kicker">${group.hasBothDevices ? (group.isSharedMoment ? "Gemeinsamer Wechsel" : "Wechsel am selben Tag") : store.getDevice(group.items[0].device).label}</p><div class="timeline-title">${utils.formatDateTime(group.date)}</div>`;

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

        const devicePill = makePill(store.getDevice(item.device).label, `is-${store.getDevice(item.device).colorClass}`);
        line.appendChild(devicePill);

        if (item.blocked) {
          const copy = document.createElement("span");
          copy.className = "timeline-copy";
          copy.textContent = "bleibt auf";
          line.appendChild(copy);
          line.appendChild(utils.createPositionChip(item.fromPosition));

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
          line.appendChild(utils.createPositionChip(item.fromPosition));

          const arrow = document.createElement("span");
          arrow.className = "timeline-arrow";
          arrow.textContent = "->";
          line.appendChild(arrow);

          line.appendChild(utils.createPositionChip(item.toPosition));

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
    const anchor = utils.addMonths(utils.startOfMonth(utils.now()), offset);
    return window.innerWidth <= 860 ? [anchor] : [anchor, utils.addMonths(anchor, 1)];
  }

  function eventsByDay(schedule, monthDate) {
    const start = utils.startOfMonth(monthDate);
    const nextMonthStart = utils.startOfMonth(utils.addMonths(monthDate, 1));
    const map = new Map();

    schedule.forEach((item) => {
      if (item.dueAt < start || item.dueAt >= nextMonthStart) return;
      const key = utils.isoDate(item.dueAt);
      if (!map.has(key)) map.set(key, { items: [] });
      map.get(key).items.push(item);
    });

    map.forEach((group, key) => {
      const dayGroups = store.groupScheduleByDay(group.items);
      map.set(key, dayGroups[0]);
    });

    return map;
  }

  function renderCalendar() {
    const wrapper = document.getElementById("calendar-wrap");
    const schedule = store.buildSchedule(90);
    const months = buildCalendarMonths(calendarMonthOffset);
    wrapper.innerHTML = "";

    months.forEach((monthDate) => {
      const card = document.createElement("section");
      card.className = "calendar-card";

      const title = document.createElement("div");
      title.className = "calendar-head";
      title.innerHTML = `<h4>${utils.formatMonth(monthDate)}</h4><p class="panel-note">Geplante Wechsel und Kollisionen im Monatsraster.</p>`;
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

      const monthStart = utils.startOfMonth(monthDate);
      const offset = (monthStart.getDay() + 6) % 7;
      const firstGridDate = utils.addDays(monthStart, -offset);
      const dayEvents = eventsByDay(schedule, monthDate);

      for (let index = 0; index < 42; index += 1) {
        const currentDate = utils.addDays(firstGridDate, index);
        const dayKey = utils.isoDate(currentDate);
        const dayGroup = dayEvents.get(dayKey);
        const events = dayGroup?.items || [];
        const isOutside = currentDate.getMonth() !== monthDate.getMonth();
        const isToday = dayKey === utils.isoDate(utils.now());

        const cell = document.createElement("article");
        cell.className = `calendar-day${isOutside ? " is-outside" : ""}${isToday ? " is-today" : ""}${events.length > 1 ? " is-joint-day" : ""}`;

        const dayNumber = document.createElement("div");
        dayNumber.className = "calendar-day-number";
        dayNumber.textContent = String(currentDate.getDate());
        cell.appendChild(dayNumber);

        const eventList = document.createElement("div");
        eventList.className = "calendar-events";
        events.slice(0, 3).forEach((event) => {
          const device = store.getDevice(event.device);
          const pill = makeCalendarPill(device.key.toUpperCase(), `is-${device.colorClass}`, device.label);
          eventList.appendChild(pill);
        });

        if (events.length > 3) {
          eventList.appendChild(makeCalendarPill(`+${events.length - 3}`, "", `${events.length - 3} weitere Wechsel`));
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

    if (store.state.history.length === 0) {
      wrapper.innerHTML = '<div class="empty-state">Noch keine Wechsel gespeichert.</div>';
      return;
    }

    store.state.history.slice(0, 12).forEach((entry) => {
      const item = document.createElement("article");
      item.className = "history-item";

      const top = document.createElement("div");
      top.className = "history-top";

      const title = document.createElement("div");
      title.innerHTML = `<div class="history-title">${store.getDevice(entry.device).label}: ${entry.to}</div><div class="history-meta">${utils.formatDateTime(entry.at)} · von ${entry.from}</div>`;

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

    store.getDevices().forEach((device) => {
      const card = document.createElement("article");
      card.className = "setting-card";
      card.innerHTML = `<div class="setting-top"><div><p class="section-kicker">${device.label}</p><h3>Verfügbare Positionen</h3></div><p class="setting-note">Ruhezeit pro Stelle in Tagen.</p></div>`;

      device.positions.forEach((position) => {
        const row = document.createElement("div");
        row.className = "toggle-row";

        const siteState = store.state.sites[device.key][position];
        const latest = store.latestChangeFor(device.key, position);
        const latestText = latest ? `Zuletzt genutzt: ${utils.formatDate(latest.at)}` : "Noch nicht genutzt";

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
    const hasCurrent = Boolean(store.state.current);
    document.getElementById("setup-panel").hidden = hasCurrent;
    document.getElementById("tracker-panel").hidden = !hasCurrent;
  }

  function renderAll() {
    renderStaticLabels();
    renderConfigForm();
    renderVisibility();
    populateStaticSelects();
    populateChangeDeviceSelect();
    if (!store.state.current) return;
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

    store.state.current = {
      dex: {
        position: document.getElementById("dex-pos").value,
        startAt: dexDate,
      },
      pod: {
        position: document.getElementById("pod-pos").value,
        startAt: podDate,
      },
    };

    store.state.history = [
      store.makeHistoryEntry("dex", store.state.current.dex.position, store.state.current.dex.position, store.state.current.dex.startAt, 3, "Initialer Startwert", []),
      store.makeHistoryEntry("pod", store.state.current.pod.position, store.state.current.pod.position, store.state.current.pod.startAt, 3, "Initialer Startwert", []),
    ].sort((a, b) => new Date(b.at) - new Date(a.at));

    store.saveState();
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
    const currentEntry = store.state.current[deviceKey];

    if (!at || !toPosition) {
      alert("Bitte Wechselzeit und Position auswählen.");
      return;
    }

    const siteState = store.state.sites[deviceKey][toPosition];
    if (siteState.paused) {
      alert("Diese Position ist aktuell pausiert.");
      return;
    }

    if (toPosition === currentEntry.position) {
      alert("Bitte immer eine neue Stelle wählen.");
      return;
    }

    const eligible = store.getEligiblePositions(deviceKey, currentEntry.position, at);
    if (!eligible.includes(toPosition)) {
      alert("Diese Stelle ist mit der aktuellen Seitenlogik oder Ruhezeit gerade nicht möglich.");
      return;
    }

    const entry = store.makeHistoryEntry(deviceKey, currentEntry.position, toPosition, at, rating, note, Array.from(selectedTags));
    store.state.current[deviceKey] = { position: toPosition, startAt: at };
    store.state.history.unshift(entry);
    store.state.history = store.sortHistoryEntries(store.state.history);
    store.saveState();

    resetChangeForm();
    renderAll();
  }

  function applyImportedState(nextState) {
    store.setState(nextState);
    store.syncStateWithConfig();
    seedSetupDefaults();
    if (store.state.current) {
      resetChangeForm();
    }
    renderAll();
    store.saveState();
  }

  function importJsonState(content) {
    const parsed = JSON.parse(content);
    const derivedConfig = Array.isArray(parsed) ? store.buildConfigFromHistoryEntries(parsed) : null;
    const nextState = Array.isArray(parsed)
      ? {
          ...store.createInitialState(),
          config: derivedConfig,
          history: parsed,
          current: store.buildCurrentFromHistory(store.normalizeHistoryEntries(parsed, derivedConfig)),
        }
      : parsed;

    applyImportedState(nextState);
  }

  function importCsvState(content) {
    applyImportedState(store.buildStateFromCsv(content));
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Datei konnte nicht gelesen werden."));
      reader.readAsText(file);
    });
  }

  async function handleImportFileChange(event) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;

    const confirmed = confirm("Import ersetzt den aktuellen Trackerstand auf diesem Gerät. Fortfahren?");
    if (!confirmed) {
      input.value = "";
      return;
    }

    try {
      const content = await readFileAsText(file);
      const name = file.name.toLowerCase();

      if (name.endsWith(".csv")) {
        importCsvState(content);
      } else {
        importJsonState(content);
      }

      alert(`${file.name} wurde importiert.`);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Import fehlgeschlagen.");
    } finally {
      input.value = "";
    }
  }

  function triggerImport() {
    document.getElementById("import-file").click();
  }

  function handleConfigSubmit(event) {
    event.preventDefault();
    const nextConfig = store.createDefaultConfig();

    store.DEVICE_KEYS.forEach((deviceKey) => {
      const label = document.getElementById(`config-${deviceKey}-label`).value.trim();
      const intervalDays = Math.max(1, Math.min(30, Number(document.getElementById(`config-${deviceKey}-interval`).value) || store.getDevice(deviceKey).intervalDays));
      const positions = utils.parsePositions(document.getElementById(`config-${deviceKey}-positions`).value);

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

    store.state.config = nextConfig;
    store.syncStateWithConfig();
    store.saveState();
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
    document.getElementById("change-at").value = utils.isoDateTimeLocal(utils.now());
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
      store.state.sites[deviceKey][position].paused = target.checked;
    }

    if (kind === "rest") {
      const restDays = Math.max(1, Math.min(30, Number(target.value) || store.getDevice(deviceKey).defaultRestDays));
      store.state.sites[deviceKey][position].restDays = restDays;
      target.value = restDays;
    }

    store.saveState();
    renderAll();
  }

  function exportState() {
    const blob = new Blob([JSON.stringify(store.state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `cgm-tracker-backup-${utils.isoDate(utils.now())}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportCsv() {
    const header = ["gerät", "zeitpunkt", "von", "nach", "rating", "tags", "notiz"];
    const rows = store.state.history.map((entry) => [
      store.getDevice(entry.device).label,
      utils.formatDateTime(entry.at),
      entry.from,
      entry.to,
      entry.rating,
      (entry.tags || []).join(" | "),
      entry.note || "",
    ]);

    const content = [header, ...rows].map((row) => row.map(utils.escapeCsv).join(",")).join("\n");
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `cgm-tracker-history-${utils.isoDate(utils.now())}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function resetTracker() {
    const confirmed = confirm("Tracker und Logbuch wirklich zurücksetzen?");
    if (!confirmed) return;

    localStorage.removeItem(store.STORAGE_KEY);
    localStorage.removeItem(store.LEGACY_STORAGE_KEY);
    store.resetState();
    seedSetupDefaults();
    renderAll();
  }

  function seedSetupDefaults() {
    const nowValue = utils.roundToNearestMinutes(utils.now(), 5);
    const todayValue = utils.isoDateTimeLocal(nowValue);
    const minDate = utils.isoDateTimeLocal(utils.addDays(nowValue, -365));

    document.getElementById("dex-date").max = todayValue;
    document.getElementById("pod-date").max = todayValue;
    document.getElementById("dex-date").min = minDate;
    document.getElementById("pod-date").min = minDate;

    document.getElementById("dex-pos").value = store.getDevice("dex").positions[0];
    document.getElementById("pod-pos").value = store.getDevice("pod").positions[0];
    document.getElementById("dex-date").value = todayValue;
    document.getElementById("pod-date").value = todayValue;
  }

  function bootstrapHistoryFromCurrent() {
    if (!store.state.current || store.state.history.length > 0) return;
    store.DEVICE_KEYS.forEach((deviceKey) => {
      const currentEntry = store.state.current[deviceKey];
      store.state.history.unshift(
        store.makeHistoryEntry(deviceKey, currentEntry.position, currentEntry.position, currentEntry.startAt, 3, "Initialer Startwert", [])
      );
    });
    store.state.history.sort((a, b) => new Date(b.at) - new Date(a.at));
    store.saveState();
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
        alert("Bitte für beide Geräteslots Namen und mindestens eine Position angeben.");
      }
    });
    document.getElementById("change-device").addEventListener("change", updateChangePositionOptions);
    document.getElementById("change-at").addEventListener("change", updateChangePositionOptions);
    document.getElementById("tag-group").addEventListener("click", handleTagClicks);
    document.getElementById("settings-grid").addEventListener("change", handleSettingsChange);
    document.getElementById("import-btn").addEventListener("click", triggerImport);
    document.getElementById("import-file").addEventListener("change", handleImportFileChange);
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

  function initApp() {
    store.syncStateWithConfig();
    populateStaticSelects();
    populateChangeDeviceSelect();
    renderStaticLabels();
    renderConfigForm();
    seedSetupDefaults();
    bootstrapHistoryFromCurrent();
    attachEvents();

    if (store.state.current) {
      primeChangeForm();
    }

    renderAll();
    store.saveState();
  }

  window.CgmTrackerUi = {
    initApp,
  };
})();
