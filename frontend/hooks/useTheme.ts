"use client";

import { useState, useEffect } from "react";

type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "theme";
const THEME_EVENT = "hackbet-theme-change";

function applyTheme(next: ThemeMode) {
  document.documentElement.classList.toggle("dark", next === "dark");
}

function readTheme(): ThemeMode {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  return saved === "light" ? "light" : "dark";
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeMode>("dark");

  useEffect(() => {
    const syncTheme = () => {
      const next = readTheme();
      setTheme(next);
      applyTheme(next);
    };

    syncTheme();
    window.addEventListener(THEME_EVENT, syncTheme);
    window.addEventListener("storage", syncTheme);

    return () => {
      window.removeEventListener(THEME_EVENT, syncTheme);
      window.removeEventListener("storage", syncTheme);
    };
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
    applyTheme(next);
    window.dispatchEvent(new Event(THEME_EVENT));
  }

  return { theme, toggle };
}
