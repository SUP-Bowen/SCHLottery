const STORAGE_KEY = "sgh_lottery_config_v4";
const STORAGE_STATS = "sgh_lottery_stats_v1";
const MAX_PRIZES = 32;

const $ = (sel) => document.querySelector(sel);

const trackEl = $("#track");
const slotsEl = $("#slots");

const particlesCanvas = $("#particles");
const particlesCtx = particlesCanvas.getContext("2d", { alpha: true });

const confettiCanvas = $("#confetti");
const confettiCtx = confettiCanvas.getContext("2d", { alpha: true });

const btnSpin = $("#btnSpin");
const btnSettings = $("#btnSettings");
const btnFullscreen = $("#btnFullscreen");
const settingsDialog = $("#settingsDialog");
const importDialog = $("#importDialog");

const toggleSound = $("#toggleSound");
const toggleConfetti = $("#toggleConfetti");
const toggleRemoveWinner = $("#toggleRemoveWinner");

const historyEl = $("#history");
const historyCount = $("#historyCount");

const resultText = $("#resultText");
const winnerBox = document.querySelector(".winner");
const toastEl = $("#toast");

const itemsEl = $("#items");
const itemsHint = $("#itemsHint");
const btnAddItem = $("#btnAddItem");
const btnSaveSettings = $("#btnSaveSettings");
const btnImport = $("#btnImport");
const btnExport = $("#btnExport");
const importText = $("#importText");
const btnDoImport = $("#btnDoImport");
const btnResetStats = $("#btnResetStats");

const DEFAULT_CONFIG = {
  sound: false,
  confetti: true,
  removeWinner: false,
  items: [
    { label: "一等奖", weight: 1 },
    { label: "二等奖", weight: 1 },
    { label: "三等奖", weight: 1 },
    { label: "再接再厉", weight: 2 },
    { label: "幸运加成", weight: 1 },
    { label: "神秘奖励", weight: 1 },
  ],
};

let config = loadConfig();
let stats = loadStats();

let slotEls = [];
let slotCount = 0;
let prizeCount = 0;
let activeSlotIndex = 0;
let isSpinning = false;
let spinRaf = 0;

// --- Utils
function clamp(n, a, b) {
  return Math.min(b, Math.max(a, n));
}

