import { CONFIG, getGitHubUser, exchangeCodeForToken, triggerGitHubAction, runUrl } from './data.js';
import { trackBuild, fetchBuiltApk } from './tracker.js';
import { saveBuild, getAllBuilds, deleteBuild as deleteBuildRecord } from './store.js';
import { toast, confirmDialog } from './ui.js';
import { getSettings, saveSettings, applySettings, haptic, clearCaches } from './settings.js';
import { renderHistory, initHistoryScreen } from './history.js';

const screens = {
  welcome: document.getElementById("welcome"),
  dashboard: document.getElementById("dashboard"),
  processing: document.getElementById("processing"),
  download: document.getElementById("download"),
  history: document.getElementById("history"),
  settingsScreen: document.getElementById("settingsScreen")
};

const NAV_SCREENS = new Set(["dashboard", "history", "settingsScreen"]);
const bottomNav = document.getElementById("bottomNav");

const STATE_KEY = "gh_oauth_state";
const TOKEN_KEY = "gh_token";
const USER_KEY = "gh_user";

let activeTracker = null;
let lastBuildConfig = null;
let currentApk = null; // { blob, fileName, sizeBytes }
let currentRunId = null;

function showScreen(name) {
  for (const key of Object.keys(screens)) {
    screens[key].classList.toggle("hidden", key !== name);
  }
  bottomNav.classList.toggle("hidden", !NAV_SCREENS.has(name));
  bottomNav.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.nav === name);
  });
  if (name === "history") renderHistory();
}

// ---------- BOTTOM NAV ----------
bottomNav.querySelectorAll("[data-nav]").forEach((btn) => {
  btn.addEventListener("click", () => {
    haptic();
    showScreen(btn.dataset.nav);
  });
});

// ---------- SETTINGS SCREEN ----------
function initSettingsScreen() {
  const s = getSettings();
  document.getElementById("settingAnimations").checked = s.animations;
  document.getElementById("settingHaptics").checked = s.haptics;
  document.getElementById("settingDataSaver").checked = s.dataSaver;
  document.querySelectorAll(".theme-btn").forEach((btn) => {
    btn.classList.toggle("ring-2", btn.dataset.theme === s.theme);
    btn.classList.toggle("ring-indigo-500", btn.dataset.theme === s.theme);
  });

  document.querySelectorAll(".theme-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      saveSettings({ theme: btn.dataset.theme });
      initSettingsScreen();
    });
  });
  document.getElementById("settingAnimations").addEventListener("change", (e) => saveSettings({ animations: e.target.checked }));
  document.getElementById("settingHaptics").addEventListener("change", (e) => saveSettings({ haptics: e.target.checked }));
  document.getElementById("settingDataSaver").addEventListener("change", (e) => saveSettings({ dataSaver: e.target.checked }));
  document.getElementById("clearCacheBtn").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Clear local cache?",
      message: "Removes cached data and offline files. Your GitHub login and build history are kept.",
      confirmLabel: "Clear",
      danger: true
    });
    if (ok) {
      clearCaches();
      toast("Cache cleared.", "success");
    }
  });
}

// ---------- HISTORY SCREEN ----------
initHistoryScreen({
  onOpenRun: (runId) => window.open(runUrl(runId), "_blank"),
  onDuplicate: (build) => {
    const cfg = build.config || {};
    const set = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.value = val; };
    set("appName", build.appName);
    set("packageName", build.packageName);
    set("url", cfg.appUrl);
    set("versionName", build.versionName);
    set("versionCode", cfg.versionCode);
    set("orientation", cfg.orientation);
    set("displayMode", cfg.displayMode);
    set("themeColor", cfg.themeColor);
    set("backgroundColor", cfg.backgroundColor);
    set("fallbackType", cfg.fallbackType);
    set("iconUrl", cfg.iconUrl);
    set("startUrl", cfg.startUrl);
    showScreen("dashboard");
    toast("Form pre-filled from that build — review and generate.", "info");
  }
});

// ---------- LOGIN ----------
function login() {
  const state = crypto.randomUUID();
  sessionStorage.setItem(STATE_KEY, state);
  const params = new URLSearchParams({
    client_id: CONFIG.CLIENT_ID,
    redirect_uri: CONFIG.REDIRECT_URI,
    scope: "repo workflow",
    state
  });
  window.location = `https://github.com/login/oauth/authorize?${params}`;
}

// ---------- LOGOUT ----------
function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  activeTracker?.cancel?.();
  showScreen("welcome");
  toast("Logged out.", "success");
}

// ---------- HANDLE OAUTH REDIRECT ----------
async function handleAuth() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const returnedState = params.get("state");
  const oauthError = params.get("error");

  if (code || returnedState || oauthError) {
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  if (oauthError) {
    showAuthError(`GitHub login was cancelled or denied (${oauthError}).`);
  } else if (code) {
    const expectedState = sessionStorage.getItem(STATE_KEY);
    sessionStorage.removeItem(STATE_KEY);

    if (!expectedState || returnedState !== expectedState) {
      showAuthError("Login couldn't be verified (state mismatch). Please try again.");
    } else {
      try {
        const token = await exchangeCodeForToken(code);
        localStorage.setItem(TOKEN_KEY, token);
      } catch (err) {
        showAuthError(`GitHub login failed: ${err.message}`);
      }
    }
  }

  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    await loadDashboard();
  } else {
    showScreen("welcome");
  }
}

