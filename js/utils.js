(function () {
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

  function isValidDate(value) {
    return value instanceof Date && !Number.isNaN(value.getTime());
  }

  function isoDate(value) {
    const d = new Date(value);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
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

  function getSide(position) {
    return position.toLowerCase().includes("link") ? "left" : "right";
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

  function parsePositions(value) {
    return value
      .split(/\n|,/)
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item, index, array) => array.indexOf(item) === index);
  }

  function parseImportDate(value) {
    if (value instanceof Date) return value;

    const text = String(value || "").trim();
    if (!text) return new Date(NaN);

    const isoCandidate = new Date(text);
    if (isValidDate(isoCandidate)) return isoCandidate;

    const localMatch = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:,\s*|\s+)?(\d{1,2}):(\d{2})$/);
    if (localMatch) {
      const [, day, month, year, hour, minute] = localMatch;
      return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
    }

    const dateOnlyMatch = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (dateOnlyMatch) {
      const [, day, month, year] = dateOnlyMatch;
      return new Date(Number(year), Number(month) - 1, Number(day), 12, 0);
    }

    return new Date(NaN);
  }

  function parseCsv(content) {
    const rows = [];
    let current = "";
    let row = [];
    let inQuotes = false;

    for (let index = 0; index < content.length; index += 1) {
      const char = content[index];
      const nextChar = content[index + 1];

      if (char === "\"") {
        if (inQuotes && nextChar === "\"") {
          current += "\"";
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (char === "," && !inQuotes) {
        row.push(current);
        current = "";
        continue;
      }

      if ((char === "\n" || char === "\r") && !inQuotes) {
        if (char === "\r" && nextChar === "\n") index += 1;
        row.push(current);
        if (row.some((cell) => cell.trim() !== "")) rows.push(row);
        row = [];
        current = "";
        continue;
      }

      current += char;
    }

    if (current || row.length) {
      row.push(current);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
    }

    return rows;
  }

  function escapeCsv(value) {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, "\"\"")}"`;
    }
    return text;
  }

  window.CgmTrackerUtils = {
    addDays,
    addMonths,
    createPositionChip,
    daysBetween,
    endOfMonth,
    escapeCsv,
    formatDate,
    formatDateTime,
    formatMonth,
    getSide,
    getPositionZone,
    getPositionSideLabel,
    isBellyPosition,
    isValidDate,
    isoDate,
    isoDateTimeLocal,
    normalizePositionKey,
    now,
    parseCsv,
    parseDate,
    parseImportDate,
    parsePositions,
    roundToNearestMinutes,
    startOfMonth,
    startOfToday,
  };
})();
