import React, { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme?: () => void;
  switchable: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function getThemeKey(userId?: number | null) {
  return userId ? `theme_${userId}` : "theme";
}

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  switchable?: boolean;
  userId?: number | null; // 用户 ID，加载后传入以实现用户隔离
}

export function ThemeProvider({
  children,
  defaultTheme = "light",
  switchable = false,
  userId,
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (switchable) {
      const stored = localStorage.getItem(getThemeKey(userId));
      return (stored as Theme) || defaultTheme;
    }
    return defaultTheme;
  });

  // 用户加载后，重新读取该用户的主题偏好
  useEffect(() => {
    if (switchable && userId) {
      const stored = localStorage.getItem(getThemeKey(userId));
      if (stored) setTheme(stored as Theme);
    }
  }, [userId, switchable]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    if (switchable) {
      localStorage.setItem(getThemeKey(userId), theme);
    }
  }, [theme, switchable, userId]);

  const toggleTheme = switchable
    ? () => {
        setTheme(prev => (prev === "light" ? "dark" : "light"));
      }
    : undefined;

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, switchable }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