function showAuthError(message) {
  const el = document.getElementById("authError");
  if (el) {
    el.textContent = message;
    el.classList.remove("hidden");
  } else {
    toast(message, "error");
  }
}

// ---------- LOAD DASHBOARD ----------
async function loadDashboard() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return;

  try {
    const user = await getGitHubUser(token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));

    document.getElementById("username").innerText = user.login;
    document.getElementById("avatar").src = user.avatar_url;
    initSettingsScreen();
    showScreen("dashboard");
  } catch {
    showAuthError("Your GitHub session expired or is invalid. Please log in again.");
    logout();
  }
}

// ---------- BUILD CONFIG ----------
function buildDefaultConfig() {
  return {
    appUrl: "", appName: "", packageName: "",
    versionName: "1.0.0", versionCode: "1", orientation: "default",
    themeColor: "#4F46E5", backgroundColor: "#0F172A", displayMode: "standalone",
    iconUrl: "", startUrl: "/", enableNotifications: false, fallbackType: "customtabs"
  };
}

function readBuildConfigFromForm() {
  const val = (id) => document.getElementById(id)?.value?.trim();
  const checked = (id) => document.getElementById(id)?.checked;
  const cfg = buildDefaultConfig();
  cfg.appUrl = val("url") || cfg.appUrl;
  cfg.appName = val("appName") || cfg.appName;
  cfg.packageName = val("packageName") || cfg.packageName;
  cfg.versionName = val("versionName") || cfg.versionName;
  cfg.versionCode = val("versionCode") || cfg.versionCode;
  cfg.orientation = val("orientation") || cfg.orientation;
  cfg.themeColor = val("themeColor") || cfg.themeColor;
  cfg.backgroundColor = val("backgroundColor") || cfg.backgroundColor;
  cfg.displayMode = val("displayMode") || cfg.displayMode;
  cfg.iconUrl = val("iconUrl") || cfg.iconUrl;
  cfg.startUrl = val("startUrl") || cfg.startUrl;
  cfg.enableNotifications = !!checked("enableNotifications");
  cfg.fallbackType = val("fallbackType") || cfg.fallbackType;
  return cfg;
}

function validatePackageName(pkg) {
  return /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(pkg);
}

// ---------- TRIGGER BUILD ----------
async function triggerBuild() {
  const config = readBuildConfigFromForm();
  const token = localStorage.getItem(TOKEN_KEY);

  if (!config.appUrl || !config.appName || !config.packageName) {
    return toast("App Name, Website URL, and Package Name are all required.", "error");
  }
  if (!/^https:\/\//.test(config.appUrl)) return toast("Website URL must start with https://", "error");
  if (!validatePackageName(config.packageName)) {
    return toast('Package Name must look like "com.example.app" (lowercase, dot-separated).', "error");
  }
  if (!token) return toast("Please log in with GitHub first.", "error");

  const btn = document.getElementById("buildBtn");
  const originalText = btn.innerText;
  btn.innerText = "Starting build...";
  btn.disabled = true;
  haptic();

  try {
    const res = await triggerGitHubAction(config, token);
    if (res.status !== 204) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `GitHub returned ${res.status}`);
    }
    lastBuildConfig = config;
    startTracking(token, config, Date.now());
  } catch (err) {
    toast(`Error starting build: ${err.message}`, "error");
  } finally {
    btn.innerText = originalText;
    btn.disabled = false;
  }
}

function retryBuild() {
  showScreen("dashboard");
}

// ---------- PROCESSING SCREEN ----------
function resetProcessingUI() {
  document.getElementById("processingSubtitle").textContent = "Looking for the build on GitHub Actions…";
  document.getElementById("processingSpinner").classList.remove("hidden");
  document.getElementById("processingFailed").classList.add("hidden");
  document.getElementById("processingActions").classList.remove("hidden");
  document.getElementById("stageList").innerHTML = "";
}

function renderStages(stages) {
  const list = document.getElementById("stageList");
  list.innerHTML = stages.map((s) => {
    const icon = { pending: "⚪", active: "🔵", done: "✅", failed: "❌" }[s.state];
    const textClass = s.state === "pending" ? "text-gray-500" : "text-white";
    return `<li class="flex items-center gap-3 text-sm ${textClass}"><span>${icon}</span><span>${s.label}</span></li>`;
  }).join("");
}

function formatDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function startTracking(token, config, dispatchedAt) {
  showScreen("processing");
  resetProcessingUI();

  activeTracker = trackBuild(token, { appName: config.appName, packageName: config.packageName, dispatchedAt }, {
    onRunFound: ({ runId, runUrl: url }) => {
      currentRunId = runId;
      document.getElementById("processingSubtitle").textContent = "Build started — tracking live progress…";
      document.getElementById("viewLogsBtn").href = url;
    },
    onProgress: ({ stages, elapsedSeconds, estimatedRemainingSeconds }) => {
      renderStages(stages);
      document.getElementById("elapsedTime").textContent = `Elapsed: ${formatDuration(elapsedSeconds)}`;
      document.getElementById("remainingTime").textContent =
        estimatedRemainingSeconds > 0 ? `~${formatDuration(estimatedRemainingSeconds)} remaining (typical)` : "Finishing up…";
    },
    onDone: async ({ runId, elapsedSeconds }) => {
      document.getElementById("processingSpinner").classList.add("hidden");
      document.getElementById("processingSubtitle").textContent = "Fetching your APK…";
      try {
        const apk = await fetchBuiltApk(token, runId);
        currentApk = apk;
        currentRunId = runId;
        saveBuild({
          runId, appName: config.appName, packageName: config.packageName,
          versionName: config.versionName, sizeBytes: apk.sizeBytes,
          durationSeconds: elapsedSeconds, generatedAt: Date.now(),
          config
        });
        toast("Build complete!", "success");
        showDownloadScreen({ config, apk, durationSeconds: elapsedSeconds, runId });
      } catch (err) {
        toast(`Build succeeded but the APK couldn't be fetched: ${err.message}`, "error");
        showScreen("dashboard");
      }
    },
    onFailed: ({ runUrl: url }) => {
      document.getElementById("processingSpinner").classList.add("hidden");
      document.getElementById("processingSubtitle").textContent = "Build failed.";
      document.getElementById("processingActions").classList.add("hidden");
      document.getElementById("processingFailed").classList.remove("hidden");
      document.getElementById("viewLogsBtn").href = url;
      toast("Build failed — check the logs.", "error");
    },
    onError: (err) => {
      document.getElementById("processingSpinner").classList.add("hidden");
      document.getElementById("processingSubtitle").textContent = `Error: ${err.message}`;
      document.getElementById("processingActions").classList.add("hidden");
      document.getElementById("processingFailed").classList.remove("hidden");
      toast(`Tracking error: ${err.message}`, "error");
    }
  });
}

async function cancelBuild() {
  if (activeTracker) await activeTracker.cancel();
  showScreen("dashboard");
}

// ---------- DOWNLOAD SCREEN ----------
function showDownloadScreen({ config, apk, durationSeconds, runId }) {
  document.getElementById("downloadAppName").textContent = `${config.appName} · ${config.packageName}`;
  document.getElementById("dlVersion").textContent = config.versionName;
  document.getElementById("dlPackage").textContent = config.packageName;
  document.getElementById("dlSize").textContent = formatBytes(apk.sizeBytes);
  document.getElementById("dlDuration").textContent = formatDuration(durationSeconds);
  document.getElementById("dlDate").textContent = new Date().toLocaleString();
  document.getElementById("openActionsBtn").href = runUrl(runId);

  const qrEl = document.getElementById("qrcode");
  qrEl.innerHTML = "";
  new QRCode(qrEl, { text: runUrl(runId), width: 140, height: 140 });

  showScreen("download");
}

function formatBytes(bytes) {
  if (!bytes) return "—";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

function downloadApk() {
  if (!currentApk) return;
  const url = URL.createObjectURL(currentApk.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = currentApk.fileName.split("/").pop();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function copyRunLink() {
  if (!currentRunId) return;
  haptic();
  await navigator.clipboard.writeText(runUrl(currentRunId));
  toast("Link copied — opens this build's page on GitHub (sign-in required).", "success");
}

async function shareApk() {
  if (!currentApk) return;
  haptic();
  const file = new File([currentApk.blob], currentApk.fileName.split("/").pop(), { type: "application/vnd.android.package-archive" });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "APK build" });
      return;
    } catch {
      // user cancelled — fall through to link share
    }
  }
  if (navigator.share) {
    await navigator.share({ title: "APK build", url: runUrl(currentRunId) }).catch(() => {});
  } else {
    await copyRunLink();
  }
}

async function deleteCurrentBuild() {
  if (!currentRunId) return;
  const ok = await confirmDialog({
    title: "Delete from history?",
    message: "Removes this from your local history only. The GitHub Actions run itself won't be deleted.",
    confirmLabel: "Delete",
    danger: true
  });
  if (ok) {
    deleteBuildRecord(currentRunId);
    startNewBuild();
    toast("Build removed.", "success");
  }
}

function startNewBuild() {
  currentApk = null;
  currentRunId = null;
  showScreen("dashboard");
}

window.login = login;
window.logout = logout;
window.triggerBuild = triggerBuild;
window.retryBuild = retryBuild;
window.cancelBuild = cancelBuild;
window.downloadApk = downloadApk;
window.copyRunLink = copyRunLink;
window.shareApk = shareApk;
window.deleteCurrentBuild = deleteCurrentBuild;
window.startNewBuild = startNewBuild;

// Register service worker for offline support
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("service-worker.js")
    .then((r) => console.log("Service Worker registered:", r))
    .catch((e) => console.warn("Service Worker registration failed:", e));
}

// Apply saved settings on load
applySettings();

handleAuth(); // Run on page load
