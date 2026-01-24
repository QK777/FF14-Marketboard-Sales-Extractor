const el = (id) => document.getElementById(id);

// ---------- UI ----------
const logInput = el("logInput");
const extractBtn = el("extractBtn");
const clearBtn = el("clearBtn");

const output = el("output");
const rowTpl = el("rowTpl");
const stats = el("stats");
const toast = el("toast");

const dedupeToggle = el("dedupeToggle");
const sortSelect = el("sortSelect");

const copyAllBtn = el("copyAllBtn");
const clearOutBtn = el("clearOutBtn");

// monitor UI（無い場合もあるので null 可）
const pickStartBtn = el("pickStartBtn");
const stopWatchBtn = el("stopWatchBtn");
const monitorStatus = el("monitorStatus");
const encodingSelect = el("encodingSelect");
const fromStartToggle = el("fromStartToggle");

// ---------- Diagnostics ----------
console.log("[FF14 Extractor] secure?", window.isSecureContext);
console.log("[FF14 Extractor] showOpenFilePicker?", typeof window.showOpenFilePicker);

// ---------- LocalStorage ----------
const STORAGE_KEY = "ff14_log_item_extractor_v5";

const defaultState = () => ({
  rawEntries: [],
  seenLogs: [],
  seenLineHashes: [],
  prefs: {
    dedupe: true,
    sortMode: "order",
    encoding: "utf-8",
    fromStart: false
  },
  lastInput: ""
});

let state = defaultState();

function safeParseJSON(s) {
  try { return JSON.parse(s); } catch { return null; }
}
function loadState() {
  const data = safeParseJSON(localStorage.getItem(STORAGE_KEY));
  if (!data || typeof data !== "object") return;

  state.rawEntries = Array.isArray(data.rawEntries) ? data.rawEntries.filter(x => x && x.id && x.name) : [];
  state.seenLogs = Array.isArray(data.seenLogs) ? data.seenLogs.filter(x => typeof x === "string") : [];
  state.seenLineHashes = Array.isArray(data.seenLineHashes) ? data.seenLineHashes.filter(x => typeof x === "string") : [];

  state.prefs = {
    dedupe: !!(data.prefs && data.prefs.dedupe),
    sortMode: (data.prefs && typeof data.prefs.sortMode === "string") ? data.prefs.sortMode : "order",
    encoding: (data.prefs && typeof data.prefs.encoding === "string") ? data.prefs.encoding : "utf-8",
    fromStart: !!(data.prefs && data.prefs.fromStart),
  };

  state.lastInput = (typeof data.lastInput === "string") ? data.lastInput : "";
}
function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
}

// ---------- Sorting ----------
const collatorJA = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });

function groupOf(str) {
  const ch = (str || "")[0] || "";
  if (/[0-9]/.test(ch)) return 0;
  if (/[A-Za-z]/.test(ch)) return 1;
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(ch)) return 2;
  if (/[\u4E00-\u9FFF]/.test(ch)) return 3;
  return 4;
}
function compareName(a, b) {
  const ga = groupOf(a);
  const gb = groupOf(b);
  if (ga !== gb) return ga - gb;
  return collatorJA.compare(a, b);
}

// ---------- Utils ----------
function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast._t);
  showToast._t = window.setTimeout(() => toast.classList.remove("show"), 1200);
}

