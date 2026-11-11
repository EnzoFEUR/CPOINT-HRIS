import React from 'react';
import { useTheme } from '../../utils/useTheme';

/**
 * Enterprise Production ThemeToggle
 * Supports:
 * - 'switch' (default): Tactile Sun/Moon spring switch with stretching knob, 360-deg rotating face, stars & clouds.
 * - 'segmented': Segmented 3-state control with spring-sliding pill.
 * - 'compact': Minimal icon button with spring morph.
 */
export const ThemeToggle = ({ variant = 'switch', className = '' }) => {
  const { theme, setTheme, cycleTheme, isDark } = useTheme();

  // 1. Tactile Sun / Moon Spring Switch
  if (variant === 'switch') {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={isDark}
        aria-label="Toggle dark mode appearance"
        title={`Appearance: ${isDark ? 'Dark Mode' : 'Light Mode'} (Click to toggle)`}
        onClick={(e) => {
          const next = isDark ? 'light' : 'dark';
          setTheme(next, e.currentTarget);
        }}
        className={`theme-switch ${className}`}
      >
        {/* Sky Backgrounds */}
        <span className="sky day" aria-hidden="true" />
        <span className="sky night" aria-hidden="true" />

        {/* Clouds in Day Sky */}
        <span className="clouds" aria-hidden="true" />

        {/* Stars in Night Sky */}
        <span className="stars" aria-hidden="true">
          <i /><i /><i /><i />
        </span>

        {/* Elastic Stretching Knob with Rotating Face */}
        <span className="knob" aria-hidden="true">
          <span className="face">
            <svg
              className="icon-sun w-3.5 h-3.5 text-amber-500 fill-amber-400 stroke-amber-500"
              viewBox="0 0 24 24"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
            </svg>
            <svg
              className="icon-moon w-3.5 h-3.5 text-slate-700 dark:text-slate-300 fill-slate-300 dark:fill-slate-300 stroke-slate-700 dark:stroke-slate-300"
              viewBox="0 0 24 24"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
            </svg>
          </span>
        </span>
      </button>
    );
  }

  // 2. Segmented Control with Spring-Sliding Pill
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
              onClick={(e) => setTheme(opt.id, e.currentTarget)}
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

  // 3. Compact Header Toggle Button
  const currentConfig = {
    system: { icon: 'ti-device-desktop', label: 'System Theme (Auto)', badge: 'Auto' },
    dark: { icon: 'ti-moon', label: 'Dark Mode', badge: 'Dark' },
    light: { icon: 'ti-sun', label: 'Light Mode', badge: 'Light' },
  }[theme] || { icon: 'ti-device-desktop', label: 'Theme', badge: 'Theme' };

  return (
    <button
      type="button"
      onClick={(e) => cycleTheme(e.currentTarget)}
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