function nowIsoLocal() {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}:${pad(d.getSeconds())}`;
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  window.clearTimeout(toast._t);
  toast._t = window.setTimeout(() => toastEl.classList.remove("show"), 1400);
}

function safeJsonParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e };
  }
}

function cryptoRandom() {
  const u = new Uint32Array(1);
  crypto.getRandomValues(u);
  return u[0] / 2 ** 32;
}

function normalizeItems(items) {
  return items
    .map((it) => ({ label: String(it?.label ?? "").trim(), weight: Number(it?.weight ?? 1) }))
    .filter((it) => it.label.length > 0)
    .map((it) => ({ ...it, weight: Number.isFinite(it.weight) && it.weight > 0 ? it.weight : 1 }));
}

function weightedPickIndex(items) {
  const total = items.reduce((s, it) => s + it.weight, 0);
  let r = cryptoRandom() * total;
  for (let i = 0; i < items.length; i++) {
    r -= items[i].weight;
    if (r <= 0) return i;
  }
  return Math.max(0, items.length - 1);
}

function loadConfig() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return structuredClone(DEFAULT_CONFIG);
  const parsed = safeJsonParse(raw);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") return structuredClone(DEFAULT_CONFIG);
  const v = parsed.value;
  return {
    sound: Boolean(v.sound),
    confetti: v.confetti !== false,
    removeWinner: Boolean(v.removeWinner),
    items: normalizeItems(Array.isArray(v.items) ? v.items : DEFAULT_CONFIG.items).slice(0, MAX_PRIZES),
  };
}

function saveConfig() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

function loadStats() {
  const raw = localStorage.getItem(STORAGE_STATS);
  if (!raw) return { spins: 0, history: [] };
  const parsed = safeJsonParse(raw);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") return { spins: 0, history: [] };
  const v = parsed.value;
  return {
    spins: Number.isFinite(Number(v.spins)) ? Number(v.spins) : 0,
    history: Array.isArray(v.history) ? v.history.slice(0, 200) : [],
  };
}

function saveStats() {
  localStorage.setItem(STORAGE_STATS, JSON.stringify(stats));
}

function setResult(label) {
  resultText.textContent = label || "—";
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// --- Sound (WebAudio)
let audioCtx = null;
function ensureAudio() {
  if (audioCtx) return audioCtx;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function beep({ freq = 420, time = 0.045, type = "square", gain = 0.02 } = {}) {
  if (!config.sound) return;
  const ctx = ensureAudio();
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.value = gain;
  o.connect(g);
  g.connect(ctx.destination);
  const t0 = ctx.currentTime;
  o.start(t0);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + time);
  o.stop(t0 + time + 0.01);
}

function winChime() {
  if (!config.sound) return;
  const base = 392;
  [0, 4, 7, 12].forEach((step, i) =>
    setTimeout(() => beep({ freq: base * 2 ** (step / 12), time: 0.11, type: "triangle", gain: 0.05 }), i * 92),
  );
}

// --- Aligned perimeter grid marquee
function perimeter(cols, rows) {
  return cols < 2 || rows < 2 ? 0 : 2 * (cols + rows) - 4;
}

function perimeterCoords(cols, rows) {
  const coords = [];
  for (let x = 1; x <= cols; x++) coords.push({ x, y: 1 });
  for (let y = 2; y <= rows - 1; y++) coords.push({ x: cols, y });
  for (let x = cols; x >= 1; x--) coords.push({ x, y: rows });
  for (let y = rows - 1; y >= 2; y--) coords.push({ x: 1, y });
  return coords;
}

function chooseGridFor(count) {
  const rect = trackEl.getBoundingClientRect();
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  const presets = [
    { cols: 4, rows: 4 }, // 12
    { cols: 5, rows: 4 }, // 14
    { cols: 6, rows: 5 }, // 18
    { cols: 7, rows: 5 }, // 20
    { cols: 7, rows: 6 }, // 22
    { cols: 8, rows: 6 }, // 24
    { cols: 9, rows: 6 }, // 26
    { cols: 9, rows: 7 }, // 28
    { cols: 10, rows: 7 }, // 30
    { cols: 10, rows: 8 }, // 32
  ].map((g) => ({ ...g, slots: perimeter(g.cols, g.rows) }));

  const need = clamp(count, 2, MAX_PRIZES);
  const candidates = presets.filter((p) => p.slots >= need);
  if (candidates.length === 0) return presets[presets.length - 1];

  // Prefer larger cell size on small screens (avoid tiny unreadable slots).
  let best = candidates[0];
  let bestScore = -Infinity;
  for (const p of candidates) {
    const cellW = (w - 28) / p.cols;
    const cellH = (h - 28) / p.rows;
    const minCell = Math.min(cellW, cellH);
    const slack = p.slots - need;
    const score = minCell * 10 - slack * 2; // prioritize readability, then fewer ghost slots
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

function renderTrack() {
  const items = normalizeItems(config.items).slice(0, MAX_PRIZES);
  prizeCount = items.length;

  const grid = chooseGridFor(prizeCount);
  const coords = perimeterCoords(grid.cols, grid.rows);

  trackEl.style.setProperty("--cols", String(grid.cols));
  trackEl.style.setProperty("--rows", String(grid.rows));

  slotsEl.innerHTML = "";
  slotEls = [];
  slotCount = coords.length;

  for (let i = 0; i < slotCount; i++) {
    const slot = document.createElement("div");
    slot.className = "slot";
    slot.style.gridColumn = String(coords[i].x);
    slot.style.gridRow = String(coords[i].y);
    slot.setAttribute("role", "listitem");
    slot.dataset.slot = String(i);
    if (i < prizeCount) {
      slot.dataset.idx = String(i);
      slot.title = items[i].label;
      const label = document.createElement("div");
      label.className = "slot__label";
      label.textContent = items[i].label;
      slot.append(label);
    } else {
      slot.classList.add("slot--ghost");
      slot.setAttribute("aria-hidden", "true");
    }
    slotsEl.append(slot);
    slotEls.push(slot);
  }

  activeSlotIndex = clamp(activeSlotIndex, 0, Math.max(0, slotCount - 1));
  setActiveSlot(activeSlotIndex, { winner: false });
}

function setActiveSlot(idx, { winner } = { winner: false }) {
  const n = slotEls.length;
  if (n === 0) return;
  const next = ((idx % n) + n) % n;
  for (let i = 0; i < n; i++) {
    const el = slotEls[i];
    el.classList.toggle("is-active", i === next);
    el.classList.toggle("is-winner", winner && i === next);
  }
  activeSlotIndex = next;
}

function clearWinnerClasses() {
  for (const el of slotEls) el.classList.remove("is-winner");
}

function flashWinner(idx) {
  if (!slotEls.length) return;
  const target = ((idx % slotEls.length) + slotEls.length) % slotEls.length;
  clearWinnerClasses();
  // Flash twice: ON -> OFF -> ON (hold)
  slotEls[target].classList.add("is-winner");
  window.setTimeout(() => slotEls[target].classList.remove("is-winner"), 140);
  window.setTimeout(() => slotEls[target].classList.add("is-winner"), 280);
}

// --- Confetti
let confetti = [];
let confettiRaf = 0;
function resizeFullCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  return dpr;
}

function burstConfetti() {
  if (!config.confetti) return;
  const dpr = resizeFullCanvas(confettiCanvas);
  const w = confettiCanvas.width;
  const h = confettiCanvas.height;
  const colors = ["#FFCC00", "#2B6FFF", "#FF2B2B", "#31D6FF", "#F6F8FF"];
  confetti = new Array(160).fill(0).map(() => {
    const a = cryptoRandom() * Math.PI * 2;
    const s = (2.4 + cryptoRandom() * 6.4) * dpr;
    return {
      x: w * 0.5,
      y: h * 0.30,
      vx: Math.cos(a) * s * (0.85 + cryptoRandom() * 0.55),
      vy: Math.sin(a) * s * (0.55 + cryptoRandom() * 0.7),
      g: (0.055 + cryptoRandom() * 0.085) * dpr,
      r: (2 + cryptoRandom() * 4.6) * dpr,
      rot: cryptoRandom() * Math.PI,
      vr: (cryptoRandom() - 0.5) * 0.34,
      life: 135 + Math.floor(cryptoRandom() * 80),
      c: colors[Math.floor(cryptoRandom() * colors.length)],
    };
  });
  cancelAnimationFrame(confettiRaf);
  confettiRaf = requestAnimationFrame(tickConfetti);
}

function tickConfetti() {
  const w = confettiCanvas.width;
  const h = confettiCanvas.height;
  confettiCtx.clearRect(0, 0, w, h);

  let alive = 0;
  for (const f of confetti) {
    if (f.life <= 0) continue;
    alive++;
    f.life--;
    f.vy += f.g;
    f.x += f.vx;
    f.y += f.vy;
    f.rot += f.vr;
    f.vx *= 0.995;
    const alpha = clamp(f.life / 200, 0, 1);
    confettiCtx.save();
    confettiCtx.translate(f.x, f.y);
    confettiCtx.rotate(f.rot);
    confettiCtx.fillStyle = `${f.c}${Math.floor(alpha * 255)
      .toString(16)
      .padStart(2, "0")}`;
    confettiCtx.fillRect(-f.r, -f.r * 0.35, f.r * 2, f.r * 0.7);
    confettiCtx.restore();
  }
  if (alive > 0) confettiRaf = requestAnimationFrame(tickConfetti);
  else confettiCtx.clearRect(0, 0, w, h);
}

// --- Particles background
let particles = [];
function initParticles() {
  const dpr = resizeFullCanvas(particlesCanvas);
  particles = new Array(110).fill(0).map(() => ({
    x: cryptoRandom() * particlesCanvas.width,
    y: cryptoRandom() * particlesCanvas.height,
    vx: (cryptoRandom() - 0.5) * 0.16 * dpr,
    vy: (cryptoRandom() - 0.5) * 0.16 * dpr,
    r: (1 + cryptoRandom() * 2.0) * dpr,
    a: 0.10 + cryptoRandom() * 0.18,
  }));
}

function tickParticles() {
  const w = particlesCanvas.width;
  const h = particlesCanvas.height;
  particlesCtx.clearRect(0, 0, w, h);

  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < -30) p.x = w + 30;
    if (p.x > w + 30) p.x = -30;
    if (p.y < -30) p.y = h + 30;
    if (p.y > h + 30) p.y = -30;

    particlesCtx.beginPath();
    particlesCtx.fillStyle = `rgba(255,255,255,${p.a})`;
    particlesCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    particlesCtx.fill();
  }
  requestAnimationFrame(tickParticles);
}

// --- History
function renderHistory() {
  historyEl.innerHTML = "";
  const list = stats.history.slice().reverse();
  for (const h of list) {
    const li = document.createElement("li");
    const top = document.createElement("div");
    top.className = "history__top";
    const label = document.createElement("div");
    label.className = "history__label";
    label.textContent = h.label;
    const time = document.createElement("div");
    time.className = "history__time";
    time.textContent = h.time;
    top.append(label, time);
    li.append(top);
    historyEl.append(li);
  }
  historyCount.textContent = String(stats.history.length);
}

function pushHistory(label) {
  stats.history.push({ label, time: nowIsoLocal() });
  if (stats.history.length > 200) stats.history = stats.history.slice(stats.history.length - 200);
  saveStats();
  renderHistory();
}

// --- Settings editor
function addRow(item = { label: "", weight: 1 }) {
  const existing = itemsEl.querySelectorAll(".row").length;
  if (existing >= MAX_PRIZES) {
    toast(`最多支持 ${MAX_PRIZES} 个奖项`);
    return;
  }
  const row = document.createElement("div");
  row.className = "row";

  const label = document.createElement("input");
  label.className = "field";
  label.placeholder = "例如：Alice / 20元红包 / 一等奖";
  label.value = item.label ?? "";
  label.setAttribute("data-k", "label");

  const weight = document.createElement("input");
  weight.className = "field";
  weight.placeholder = "1";
  weight.inputMode = "numeric";
  weight.value = String(item.weight ?? 1);
  weight.setAttribute("data-k", "weight");

  const del = document.createElement("button");
  del.className = "trash";
  del.type = "button";
  del.title = "删除";
  del.textContent = "🗑";
  del.addEventListener("click", () => {
    row.remove();
    validateEditor();
  });

  [label, weight].forEach((el) => el.addEventListener("input", validateEditor));
  row.append(label, weight, del);
  itemsEl.append(row);
  validateEditor();
  label.focus();
}

function readEditorItems() {
  const rows = [...itemsEl.querySelectorAll(".row")];
  const items = rows.map((row) => {
    const label = row.querySelector('[data-k="label"]').value.trim();
    const weightRaw = row.querySelector('[data-k="weight"]').value.trim();
    const weight = weightRaw.length ? Number(weightRaw) : 1;
    return { label, weight };
  });
  return normalizeItems(items);
}

function validateEditor() {
  const items = readEditorItems();
  const ok = items.length >= 2;
  const over = items.length > MAX_PRIZES;
  btnSaveSettings.disabled = !ok || over;
  btnAddItem.disabled = items.length >= MAX_PRIZES;
  itemsHint.className = ok && !over ? "hint" : "hint hint--bad";
  if (!ok) itemsHint.textContent = "至少 2 个奖项才能抽奖。";
  else if (over) itemsHint.textContent = `最多支持 ${MAX_PRIZES} 个奖项（当前 ${items.length}）。`;
  else itemsHint.textContent = `当前奖项：${items.length} / ${MAX_PRIZES}。`;
}

function openSettings() {
  document.body.classList.add("modal-open");
  itemsEl.innerHTML = "";
  for (const it of normalizeItems(config.items)) addRow(it);
  if (normalizeItems(config.items).length === 0) addRow({ label: "", weight: 1 });
  toggleSound.checked = config.sound;
  toggleConfetti.checked = config.confetti;
  toggleRemoveWinner.checked = config.removeWinner;
  validateEditor();
  settingsDialog.showModal();
}

function applySettingsFromEditor() {
  config.items = readEditorItems();
  config.sound = Boolean(toggleSound.checked);
  config.confetti = Boolean(toggleConfetti.checked);
  config.removeWinner = Boolean(toggleRemoveWinner.checked);
  saveConfig();
  syncUI();
  renderTrack();
  toast("已保存");
}

function formatExport() {
  return JSON.stringify(
    {
      items: normalizeItems(config.items),
      sound: Boolean(config.sound),
      confetti: Boolean(config.confetti),
      removeWinner: Boolean(config.removeWinner),
      exportedAt: new Date().toISOString(),
      version: 4,
    },
    null,
    2,
  );
}

function tryImportFromText(text) {
  const parsed = safeJsonParse(text.trim());
  if (!parsed.ok) return { ok: false, reason: "JSON 解析失败" };
  const v = parsed.value;
  const items = normalizeItems(Array.isArray(v?.items) ? v.items : []);
  if (items.length < 2) return { ok: false, reason: "至少需要 2 个有效选项" };
  if (items.length > MAX_PRIZES) return { ok: false, reason: `最多支持 ${MAX_PRIZES} 个奖项` };
  config.items = items;
  if ("sound" in v) config.sound = Boolean(v.sound);
  if ("confetti" in v) config.confetti = Boolean(v.confetti);
  if ("removeWinner" in v) config.removeWinner = Boolean(v.removeWinner);
  saveConfig();
  syncUI();
  renderTrack();
  return { ok: true };
}

// --- Spin
function updateSpinEnabled() {
  const ok = normalizeItems(config.items).length >= 2;
  btnSpin.disabled = !ok || isSpinning;
}

function spin() {
  const items = normalizeItems(config.items);
  if (items.length < 2) return;
  if (isSpinning) return;

  if (!slotCount) renderTrack();
  const winnerIndex = weightedPickIndex(items);
  const winnerLabel = items[winnerIndex]?.label ?? "—";

  const startIdx = activeSlotIndex;
  const target = clamp(slotEls.findIndex((el) => el.dataset.idx === String(winnerIndex)), 0, Math.max(0, slotCount - 1));
  const delta = (target - startIdx + slotCount) % slotCount;
  const extraTurns = 6 + Math.floor(cryptoRandom() * 4);
  const steps = extraTurns * slotCount + delta;
  const duration = 4600 + Math.floor(cryptoRandom() * 900);
  const t0 = performance.now();
  let lastStep = 0;

  isSpinning = true;
  updateSpinEnabled();
  setResult("锁定中…");
  winnerBox?.classList.remove("winner--hit");

  const frame = (t) => {
    const p = clamp((t - t0) / duration, 0, 1);
    const e = easeOutCubic(p);
    const stepNow = Math.floor(e * steps);
    while (lastStep < stepNow) {
      lastStep++;
      const idx = (startIdx + lastStep) % slotCount;
      setActiveSlot(idx, { winner: false });
      const pitch = 280 + (1 - p) * 260;
      beep({ freq: pitch, time: 0.03, type: "square", gain: 0.018 });
    }

    if (p < 1) {
      spinRaf = requestAnimationFrame(frame);
      return;
    }

    cancelAnimationFrame(spinRaf);
    setActiveSlot(target, { winner: false });
    flashWinner(target);

    isSpinning = false;
    updateSpinEnabled();

    stats.spins += 1;
    saveStats();
    syncUI();

    setResult(winnerLabel);
    pushHistory(winnerLabel);
    winChime();
    burstConfetti();

    winnerBox?.classList.remove("winner--hit");
    void winnerBox?.offsetWidth;
    winnerBox?.classList.add("winner--hit");
    toast("已锁定结果");

    if (config.removeWinner) {
      config.items = items.filter((_, i) => i !== winnerIndex);
      saveConfig();
      syncUI();
      renderTrack();
    }
  };

  cancelAnimationFrame(spinRaf);
  spinRaf = requestAnimationFrame(frame);
}

// --- UI sync
function syncUI() {
  toggleSound.checked = config.sound;
  toggleConfetti.checked = config.confetti;
  toggleRemoveWinner.checked = config.removeWinner;
  renderHistory();
  updateSpinEnabled();
  if (normalizeItems(config.items).length < 2) setResult("请先在设置里录入选项");
}

// --- Events
btnSpin.addEventListener("click", spin);

document.addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.code === "Enter") {
    const activeDialog = document.querySelector("dialog[open]");
    if (activeDialog) return;
    e.preventDefault();
    spin();
  }
  if (e.code === "KeyS" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    openSettings();
  }
});

btnSettings.addEventListener("click", openSettings);
btnFullscreen.addEventListener("click", async () => {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch {
    toast("全屏失败（浏览器限制）");
  }
});

btnAddItem.addEventListener("click", () => addRow({ label: "", weight: 1 }));
btnSaveSettings.addEventListener("click", () => {
  if (btnSaveSettings.disabled) return;
  applySettingsFromEditor();
});

settingsDialog.addEventListener("close", () => {
  document.body.classList.remove("modal-open");
  if (settingsDialog.returnValue !== "ok") return;
  if (btnSaveSettings.disabled) return;
  applySettingsFromEditor();
});

btnExport.addEventListener("click", async () => {
  const text = formatExport();
  try {
    await navigator.clipboard.writeText(text);
    toast("已复制导出 JSON");
  } catch {
    toast("复制失败，可手动复制");
  }
  importText.value = text;
  importDialog.showModal();
});

btnImport.addEventListener("click", () => {
  document.body.classList.add("modal-open");
  importText.value = "";
  importDialog.showModal();
  importText.focus();
});

btnDoImport.addEventListener("click", () => {
  const r = tryImportFromText(importText.value);
  toast(r.ok ? "已导入" : r.reason);
});

importDialog.addEventListener("close", () => {
  document.body.classList.remove("modal-open");
  if (importDialog.returnValue !== "ok") return;
  const r = tryImportFromText(importText.value);
  toast(r.ok ? "已导入" : r.reason);
});

toggleSound.addEventListener("change", () => {
  config.sound = Boolean(toggleSound.checked);
  saveConfig();
  toast(config.sound ? "音效已开启" : "音效已关闭");
  if (config.sound) beep({ freq: 560, time: 0.06, type: "sine", gain: 0.05 });
});

toggleConfetti.addEventListener("change", () => {
  config.confetti = Boolean(toggleConfetti.checked);
  saveConfig();
  toast(config.confetti ? "彩带已开启" : "彩带已关闭");
});

toggleRemoveWinner.addEventListener("change", () => {
  config.removeWinner = Boolean(toggleRemoveWinner.checked);
  saveConfig();
  toast(config.removeWinner ? "中奖后移除已开启" : "中奖后移除已关闭");
});

btnResetStats.addEventListener("click", () => {
  stats = { spins: 0, history: [] };
  saveStats();
  syncUI();
  toast("已清空统计");
});

function onResize() {
  initParticles();
  resizeFullCanvas(confettiCanvas);
  renderTrack();
}
window.addEventListener("resize", () => requestAnimationFrame(onResize));

const ro = new ResizeObserver(() => renderTrack());
ro.observe(trackEl);

// --- Boot
syncUI();
renderTrack();
initParticles();
tickParticles();
resizeFullCanvas(confettiCanvas);