function setStatus(kind, text) {
  if (!monitorStatus) return;
  monitorStatus.classList.remove("idle", "live", "err");
  monitorStatus.classList.add(kind);
  monitorStatus.textContent = text;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function makeId() {
  if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "id_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
}

/** manual paste same-text reject（軽量FNV-1a） */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ("00000000" + h.toString(16)).slice(-8);
}
function normalizeLogText(text) {
  return (text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

// ---------- Extract rules（売却ログのみ） ----------
const SALE_MSG_RE = /マーケットに.*?ギルで出品した([^\n\r]+?)が売れ/;

function extractItemNamesFromPasted(text) {
  if (!text) return [];
  const lines = text.split("\n").map(s => s.trim()).filter(Boolean);
  const results = [];
  for (const line of lines) {
    const m = line.match(SALE_MSG_RE);
    if (m && m[1]) results.push(m[1].trim());
  }
  return results;
}

// ---------- View building ----------
function buildViewList() {
  const dedupe = !!(dedupeToggle && dedupeToggle.checked);
  if (dedupe) {
    const map = new Map(); // name -> {count, firstIdx}
    for (let i = 0; i < state.rawEntries.length; i++) {
      const name = state.rawEntries[i].name;
      if (!map.has(name)) map.set(name, { count: 1, firstIdx: i });
      else map.get(name).count += 1;
    }
    return [...map.entries()]
      .map(([name, v]) => ({ kind: "agg", id: `agg_${name}`, name, count: v.count, idx: v.firstIdx }))
      .sort((a, b) => a.idx - b.idx);
  }
  return state.rawEntries.map((e, idx) => ({ kind: "raw", id: e.id, name: e.name, count: 1, idx }));
}

function getSortedView(list) {
  const mode = sortSelect ? sortSelect.value : "order";
  const view = list.slice();
  if (mode === "order") view.sort((a, b) => a.idx - b.idx);
  else if (mode === "nameAsc") view.sort((a, b) => compareName(a.name, b.name));
  else if (mode === "nameDesc") view.sort((a, b) => compareName(b.name, a.name));
  return view;
}

function updateStats() {
  if (!stats) return;
  if (!state.rawEntries.length) { stats.textContent = "0件"; return; }

  const dedupe = !!(dedupeToggle && dedupeToggle.checked);
  if (dedupe) {
    const uniq = new Set(state.rawEntries.map(x => x.name)).size;
    stats.textContent = `表示: ${uniq}件 / 合計: ${state.rawEntries.length}件（重複込み）`;
  } else {
    stats.textContent = `表示: ${state.rawEntries.length}件`;
  }
}

function render() {
  if (!output || !rowTpl) return;

  output.innerHTML = "";
  updateStats();
  if (!state.rawEntries.length) return;

  const view = getSortedView(buildViewList());

  for (const item of view) {
    const node = rowTpl.content.firstElementChild.cloneNode(true);

    const nameText = node.querySelector(".name-text");
    const badge = node.querySelector(".count-badge");

    nameText.textContent = item.name;

    const dedupe = !!(dedupeToggle && dedupeToggle.checked);
    if (dedupe && item.count > 1) {
      badge.textContent = `${item.count}`;
      badge.classList.add("show");
    } else {
      badge.textContent = "";
      badge.classList.remove("show");
    }

    const metaEl = node.querySelector(".meta");
    if (metaEl) {
      metaEl.textContent = (dedupe && item.count > 1) ? `x${item.count}` : "";
    }

    // ✅ 行クリックでコピー
    const doCopy = async () => {
      const ok = await copyText(item.name);
      showToast(ok ? `コピーしました：${item.name}` : "コピーに失敗しました");
    };

    node.addEventListener("click", (e) => {
      // Delボタン押下はコピーしない
      if (e.target && e.target.closest(".delete")) return;
      doCopy();
    });

    // キーボード対応（Enter/Spaceでコピー）
    node.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        doCopy();
      }
    });

    // ✅ Del（右）
    const delBtn = node.querySelector(".delete");
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation(); // 行クリックに伝播させない

      if (item.kind === "agg") {
        state.rawEntries = state.rawEntries.filter(x => x.name !== item.name);
        showToast(`削除しました：${item.name}（全件）`);
      } else {
        state.rawEntries = state.rawEntries.filter(x => x.id !== item.id);
        showToast(`削除しました：${item.name}`);
      }
      saveState();
      render();
    });

    output.appendChild(node);
  }
}


// ---------- Append helpers ----------
function rememberLinehash(linehash) {
  if (!linehash) return true;
  if (state.seenLineHashes.includes(linehash)) return false;

  state.seenLineHashes.push(linehash);
  const MAX = 8000;
  if (state.seenLineHashes.length > MAX) state.seenLineHashes = state.seenLineHashes.slice(-MAX);
  return true;
}

function appendItems(names) {
  for (const name of names) {
    state.rawEntries.push({ id: makeId(), name });
  }
  saveState();
  render();
}

// ---------- Manual Export ----------
function handleExtractAdd() {
  if (!logInput) return;

  const normalized = normalizeLogText(logInput.value);
  state.lastInput = logInput.value || "";
  saveState();

  if (!normalized) { showToast("ログが空です"); return; }

  const hash = fnv1a(normalized);
  if (state.seenLogs.includes(hash)) {
    showToast("同じログは既に取り込み済みです（追加しません）");
    return;
  }

  const names = extractItemNamesFromPasted(normalized);
  if (!names.length) {
    showToast("売却ログが見つかりませんでした");
    return;
  }

  appendItems(names);

  state.seenLogs.push(hash);
  if (state.seenLogs.length > 400) state.seenLogs = state.seenLogs.slice(-400);
  saveState();

  showToast(`追加しました（${names.length}件）`);
}

