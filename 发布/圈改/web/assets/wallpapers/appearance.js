export const APPEARANCE_DEFAULTS = Object.freeze({
  blur: 0, brightness: 100, saturation: 100, dim: 12,
  glassOpacity: 65, glassBlur: 18, fit: "cover", flip: false,
});

export const PLAYBACK_DEFAULTS = Object.freeze({
  animated: !matchMedia("(prefers-reduced-motion: reduce)").matches,
  speed: 1, volume: 0, fps: 30, pauseWhenBlurred: true,
  rotation: false, interval: 300, shuffle: false,
});

const bounds = {
  blur: [0, 24], brightness: [50, 150], saturation: [0, 150], dim: [0, 65],
  glassOpacity: [45, 85], glassBlur: [0, 32], speed: [0.5, 2], volume: [0, 100],
  interval: [30, 3600],
};

export function normalizeSettings(defaults, saved) {
  const result = { ...defaults };
  for (const key of Object.keys(defaults)) {
    const value = saved?.[key];
    if (bounds[key] && Number.isFinite(value)) {
      result[key] = Math.min(bounds[key][1], Math.max(bounds[key][0], value));
    } else if (typeof defaults[key] === "boolean" && typeof value === "boolean") {
      result[key] = value;
    }
  }
  if (["cover", "contain", "stretch"].includes(saved?.fit)) result.fit = saved.fit;
  if ([30, 60].includes(saved?.fps)) result.fps = saved.fps;
  return result;
}

export function applyAppearance(settings) {
  const style = document.documentElement.style;
  style.setProperty("--wallpaper-filter", `blur(${settings.blur}px) brightness(${settings.brightness}%) saturate(${settings.saturation}%)`);
  style.setProperty("--wallpaper-dim", String(settings.dim / 100));
  style.setProperty("--wallpaper-scale", settings.blur ? "1.05" : "1");
  style.setProperty("--wallpaper-flip", settings.flip ? "-1" : "1");
  style.setProperty("--wallpaper-fit", settings.fit === "stretch" ? "fill" : settings.fit);
  style.setProperty("--glass-surface", `rgb(249 253 247 / ${settings.glassOpacity}%)`);
  style.setProperty("--wallpaper-glass-blur", `${settings.glassBlur}px`);
}
