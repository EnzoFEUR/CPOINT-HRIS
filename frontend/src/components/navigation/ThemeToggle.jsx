import React from 'react';
import { useTheme } from '../../utils/useTheme';

/**
 * Enterprise Production ThemeToggle
 * Supports compact header icon button and segmented control layout,
 * aligned with C-Point HRIS design tokens and Tabler icons.
 */
export const ThemeToggle = ({ variant = 'compact', className = '' }) => {
  const { theme, setTheme, cycleTheme, isDark } = useTheme();

  if (variant === 'segmented') {
    const options = [
      { id: 'light', label: 'Light', icon: 'ti-sun' },
      { id: 'system', label: 'System', icon: 'ti-device-desktop' },
      { id: 'dark', label: 'Dark', icon: 'ti-moon' },
    ];

    return (
      <div
        role="group"
        aria-label="Theme mode selector"
        className={`inline-flex items-center p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700/80 ${className}`}
      >
        {options.map((opt) => {
          const active = theme === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={(e) => setTheme(opt.id, e)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 cursor-pointer select-none active:scale-95 ${
                active
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xs font-bold'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <i className={`ti ${opt.icon} text-sm transition-transform duration-200 ${active ? 'text-accent scale-110' : ''}`} aria-hidden="true" />
              <span>{opt.label}</span>
            </button>
          );
        })}
      </div>
    );
  }

  // Compact Header toggle
  const currentConfig = {
    system: { icon: 'ti-device-desktop', label: 'System Theme (Auto)', badge: 'Auto' },
    dark: { icon: 'ti-moon', label: 'Dark Mode', badge: 'Dark' },
    light: { icon: 'ti-sun', label: 'Light Mode', badge: 'Light' },
  }[theme] || { icon: 'ti-device-desktop', label: 'Theme', badge: 'Theme' };

  return (
    <button
      type="button"
      onClick={(e) => cycleTheme(e)}
      aria-label={`Current appearance: ${currentConfig.label}. Click to toggle theme.`}
      title={`Appearance: ${currentConfig.label} (Click to toggle)`}
      className={`group relative inline-flex items-center justify-center h-8 sm:h-9 px-2 sm:px-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#172033] text-slate-700 dark:text-slate-200 shadow-2xs hover:bg-slate-50 dark:hover:bg-[#1f2c47] active:scale-[0.97] transition-all duration-150 cursor-pointer select-none gap-1.5 shrink-0 overflow-hidden ${className}`}
    >
      <i
        key={theme}
        className={`ti ${currentConfig.icon} text-base text-accent transition-transform duration-300 ease-out group-hover:rotate-12 group-active:scale-90`}
        aria-hidden="true"
      />
      <span className="hidden sm:inline text-xs font-semibold tabular-nums text-slate-600 dark:text-slate-300 transition-colors duration-200">
        {currentConfig.badge}
      </span>
    </button>
  );
};

export default React.memo(ThemeToggle);