// ---------- Realtime file watching ----------
const Watcher = {
  handle: null,
  running: false,
  timer: null,
  offset: 0,
  remainder: "",
  filename: "",
};

function currentEncoding() {
  return encodingSelect ? encodingSelect.value : (state.prefs.encoding || "utf-8");
}
function decoderFor(enc) {
  if (enc === "utf-8-sig") return new TextDecoder("utf-8", { fatal: false });
  return new TextDecoder(enc, { fatal: false });
}
function stripBomIfNeeded(text, enc) {
  if (enc !== "utf-8-sig") return text;
  if (text && text.charCodeAt(0) === 0xFEFF) return text.slice(1);
  return text;
}

function parseActLine(line) {
  const parts = line.split("|");
  if (parts.length < 6) return null;
  return { ts: parts[1], message: parts[4], linehash: parts[5] };
}

function extractNameFromActMessage(msg) {
  const m = (msg || "").match(SALE_MSG_RE);
  return (m && m[1]) ? m[1].trim() : "";
}

async function readNewBytes() {
  if (!Watcher.handle) return;

  const file = await Watcher.handle.getFile();
  const size = file.size;

  // ログが縮んだ（ローテ/クリア）場合
  if (size < Watcher.offset) {
    Watcher.offset = 0;
    Watcher.remainder = "";
  }
  if (size === Watcher.offset) return;

  const blob = file.slice(Watcher.offset, size);
  const buf = await blob.arrayBuffer();

  const enc = currentEncoding();
  const dec = decoderFor(enc);
  let text = dec.decode(buf);
  text = stripBomIfNeeded(text, enc);

  Watcher.offset = size;

  let merged = Watcher.remainder + text;
  const lines = merged.split(/\r?\n/);
  Watcher.remainder = lines.pop() ?? "";

  const namesToAdd = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const rec = parseActLine(line);
    if (!rec) continue;

    if (rec.linehash && !rememberLinehash(rec.linehash)) continue;

    const name = extractNameFromActMessage(rec.message);
    if (!name) continue;

    namesToAdd.push(name);
  }

  if (namesToAdd.length) {
    appendItems(namesToAdd);
    setStatus("live", `監視中：${Watcher.filename}（+${namesToAdd.length}）`);
  }
}

function ensureFileFallbackInput() {
  let inp = document.getElementById("fileFallback");
  if (!inp) {
    inp = document.createElement("input");
    inp.id = "fileFallback";
    inp.type = "file";
    inp.accept = ".log,.txt,text/plain";
    inp.style.display = "none";
    document.body.appendChild(inp);
  }
  return inp;
}

async function startWatching() {
  // UIが無いページでも呼ばれ得るのでガード
  if (stopWatchBtn) stopWatchBtn.disabled = false;

  // File System Access API がない場合：フォールバック（1回読み込みのみ）
  if (!window.showOpenFilePicker) {
    setStatus("err", "この環境ではリアルタイム監視が制限（1回読み込みのみ）");
    showToast("showOpenFilePickerが無いのでフォールバックで読み込みます");

    const inp = ensureFileFallbackInput();
    inp.onchange = async () => {
      const file = inp.files?.[0];
      if (!file) return;

      const buf = await file.arrayBuffer();
      const enc = currentEncoding();
      const dec = decoderFor(enc);

      let text = dec.decode(buf);
      text = stripBomIfNeeded(text, enc);

      const lines = text.split(/\r?\n/);
      const names = [];

      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;

        const rec = parseActLine(line);
        if (!rec) continue;

        // linehashがあれば重複回避
        if (rec.linehash && !rememberLinehash(rec.linehash)) continue;

        const name = extractNameFromActMessage(rec.message);
        if (name) names.push(name);
      }

      if (names.length) {
        appendItems(names);
        showToast(`取り込みました（${names.length}件）`);
      } else {
        showToast("売却ログが見つかりませんでした");
      }

      inp.value = "";
    };

    inp.click();
    return;
  }

  // リアルタイム監視（showOpenFilePicker）
  try {
        const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [
            {
            description: "ACT logs",
            accept: {
                "text/plain": [".log", ".txt"],
            }
            }
        ]
        });

    // 権限要求（実装差に備えて）
    if (handle.requestPermission) {
      const p = await handle.requestPermission({ mode: "read" });
      if (p !== "granted") {
        setStatus("err", "読み取り権限が必要です");
        showToast("読み取り権限が許可されませんでした");
        return;
      }
    }

    Watcher.handle = handle;
    Watcher.filename = handle.name || "selected file";
    Watcher.running = true;
    Watcher.remainder = "";

    const file = await handle.getFile();
    const fromStart = !!(fromStartToggle && fromStartToggle.checked);
    Watcher.offset = fromStart ? 0 : file.size;

    if (stopWatchBtn) stopWatchBtn.disabled = false;
    setStatus("live", `監視中：${Watcher.filename}`);

    // ポーリング開始
    if (Watcher.timer) clearInterval(Watcher.timer);
    Watcher.timer = setInterval(() => {
      if (!Watcher.running) return;
      readNewBytes().catch((e) => {
        console.error("[Watcher] read error:", e);
        setStatus("err", "読み取りエラー");
      });
    }, 700);

    showToast(fromStart ? "監視開始（先頭から読み込み）" : "監視開始（追記分から読み込み）");
  } catch (e) {
    // キャンセルは無言、その他は表示
    console.warn("[Watcher] start canceled or failed:", e);
    setStatus("idle", "未接続");
    if (stopWatchBtn) stopWatchBtn.disabled = true;
  }
}

