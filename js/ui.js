(function () {
  const utils = window.CgmTrackerUtils;
  const store = window.CgmTrackerStore;
  const selectedTags = new Set();
  let calendarMonthOffset = 0;
  let currentChangeView = "map";
  let selectedBodyMapDevice = null;
  let pointerDrag = null;
  let suppressBodyMapClick = false;

  const BODY_MAP_SLOTS = {
    "left-arm": { x: 20, y: 25, label: "Linker Arm" },
    "right-arm": { x: 80, y: 25, label: "Rechter Arm" },
    "left-belly": { x: 38, y: 43, label: "Linker Bauch" },
    "right-belly": { x: 62, y: 43, label: "Rechter Bauch" },
    "left-leg": { x: 42, y: 77, label: "Linkes Bein" },
    "right-leg": { x: 58, y: 77, label: "Rechtes Bein" },
  };

  function inferBodyMapSlot(position) {
    const normalized = utils.normalizePositionKey(position);
    const side = normalized.includes("link") ? "left" : normalized.includes("recht") ? "right" : "";
    const zone = normalized.includes("arm")
      ? "arm"
      : normalized.includes("bauch")
        ? "belly"
        : normalized.includes("bein")
          ? "leg"
          : "";

    if (!side || !zone) return null;
    return `${side}-${zone}`;
  }

  function getBodyMapDeviceEntries() {
    return store.getDevices().map((device) => {
      const current = store.state.current?.[device.key];
      return {
        device,
        current,
        slotKey: current?.position ? inferBodyMapSlot(current.position) : null,
      };
    });
  }

  function getBodyMapState(deviceKey, referenceDate) {
    const currentEntry = store.state.current?.[deviceKey];
    const currentPosition = currentEntry?.position || "";
    const eligible = store.getEligiblePositions(deviceKey, currentPosition, referenceDate);
    const positions = store.getDevice(deviceKey).positions.map((position) => ({
      position,
      slotKey: inferBodyMapSlot(position),
      isCurrent: position === currentPosition,
      isEligible: eligible.includes(position),
      isPaused: Boolean(store.state.sites[deviceKey]?.[position]?.paused),
    }));

    return {
      currentPosition,
      eligible,
      slotted: positions.filter((item) => item.slotKey),
      unslotted: positions.filter((item) => !item.slotKey),
    };
  }

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
    selectedBodyMapDevice = deviceKey;
    const select = document.getElementById("change-position");
    const currentSelectValue = select.value;
    const currentPosition = store.state.current?.[deviceKey]?.position || "";
    const referenceDate = document.getElementById("change-at").value || utils.isoDateTimeLocal(utils.now());
    const eligiblePositions = store.getEligiblePositions(deviceKey, currentPosition, referenceDate);
    const suggestion = store.suggestNextPosition(deviceKey, currentPosition, referenceDate);

    select.innerHTML = "";
    store.getDevice(deviceKey).positions.forEach((position) => {
      const option = document.createElement("option");
      const paused = store.state.sites[deviceKey][position]?.paused;
      const isCurrent = position === currentPosition;
      const invalidTransition = !eligiblePositions.includes(position);
      option.value = position;
      option.textContent = isCurrent
        ? `${position} (aktuell)`
        : paused
          ? `${position} (pausiert)`
          : invalidTransition
            ? `${position} (gerade nicht möglich)`
            : position;
      option.disabled = isCurrent || paused || invalidTransition;
      if (position === currentSelectValue && !option.disabled) option.selected = true;
      select.appendChild(option);
    });

    if (!select.value || select.selectedOptions[0]?.disabled) {
      const fallbackOption = Array.from(select.options).find((option) => option.value === suggestion && !option.disabled)
        || Array.from(select.options).find((option) => !option.disabled);
      if (fallbackOption) fallbackOption.selected = true;
    }

    updateChangeContext(deviceKey);
    updateChangeHint(deviceKey, referenceDate);
    renderBodyMap();
  }

  function buildBodyMapFrame() {
    return `
      <svg class="body-map-figure" viewBox="0 0 320 520" aria-hidden="true">
        <defs>
          <linearGradient id="body-map-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="rgba(255,255,255,0.95)"></stop>
            <stop offset="100%" stop-color="rgba(223,231,226,0.96)"></stop>
          </linearGradient>
        </defs>
        <circle cx="160" cy="42" r="30" class="body-map-silhouette body-map-head"></circle>
        <path class="body-map-silhouette" d="M84 110C62 120 42 162 40 210C38 236 46 262 60 278C66 288 80 292 90 286C100 278 106 264 102 250C96 234 90 210 94 188L98 128Z"></path>
        <path class="body-map-silhouette" d="M236 110C258 120 278 162 280 210C282 236 274 262 260 278C254 288 240 292 230 286C220 278 214 264 218 250C224 234 230 210 226 188L222 128Z"></path>
        <path class="body-map-silhouette" d="M148 72C128 76 102 90 88 108C74 124 72 148 78 172C82 196 98 218 108 234C114 250 110 264 102 276L96 290 90 466C90 482 100 492 114 492L146 492C154 492 158 480 156 466L154 290C154 280 157 276 160 276C163 276 166 280 166 290L164 466C162 480 166 492 174 492L206 492C220 492 230 482 230 466L224 290 218 276C210 264 206 250 212 234C222 218 238 196 242 172C248 148 246 124 232 108C218 90 192 76 172 72Z"></path>
        <path class="body-map-seam" d="M160 90L160 276"></path>
      </svg>
      <div class="body-map-hotspots" id="body-map-hotspots"></div>
    `;
  }

  function renderBodyMapSelection(deviceKey, currentPosition) {
    const wrapper = document.getElementById("body-map-selection");
    const device = store.getDevice(deviceKey);
    const selectedPosition = document.getElementById("change-position").value;
    const hasSelection = Boolean(selectedPosition && selectedPosition !== currentPosition);

    wrapper.replaceChildren();
    const card = document.createElement("div");
    card.className = "body-map-selection-card";

    const chip = document.createElement("span");
    chip.className = `device-chip ${device.colorClass}`;
    chip.textContent = device.label;
    card.appendChild(chip);

    const route = document.createElement("div");
    route.className = "body-map-route";

    const fromStop = document.createElement("div");
    fromStop.className = "body-map-route-stop";
    const fromLabel = document.createElement("span");
    fromLabel.className = "body-map-route-label";
    fromLabel.textContent = "von";
    const fromValue = document.createElement("span");
    fromValue.className = "body-map-route-value";
    fromValue.textContent = currentPosition || "–";
    fromStop.append(fromLabel, fromValue);

    const arrow = document.createElement("span");
    arrow.className = "body-map-route-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "→";

    const toStop = document.createElement("div");
    toStop.className = "body-map-route-stop";
    const toLabel = document.createElement("span");
    toLabel.className = "body-map-route-label";
    toLabel.textContent = "nach";
    const toValue = document.createElement("span");
    toValue.className = `body-map-route-value${hasSelection ? " is-set" : " is-empty"}`;
    toValue.textContent = hasSelection ? selectedPosition : "antippen";
    toStop.append(toLabel, toValue);

    route.append(fromStop, arrow, toStop);
    card.appendChild(route);

    if (hasSelection) {
      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "btn btn-ghost body-map-clear";
      clearBtn.id = "body-map-clear-selection";
      clearBtn.textContent = "Auswahl aufheben";
      card.appendChild(clearBtn);
    }

    wrapper.appendChild(card);
  }

  function renderBodyMapLegend(deviceKey, eligibleCount, unslottedPositions) {
    const legend = document.getElementById("body-map-legend");
    const fallback = document.getElementById("body-map-fallback");
    const fallbackList = document.getElementById("body-map-fallback-list");
    const device = store.getDevice(deviceKey);

    legend.innerHTML = `
      <div class="body-map-legend-item"><span class="body-map-dot is-current"></span><span>Aktuelle Stelle von ${device.label}</span></div>
      <div class="body-map-legend-item"><span class="body-map-dot is-eligible"></span><span>Gerade als Ziel erlaubt</span></div>
      <div class="body-map-legend-item"><span class="body-map-dot is-blocked"></span><span>Durch Pause, Ruhezeit oder Regel gesperrt</span></div>
      <div class="body-map-legend-item"><span class="body-map-dot is-drop"></span><span>${eligibleCount} freie Ziel${eligibleCount === 1 ? "zone" : "zonen"} für diesen Wechsel</span></div>
    `;

    fallbackList.innerHTML = "";
    if (unslottedPositions.length === 0) {
      fallback.hidden = true;
      return;
    }

    fallback.hidden = false;
    unslottedPositions.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tag-btn";
      button.textContent = item.position;
      button.dataset.position = item.position;
      button.disabled = !item.isEligible;
      fallbackList.appendChild(button);
    });
  }

  function renderBodyMap() {
    const canvas = document.getElementById("body-map-canvas");
    if (!canvas || !store.state.current) return;

    const deviceKey = selectedBodyMapDevice || document.getElementById("change-device").value || store.DEVICE_KEYS[0];
    const referenceDate = document.getElementById("change-at").value || utils.isoDateTimeLocal(utils.now());
    const { currentPosition, eligible, slotted, unslotted } = getBodyMapState(deviceKey, referenceDate);
    const hotspotsBySlot = new Map(slotted.map((item) => [item.slotKey, item]));
    const currentSelection = document.getElementById("change-position").value;
    const currentEntries = getBodyMapDeviceEntries();

    canvas.innerHTML = buildBodyMapFrame();
    const hotspots = canvas.querySelector("#body-map-hotspots");

    Object.entries(BODY_MAP_SLOTS).forEach(([slotKey, slot]) => {
      const positionData = hotspotsBySlot.get(slotKey);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "body-map-hotspot";
      button.style.left = `${slot.x}%`;
      button.style.top = `${slot.y}%`;
      button.dataset.slot = slotKey;
      button.dataset.position = positionData?.position || "";

      if (positionData?.isCurrent) button.classList.add("is-current");
      if (positionData?.isEligible) button.classList.add("is-eligible");
      if (positionData && !positionData.isEligible && !positionData.isCurrent) button.classList.add("is-blocked");
      if (positionData?.position === currentSelection) button.classList.add("is-selected");

      button.innerHTML = `
        <span class="body-map-hotspot-ring"></span>
        <span class="body-map-hotspot-label">${positionData?.position || slot.label}</span>
        <span class="body-map-hotspot-meta">${positionData ? (positionData.isCurrent ? "aktuell" : positionData.isEligible ? "frei" : positionData.isPaused ? "pausiert" : "gesperrt") : "nicht konfiguriert"}</span>
      `;

      hotspots.appendChild(button);
    });

    currentEntries.forEach(({ device, current, slotKey }) => {
      if (!current || !slotKey) return;
      const host = hotspots.querySelector(`[data-slot="${slotKey}"]`);
      if (!host) return;

      const marker = document.createElement("span");
      marker.className = `body-map-marker is-${device.colorClass}${device.key === deviceKey ? " is-active" : ""}`;
      marker.draggable = true;
      marker.dataset.device = device.key;
      marker.tabIndex = 0;
      marker.setAttribute("role", "button");
      marker.setAttribute("aria-label", `${device.label} liegt aktuell auf ${current.position}`);
      marker.innerHTML = `<span class="body-map-marker-chip">${device.label}</span>`;
      host.appendChild(marker);
    });

    renderBodyMapSelection(deviceKey, currentPosition);
    renderBodyMapLegend(deviceKey, eligible.length, unslotted);

    const instruction = document.getElementById("body-map-instruction");
    instruction.textContent = eligible.length
      ? "Freie Zone antippen oder Marker ziehen."
      : "Für den gewählten Zeitpunkt ist gerade keine neue gültige Körperstelle frei.";
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
    syncChangeViewButtons();
    if (!store.state.current) return;
    renderStatus();
    renderTimeline();
    renderCalendar();
    renderHistory();
    renderSettings();
    updateChangePositionOptions();
  }

  function syncChangeViewButtons() {
    const formButton = document.getElementById("change-mode-form");
    const mapButton = document.getElementById("change-mode-map");
    const isMap = currentChangeView === "map";

    formButton.classList.toggle("btn-secondary", !isMap);
    formButton.classList.toggle("btn-ghost", isMap);
    formButton.classList.toggle("is-active", !isMap);
    formButton.setAttribute("aria-pressed", String(!isMap));

    mapButton.classList.toggle("btn-secondary", isMap);
    mapButton.classList.toggle("btn-ghost", !isMap);
    mapButton.classList.toggle("is-active", isMap);
    mapButton.setAttribute("aria-pressed", String(isMap));

    document.getElementById("change-form-view").hidden = isMap;
    document.getElementById("change-map-view").hidden = !isMap;
  }

  function setChangeView(nextView) {
    currentChangeView = nextView === "map" ? "map" : "form";
    syncChangeViewButtons();
    if (currentChangeView === "map") {
      selectedBodyMapDevice = document.getElementById("change-device").value;
      renderBodyMap();
    }
  }

  function applyChange(deviceKey, toPosition, at, rating, note) {
    store.recordChange(deviceKey, toPosition, at, rating, note, Array.from(selectedTags));
    resetChangeForm();
    renderAll();
  }

  function handleChangeViewToggle(event) {
    const button = event.target.closest("[data-change-view]");
    if (!button) return;
    setChangeView(button.dataset.changeView);
  }

  function handleBodyMapDeviceSelection(deviceKey) {
    selectedBodyMapDevice = deviceKey;
    document.getElementById("change-device").value = deviceKey;
    updateChangePositionOptions();
    renderBodyMap();
  }

  function handleBodyMapTargetSelection(position) {
    const deviceKey = selectedBodyMapDevice || document.getElementById("change-device").value;
    const currentPosition = store.state.current?.[deviceKey]?.position || "";
    const eligible = store.getEligiblePositions(deviceKey, currentPosition, document.getElementById("change-at").value);
    if (!eligible.includes(position)) return;

    document.getElementById("change-device").value = deviceKey;
    document.getElementById("change-position").value = position;
    updateChangePositionOptions();
    renderBodyMap();
  }

  function clearDropTargets() {
    document.querySelectorAll(".body-map-hotspot.is-drop-target").forEach((node) => {
      node.classList.remove("is-drop-target");
    });
  }

  function getEligibleHotspotAtPoint(clientX, clientY) {
    const target = document.elementFromPoint(clientX, clientY);
    const hotspot = target?.closest(".body-map-hotspot");
    if (!hotspot?.dataset.position) return null;

    const deviceKey = pointerDrag?.deviceKey || selectedBodyMapDevice || document.getElementById("change-device").value;
    const currentPosition = store.state.current?.[deviceKey]?.position || "";
    const eligible = store.getEligiblePositions(deviceKey, currentPosition, document.getElementById("change-at").value);
    if (!eligible.includes(hotspot.dataset.position)) return null;
    return hotspot;
  }

  function updatePointerGhostPosition(clientX, clientY) {
    if (!pointerDrag?.ghost) return;
    pointerDrag.ghost.style.left = `${clientX}px`;
    pointerDrag.ghost.style.top = `${clientY}px`;
  }

  function startPointerDrag(event, marker) {
    if (event.pointerType === "mouse" && event.button !== 0) return;

    const ghost = document.createElement("div");
    ghost.className = "body-map-drag-ghost";
    ghost.innerHTML = marker.innerHTML;
    document.body.appendChild(ghost);

    pointerDrag = {
      pointerId: event.pointerId,
      marker,
      ghost,
      deviceKey: marker.dataset.device,
      hoverHotspot: null,
    };

    selectedBodyMapDevice = marker.dataset.device;
    document.getElementById("change-device").value = marker.dataset.device;
    marker.classList.add("is-dragging");
    updateChangePositionOptions();
    updatePointerGhostPosition(event.clientX, event.clientY);
    if (marker.setPointerCapture) marker.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function finishPointerDrag(clientX, clientY) {
    if (!pointerDrag) return;

    const { marker, ghost, deviceKey } = pointerDrag;
    const hotspot = getEligibleHotspotAtPoint(clientX, clientY);

    marker.classList.remove("is-dragging");
    ghost.remove();
    clearDropTargets();
    pointerDrag = null;
    suppressBodyMapClick = true;
    window.setTimeout(() => {
      suppressBodyMapClick = false;
    }, 120);

    if (!hotspot?.dataset.position) return;

    handleBodyMapDeviceSelection(deviceKey);
    handleBodyMapTargetSelection(hotspot.dataset.position);
  }

  function handleBodyMapClick(event) {
    if (suppressBodyMapClick) return;

    const clearButton = event.target.closest("#body-map-clear-selection");
    if (clearButton) {
      const deviceKey = selectedBodyMapDevice || document.getElementById("change-device").value;
      document.getElementById("change-position").value = store.suggestNextPosition(
        deviceKey,
        store.state.current?.[deviceKey]?.position || "",
        document.getElementById("change-at").value
      );
      renderBodyMap();
      return;
    }

    // Any click inside a hotspot (including on a marker chip) selects that zone.
    // Ineligible zones are silently ignored — the visual state already communicates why.
    const hotspot = event.target.closest(".body-map-hotspot");
    if (hotspot?.dataset.position) {
      handleBodyMapTargetSelection(hotspot.dataset.position);
      return;
    }

    const fallbackButton = event.target.closest("#body-map-fallback-list .tag-btn");
    if (fallbackButton?.dataset.position) {
      handleBodyMapTargetSelection(fallbackButton.dataset.position);
    }
  }

  function handleBodyMapKeydown(event) {
    if (event.key !== "Enter" && event.key !== " ") return;

    const marker = event.target.closest(".body-map-marker");
    if (!marker) return;

    event.preventDefault();
    handleBodyMapDeviceSelection(marker.dataset.device);
  }

  function handleBodyMapPointerDown(event) {
    const marker = event.target.closest(".body-map-marker");
    if (!marker) return;
    startPointerDrag(event, marker);
  }

  function handleBodyMapPointerMove(event) {
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;

    updatePointerGhostPosition(event.clientX, event.clientY);
    const hotspot = getEligibleHotspotAtPoint(event.clientX, event.clientY);
    if (hotspot === pointerDrag.hoverHotspot) return;

    clearDropTargets();
    pointerDrag.hoverHotspot = hotspot;
    if (hotspot) hotspot.classList.add("is-drop-target");
  }

  function handleBodyMapPointerUp(event) {
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
    finishPointerDrag(event.clientX, event.clientY);
  }

  function handleBodyMapPointerCancel(event) {
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
    finishPointerDrag(-1, -1);
  }

  function handleBodyMapDragStart(event) {
    const marker = event.target.closest(".body-map-marker");
    if (!marker) return;
    selectedBodyMapDevice = marker.dataset.device;
    document.getElementById("change-device").value = marker.dataset.device;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", marker.dataset.device);
    updateChangePositionOptions();
  }

  function handleBodyMapDragOver(event) {
    const hotspot = event.target.closest(".body-map-hotspot");
    if (!hotspot?.dataset.position) return;

    const deviceKey = selectedBodyMapDevice || event.dataTransfer.getData("text/plain") || document.getElementById("change-device").value;
    const currentPosition = store.state.current?.[deviceKey]?.position || "";
    const eligible = store.getEligiblePositions(deviceKey, currentPosition, document.getElementById("change-at").value);
    if (!eligible.includes(hotspot.dataset.position)) return;

    event.preventDefault();
    hotspot.classList.add("is-drop-target");
  }

  function handleBodyMapDragLeave(event) {
    const hotspot = event.target.closest(".body-map-hotspot");
    if (!hotspot) return;
    hotspot.classList.remove("is-drop-target");
  }

  function handleBodyMapDrop(event) {
    const hotspot = event.target.closest(".body-map-hotspot");
    if (!hotspot?.dataset.position) return;
    const deviceKey = event.dataTransfer.getData("text/plain") || selectedBodyMapDevice || document.getElementById("change-device").value;
    hotspot.classList.remove("is-drop-target");
    handleBodyMapTargetSelection(hotspot.dataset.position);
    handleBodyMapDeviceSelection(deviceKey);
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
    try {
      applyChange(deviceKey, toPosition, at, rating, note);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Wechsel konnte nicht gespeichert werden.");
    }
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
    selectedBodyMapDevice = document.getElementById("change-device").value || store.DEVICE_KEYS[0];
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
    document.querySelector(".change-mode-toggle").addEventListener("click", handleChangeViewToggle);
    document.getElementById("change-device").addEventListener("change", updateChangePositionOptions);
    document.getElementById("change-at").addEventListener("change", updateChangePositionOptions);
    document.getElementById("tag-group").addEventListener("click", handleTagClicks);
    document.getElementById("change-map-view").addEventListener("click", handleBodyMapClick);
    document.getElementById("change-map-view").addEventListener("keydown", handleBodyMapKeydown);
    document.getElementById("change-map-view").addEventListener("pointerdown", handleBodyMapPointerDown);
    window.addEventListener("pointermove", handleBodyMapPointerMove);
    window.addEventListener("pointerup", handleBodyMapPointerUp);
    window.addEventListener("pointercancel", handleBodyMapPointerCancel);
    document.getElementById("change-map-view").addEventListener("dragstart", handleBodyMapDragStart);
    document.getElementById("change-map-view").addEventListener("dragover", handleBodyMapDragOver);
    document.getElementById("change-map-view").addEventListener("dragleave", handleBodyMapDragLeave);
    document.getElementById("change-map-view").addEventListener("drop", handleBodyMapDrop);
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
