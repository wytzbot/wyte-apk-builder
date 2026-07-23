import { CONFIG, getGitHubUser, exchangeCodeForToken, triggerGitHubAction, runUrl } from './data.js';
import { trackBuild, fetchBuiltApk } from './tracker.js';
import { saveBuild, getBuild, deleteBuild } from './store.js';

const screens = {
  welcome: document.getElementById("welcome"),
  dashboard: document.getElementById("dashboard"),
  processing: document.getElementById("processing"),
  download: document.getElementById("download")
};

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
}

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
  showScreen("welcome");
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
    alert(message);
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
    return alert("App Name, Website URL, and Package Name are all required.");
  }
  if (!/^https:\/\//.test(config.appUrl)) return alert("Website URL must start with https://");
  if (!validatePackageName(config.packageName)) {
    return alert('Package Name must look like "com.example.app" (lowercase, dot-separated).');
  }
  if (!token) return alert("Please log in with GitHub first.");

  const btn = document.getElementById("buildBtn");
  btn.innerText = "Starting build...";
  btn.disabled = true;

  try {
    const res = await triggerGitHubAction(config, token);
    if (res.status !== 204) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `GitHub returned ${res.status}`);
    }
    lastBuildConfig = config;
    startTracking(token, config, Date.now());
  } catch (err) {
    alert(`Error starting build: ${err.message}`);
  } finally {
    btn.innerText = "Generate APK";
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
          durationSeconds: elapsedSeconds, generatedAt: Date.now()
        });
        showDownloadScreen({ config, apk, durationSeconds: elapsedSeconds, runId });
      } catch (err) {
        showAuthError(`Build succeeded but the APK couldn't be fetched: ${err.message}`);
        showScreen("dashboard");
      }
    },
    onFailed: ({ runUrl: url }) => {
      document.getElementById("processingSpinner").classList.add("hidden");
      document.getElementById("processingSubtitle").textContent = "Build failed.";
      document.getElementById("processingActions").classList.add("hidden");
      document.getElementById("processingFailed").classList.remove("hidden");
      document.getElementById("viewLogsBtn").href = url;
    },
    onError: (err) => {
      document.getElementById("processingSpinner").classList.add("hidden");
      document.getElementById("processingSubtitle").textContent = `Error: ${err.message}`;
      document.getElementById("processingActions").classList.add("hidden");
      document.getElementById("processingFailed").classList.remove("hidden");
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
  await navigator.clipboard.writeText(runUrl(currentRunId));
  alert("Link copied — opens this build's page on GitHub (sign-in required to download from there).");
}

async function shareApk() {
  if (!currentApk) return;
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

function deleteCurrentBuild() {
  if (!currentRunId) return;
  if (!confirm("Remove this build from your local history? The GitHub Actions run itself won't be deleted.")) return;
  deleteBuild(currentRunId);
  startNewBuild();
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

handleAuth(); // Run on page load