function stopWatching() {
  Watcher.running = false;
  if (Watcher.timer) clearInterval(Watcher.timer);
  Watcher.timer = null;
  Watcher.handle = null;
  Watcher.remainder = "";
  Watcher.offset = 0;
  Watcher.filename = "";

  if (stopWatchBtn) stopWatchBtn.disabled = true;
  setStatus("idle", "未接続");
  showToast("監視を停止しました");
}

// ---------- Events（全部 null ガード） ----------
if (extractBtn) extractBtn.addEventListener("click", handleExtractAdd);

if (clearBtn) clearBtn.addEventListener("click", () => {
  if (logInput) logInput.value = "";
  state.lastInput = "";
  saveState();
  showToast("入力をクリアしました");
});

if (clearOutBtn) clearOutBtn.addEventListener("click", () => {
  state.rawEntries = [];
  state.seenLogs = [];
  state.seenLineHashes = [];
  saveState();
  render();
  showToast("結果をクリアしました（取り込み済み判定もリセット）");
});

if (sortSelect) sortSelect.addEventListener("change", () => {
  state.prefs.sortMode = sortSelect.value;
  saveState();
  render();
});

if (dedupeToggle) dedupeToggle.addEventListener("change", () => {
  state.prefs.dedupe = dedupeToggle.checked;
  saveState();
  render();
});

if (copyAllBtn) copyAllBtn.addEventListener("click", async () => {
  if (!state.rawEntries.length) { showToast("コピーする内容がありません"); return; }
  const view = getSortedView(buildViewList());
  const ok = await copyText(view.map(v => v.name).join("\n"));
  showToast(ok ? `全件コピーしました（${view.length}行）` : "全件コピーに失敗しました");
});

if (logInput) logInput.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") handleExtractAdd();
});

if (logInput) {
  let inputTimer = null;
  logInput.addEventListener("input", () => {
    window.clearTimeout(inputTimer);
    inputTimer = window.setTimeout(() => {
      state.lastInput = logInput.value || "";
      saveState();
    }, 250);
  });
}

// monitor UI
if (pickStartBtn) pickStartBtn.addEventListener("click", startWatching);
if (stopWatchBtn) stopWatchBtn.addEventListener("click", stopWatching);

if (encodingSelect) encodingSelect.addEventListener("change", () => {
  state.prefs.encoding = encodingSelect.value;
  saveState();
});
if (fromStartToggle) fromStartToggle.addEventListener("change", () => {
  state.prefs.fromStart = fromStartToggle.checked;
  saveState();
});

// ---------- Boot ----------
(function boot() {
  loadState();

  if (dedupeToggle) dedupeToggle.checked = !!state.prefs.dedupe;
  if (sortSelect) sortSelect.value = state.prefs.sortMode || "order";

  if (encodingSelect) encodingSelect.value = state.prefs.encoding || "utf-8";
  if (fromStartToggle) fromStartToggle.checked = !!state.prefs.fromStart;

  if (logInput && state.lastInput) logInput.value = state.lastInput;

  setStatus("idle", "未接続");
  render();
})();
