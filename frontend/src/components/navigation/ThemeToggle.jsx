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

    const activeIndex = Math.max(0, options.findIndex((opt) => opt.id === theme));
    const pillTranslate = activeIndex === 2 ? 'calc(200% + 4px)' : activeIndex === 1 ? 'calc(100% + 2px)' : '0%';

    return (
      <div
        role="group"
        aria-label="Theme mode selector"
        className={`relative inline-grid grid-cols-3 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700/80 ${className}`}
      >
        {/* iOS Spring Sliding Active Pill Indicator */}
        <span
          aria-hidden="true"
          className="absolute top-1 bottom-1 left-1 w-[calc(33.333%-2.67px)] rounded-lg bg-white dark:bg-slate-900 shadow-2xs transition-transform duration-350 ease-[cubic-bezier(0.34,1.4,0.64,1)] pointer-events-none"
          style={{ transform: `translate3d(${pillTranslate}, 0, 0)` }}
        />
        {options.map((opt) => {
          const active = theme === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={(e) => setTheme(opt.id, e)}
              className={`relative z-10 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors duration-200 cursor-pointer select-none active:scale-[0.93] ${
                active
                  ? 'text-slate-900 dark:text-slate-100 font-bold'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <i
                key={`${opt.id}-${active}`}
                className={`ti ${opt.icon} text-sm transition-transform duration-200 ${active ? 'theme-icon-ios text-accent scale-110' : ''}`}
                aria-hidden="true"
              />
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
      className={`group relative inline-flex items-center justify-center h-8 sm:h-9 px-2 sm:px-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#172033] text-slate-700 dark:text-slate-200 shadow-2xs hover:bg-slate-50 dark:hover:bg-[#1f2c47] active:scale-[0.93] transition-all duration-150 cursor-pointer select-none gap-1.5 shrink-0 overflow-hidden ${className}`}
    >
      <i
        key={theme}
        className={`ti ${currentConfig.icon} theme-icon-ios text-base text-accent transition-transform duration-300 ease-out group-hover:rotate-12`}
        aria-hidden="true"
      />
      <span
        key={theme}
        className="hidden sm:inline theme-badge-ios text-xs font-semibold tabular-nums text-slate-600 dark:text-slate-300"
      >
        {currentConfig.badge}
      </span>
    </button>
  );
};

export default React.memo(ThemeToggle);
