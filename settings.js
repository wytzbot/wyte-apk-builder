const KEY = "wyte_settings";

const DEFAULTS = {
  theme: "system", // "dark" | "light" | "system"
  animations: true,
  haptics: true,
  dataSaver: false
};

export function getSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(partial) {
  const merged = { ...getSettings(), ...partial };
  localStorage.setItem(KEY, JSON.stringify(merged));
  applySettings(merged);
  return merged;
}

export function applySettings(settings = getSettings()) {
  const isDark =
    settings.theme === "dark" || (settings.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  document.documentElement.classList.toggle("light-mode", !isDark);
  document.body.classList.toggle("no-animations", !settings.animations);
  return settings;
}

export function haptic(pattern = 10) {
  const settings = getSettings();
  if (settings.haptics && navigator.vibrate) navigator.vibrate(pattern);
}

export function clearCaches() {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith("wyte_") && k !== KEY);
  keys.forEach((k) => localStorage.removeItem(k));
  if ("caches" in window) {
    caches.keys().then((names) => names.forEach((n) => caches.delete(n)));
  }
}

// Apply immediately on module load so there's no flash of the wrong theme.
applySettings();

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (getSettings().theme === "system") applySettings();
});
