import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isAdmin } from '../../routes/guards';
import { fetchWithAuth } from '../../utils/api';
import EmployeeAvatar from '../EmployeeAvatar';
import { matchLocalIntent } from './localSemanticMatcher';

/* -------------------------------------------------------------------------- */
/* Constants & helpers                                                         */
/* -------------------------------------------------------------------------- */

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 280;
const MAX_PEOPLE = 4;

const EMPLOYEES_QUERY = {
  queryKey: ['adminEmployees'],
  staleTime: 60_000,
  gcTime: 300_000,
};

const IS_MAC =
  typeof navigator !== 'undefined' &&
  /mac|iphone|ipad/i.test(navigator.userAgentData?.platform || navigator.platform || '');

const SURFACE =
  'rounded-xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05)] ring-1 ring-slate-900/[0.04]';

async function fetchEmployees() {
  try {
    const res = await fetchWithAuth('/api/employees');
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json) ? json : json.data || [];
  } catch {
    return [];
  }
}

// Lowercase and strip diacritics so "nino" matches "Niño" and "munoz" matches "Muñoz".
const fold = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

// Routes can come from model output. Only allow in-app paths.
const isInternalRoute = (route) =>
  typeof route === 'string' && route.startsWith('/') && !route.startsWith('//');

const fullName = (emp) => `${emp.first_name || ''} ${emp.last_name || ''}`.trim();
const employeeCode = (emp) => `#${String(emp.company_id || emp.id).substring(0, 10)}`;

/* -------------------------------------------------------------------------- */
/* AI request lifecycle & Client Cache (Super-Tipid Architecture)              */
/* -------------------------------------------------------------------------- */

const EMPTY_RESULT = { query: '', data: null, ms: null };

// In-Memory Client Session Cache (Prevents redundant HTTP calls & preserves API quota)
const clientAiCache = new Map();
const MAX_CLIENT_CACHE = 100;

function useAiOmnibar(isAdminUser = false) {
  const [result, setResult] = useState(EMPTY_RESULT);
  const [isLoading, setIsLoading] = useState(false);
  const timerRef = useRef(null);
  const controllerRef = useRef(null);

  const cancelPending = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
    }
  }, []);

  const run = useCallback(async (query) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setIsLoading(true);
    const startedAt = performance.now();

    const cacheKey = `${isAdminUser ? 'admin' : 'emp'}_${query.toLowerCase()}`;
    if (clientAiCache.has(cacheKey)) {
      setResult({
        query,
        data: clientAiCache.get(cacheKey),
        ms: 0,
      });
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetchWithAuth('/api/ai/omnibar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: controller.signal,
      });
      const json = await res.json();
      if (controller.signal.aborted) return;

      const aiData = res.ok && json?.success && json.data ? json.data : null;
      if (aiData) {
        if (clientAiCache.size >= MAX_CLIENT_CACHE) {
          const oldestKey = clientAiCache.keys().next().value;
          clientAiCache.delete(oldestKey);
        }
        clientAiCache.set(cacheKey, aiData);
      }

      setResult({
        query,
        data: aiData,
        ms: Math.round(performance.now() - startedAt),
      });
    } catch (err) {
      if (controller.signal.aborted || err?.name === 'AbortError') return;
      console.warn('[AI_OMNIBAR] Query error:', err?.message);
      setResult({ query, data: null, ms: null });
    } finally {
      // Only the request that is still current may clear the loading flag.
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setIsLoading(false);
      }
    }
  }, [isAdminUser]);

  const schedule = useCallback(
    (query) => {
      cancelPending();

      // Layer-0 Local Semantic Match (0ms perceived latency, 0 Gemini tokens)
      const localMatch = matchLocalIntent(query, isAdminUser);
      if (localMatch) {
        setIsLoading(false);
        setResult({
          query,
          data: localMatch,
          ms: 0,
        });
        return;
      }

      // Check client-side in-memory session cache (0ms perceived latency, 0 Gemini tokens)
      const cacheKey = `${isAdminUser ? 'admin' : 'emp'}_${query.toLowerCase()}`;
      if (clientAiCache.has(cacheKey)) {
        setIsLoading(false);
        setResult({
          query,
          data: clientAiCache.get(cacheKey),
          ms: 0,
        });
        return;
      }

      // Layer-1 Fallback: Debounce and query backend Gemini Brain with sliding-window protection
      setIsLoading(true);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        run(query);
      }, DEBOUNCE_MS);
    },
    [cancelPending, isAdminUser, run],
  );

  const flush = useCallback(
    (query) => {
      cancelPending();

      // Check Layer-0 Local Match first
      const localMatch = matchLocalIntent(query, isAdminUser);
      if (localMatch) {
        setIsLoading(false);
        setResult({
          query,
          data: localMatch,
          ms: 0,
        });
        return;
      }

      // Check Client Cache
      const cacheKey = `${isAdminUser ? 'admin' : 'emp'}_${query.toLowerCase()}`;
      if (clientAiCache.has(cacheKey)) {
        setIsLoading(false);
        setResult({
          query,
          data: clientAiCache.get(cacheKey),
          ms: 0,
        });
        return;
      }

      run(query);
    },
    [cancelPending, isAdminUser, run],
  );

  const reset = useCallback(() => {
    cancelPending();
    setIsLoading(false);
    setResult(EMPTY_RESULT);
  }, [cancelPending]);

  useEffect(() => cancelPending, [cancelPending]);

  return {
    data: result.data,
    query: result.query,
    ms: result.ms,
    isLoading,
    schedule,
    flush,
    reset,
  };
}

/* -------------------------------------------------------------------------- */
/* Presentational pieces                                                       */
/* -------------------------------------------------------------------------- */

const Kbd = ({ children, className = '' }) => (
  <kbd
    className={`inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-white px-1.5 font-sans text-[11px] font-medium leading-none text-slate-500 ring-1 ring-inset ring-slate-900/10 transition-colors duration-200 ${className}`}
  >
    {children}
  </kbd>
);

const Spinner = () => (
  <span
    aria-hidden="true"
    className="size-4 shrink-0 animate-spin rounded-full border-2 border-slate-200 border-t-accent"
  />
);

const ResultGroup = ({ id, label, children }) => (
  <div role="group" aria-labelledby={id} className="space-y-1.5">
    <div id={id} className="px-3 text-[13px] font-medium text-slate-500">
      {label}
    </div>
    <div className={`${SURFACE} p-1.5`}>{children}</div>
  </div>
);

const ResultRow = ({ item, id, selected, onHover, onSelect }) => {
  const isPerson = item.variant === 'person';
  const isPrimary = item.variant === 'primary';

  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      aria-disabled={item.stale || undefined}
      onMouseMove={onHover}
      onClick={() => onSelect(item)}
      className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-100 ${
        selected ? 'bg-accent-subtle' : ''
      } ${item.stale ? 'pointer-events-none opacity-50' : ''}`}
    >
      {isPerson ? (
        <EmployeeAvatar employee={item.employee} size="h-10 w-10" />
      ) : (
        <span
          className={`grid size-10 shrink-0 place-items-center rounded-lg transition-colors duration-100 ${
            isPrimary
              ? 'bg-accent text-white'
              : selected
                ? 'bg-white text-accent'
                : 'bg-slate-100 text-slate-600'
          }`}
        >
          <i className={`ti ${item.icon} text-[19px]`} aria-hidden="true" />
        </span>
      )}

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium leading-5 text-slate-900">
          {item.title}
        </span>
        {item.description && (
          <span className="mt-0.5 block truncate text-[13px] leading-[18px] text-slate-500">
            {item.description}
          </span>
        )}
      </span>

      {item.meta && (
        <span className="shrink-0 text-xs tabular-nums text-slate-400">{item.meta}</span>
      )}
      <span
        aria-hidden="true"
        className={`hidden shrink-0 transition-opacity duration-100 sm:inline-flex ${
          selected ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <Kbd>↵</Kbd>
      </span>
      <i
        className="ti ti-chevron-right shrink-0 text-base text-slate-300 sm:hidden"
        aria-hidden="true"
      />
    </div>
  );
};

const AnswerCard = ({ data, stale, ms }) => (
  <section
    aria-label="AI answer"
    aria-busy={stale}
    className={`${SURFACE} p-4 transition-opacity duration-150 sm:p-5 ${stale ? 'opacity-50' : ''}`}
  >
    <div className="flex items-center gap-2 text-[13px] font-medium text-slate-500">
      <span className="grid size-6 place-items-center rounded-md bg-accent text-white">
        <i className="ti ti-sparkles text-[13px]" aria-hidden="true" />
      </span>
      {data.is_local ? 'C-Point Copilot' : 'AI answer'}
    </div>

    {data.intent_title && (
      <h2 className="mt-3.5 text-[17px] font-semibold leading-snug tracking-tight text-slate-900">
        {data.intent_title}
      </h2>
    )}
    {data.ai_answer && (
      <p className="mt-1.5 whitespace-pre-line text-sm leading-6 text-slate-600">
        {data.ai_answer}
      </p>
    )}

    <div className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-400">
      <span>
        {data.is_local
          ? 'Instant local semantic match. Zero API tokens.'
          : 'Generated by Gemini. Check important details.'}
      </span>
      <span className="tabular-nums">
        {data.is_local ? 'Instant (0 ms)' : data.is_cached ? 'Cached' : ms != null ? `${ms} ms` : ''}
      </span>
    </div>
  </section>
);

const AnswerSkeleton = () => (
  <div
    aria-hidden="true"
    className={`${SURFACE} animate-pulse p-4 motion-reduce:animate-none sm:p-5`}
  >
    <div className="flex items-center gap-2">
      <div className="size-6 rounded-full bg-slate-200/60" />
      <div className="h-3 w-16 rounded-full bg-slate-200/60" />
    </div>
    <div className="mt-4 h-4 w-2/5 rounded-full bg-slate-200/60" />
    <div className="mt-3 space-y-2">
      <div className="h-3 w-full rounded-full bg-slate-200/60" />
      <div className="h-3 w-4/5 rounded-full bg-slate-200/60" />
    </div>
  </div>
);

const EmptyState = ({ canSearchPeople }) => (
  <div className="flex flex-col items-center px-6 py-14 text-center">
    <span className={`${SURFACE} grid size-12 place-items-center text-accent`}>
      <i className="ti ti-sparkles text-[22px]" aria-hidden="true" />
    </span>
    <h2 className="mt-4 text-[17px] font-semibold tracking-tight text-slate-900">
      C-Point Copilot
    </h2>
    <p className="mt-1 max-w-xs text-sm leading-5 text-slate-500">
      {canSearchPeople
        ? 'Ask in plain language, search personnel, or jump straight to a page.'
        : 'Ask in plain language or jump straight to a page.'}
    </p>
    <ul className="mt-5 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[13px] text-slate-400">
      <li>Payroll</li>
      <li>Attendance</li>
      <li>DOLE rules</li>
      <li>Employee records</li>
    </ul>
  </div>
);

const NoResults = ({ query }) => (
  <div className="flex flex-col items-center px-6 py-12 text-center">
    <span className="grid size-11 place-items-center rounded-lg bg-white text-slate-400 ring-1 ring-slate-900/[0.06]">
      <i className="ti ti-search-off text-xl" aria-hidden="true" />
    </span>
    <p className="mt-3 max-w-full break-words text-[15px] font-medium text-slate-800">
      No results for “{query}”
    </p>
    <p className="mt-1 max-w-xs text-[13px] leading-5 text-slate-500">
      Try different wording, or search by employee name or ID.
    </p>
  </div>
);

/* -------------------------------------------------------------------------- */
/* Main component                                                              */
/* -------------------------------------------------------------------------- */

export const GlobalSearch = ({ user }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef(null);
  const scrollRef = useRef(null);
  const keyboardNavRef = useRef(false);

  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const uid = useId();
  const listId = `${uid}-results`;
  const optionId = useCallback((index) => `${uid}-option-${index}`, [uid]);

  const userIsAdmin = Boolean(isAdmin(user));
  const trimmed = searchQuery.trim();
  const hasQuery = trimmed.length >= MIN_QUERY_LENGTH;

  const {
    data: aiData,
    query: aiQuery,
    ms: aiMs,
    isLoading: isAiLoading,
    schedule: scheduleAi,
    flush: flushAi,
    reset: resetAi,
  } = useAiOmnibar(userIsAdmin);

  // A result is stale while it answers an earlier version of the input.
  const isAiStale = Boolean(aiData) && aiQuery !== trimmed;

  /* ----------------------------- Personnel data ---------------------------- */

  const { data: employees = [] } = useQuery({
    ...EMPLOYEES_QUERY,
    queryFn: fetchEmployees,
    enabled: userIsAdmin && isOpen,
  });

  // Warm the cache when the trigger is hovered or focused so the first keystroke is instant.
  const prefetchEmployees = useCallback(() => {
    if (userIsAdmin) {
      queryClient.prefetchQuery({ ...EMPLOYEES_QUERY, queryFn: fetchEmployees });
    }
  }, [userIsAdmin, queryClient]);

  const employeeIndex = useMemo(
    () =>
      employees.map((emp) => {
        const name = fold(fullName(emp));
        return {
          emp,
          words: name.split(/\s+/),
          haystack: fold(
            [fullName(emp), emp.company_id, emp.department, emp.job_title]
              .filter(Boolean)
              .join(' '),
          ),
        };
      }),
    [employees],
  );

  const matchingEmployees = useMemo(() => {
    if (!userIsAdmin || !hasQuery) return [];
    const tokens = fold(trimmed).split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];

    const hits = [];
    for (const entry of employeeIndex) {
      if (!tokens.every((token) => entry.haystack.includes(token))) continue;
      const rank = entry.words.some((word) => word.startsWith(tokens[0])) ? 0 : 1;
      hits.push({ emp: entry.emp, rank });
    }
    return hits
      .sort((a, b) => a.rank - b.rank)
      .slice(0, MAX_PEOPLE)
      .map((hit) => hit.emp);
  }, [employeeIndex, trimmed, hasQuery, userIsAdmin]);

  /* ----------------------------- Selectable items --------------------------- */

  // One ordered list drives rendering, keyboard navigation and aria-activedescendant,
  // so visual order and keyboard order can never diverge.
  const { items, primary, related, people } = useMemo(() => {
    const list = [];
    const push = (item) => {
      const entry = { ...item, index: list.length };
      list.push(entry);
      return entry;
    };

    const primaryAction = aiData?.primary_action;
    const primaryItems = isInternalRoute(primaryAction?.route)
      ? [
          push({
            id: 'ai-primary',
            variant: 'primary',
            stale: isAiStale,
            route: primaryAction.route,
            title: primaryAction.title,
            description: primaryAction.description,
            icon: primaryAction.icon || 'ti-bolt',
          }),
        ]
      : [];

    const suggested = Array.isArray(aiData?.suggested_actions) ? aiData.suggested_actions : [];
    const relatedItems = suggested
      .filter((act) => isInternalRoute(act?.route) && act.route !== primaryAction?.route)
      .map((act, i) =>
        push({
          id: `ai-related-${i}`,
          variant: 'related',
          stale: isAiStale,
          route: act.route,
          title: act.title,
          description: act.description,
          icon: act.icon || 'ti-arrow-right',
        }),
      );

    const peopleItems = matchingEmployees.map((emp) =>
      push({
        id: `emp-${emp.id}`,
        variant: 'person',
        stale: false,
        route: `/admin/employees/${emp.id}`,
        title: fullName(emp),
        description: [emp.job_title || 'Staff', emp.department].filter(Boolean).join(', '),
        meta: employeeCode(emp),
        employee: emp,
      }),
    );

    return { items: list, primary: primaryItems, related: relatedItems, people: peopleItems };
  }, [aiData, isAiStale, matchingEmployees]);

  const activeIndex = items.length > 0 ? Math.min(selectedIndex, items.length - 1) : -1;

  /* -------------------------------- Handlers -------------------------------- */

  const closePalette = useCallback(() => setIsOpen(false), []);

  const handleSelect = useCallback(
    (item) => {
      if (!item?.route) return;
      navigate(item.route);
      setIsOpen(false);
    },
    [navigate],
  );

  const handleInputChange = (event) => {
    const value = event.target.value.slice(0, 250);
    setSearchQuery(value);
    setSelectedIndex(0);
    scrollRef.current?.scrollTo({ top: 0 });

    if (value.trim().length < MIN_QUERY_LENGTH) resetAi();
    else scheduleAi(value.trim());
  };

  const handleClear = () => {
    setSearchQuery('');
    setSelectedIndex(0);
    resetAi();
    inputRef.current?.focus();
  };

  const handleKeyDown = (event) => {
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        closePalette();
        break;

      case 'Tab':
        // The palette is a single-field dialog; keep focus on the input.
        event.preventDefault();
        inputRef.current?.focus();
        break;

      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (items.length === 0) break;
        const step = event.key === 'ArrowDown' ? 1 : -1;
        keyboardNavRef.current = true;
        setSelectedIndex((activeIndex + step + items.length) % items.length);
        break;
      }

      case 'Enter': {
        if (event.nativeEvent.isComposing || event.target instanceof HTMLButtonElement) break;
        event.preventDefault();
        if (items[activeIndex]) handleSelect(items[activeIndex]);
        else if (hasQuery) flushAi(trimmed);
        break;
      }

      default:
        break;
    }
  };

  /* --------------------------------- Effects -------------------------------- */

  // Ctrl/Cmd + K toggles the palette from anywhere.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'k'
      ) {
        event.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Focus the input on open and hand focus back to the previous element on close.
  useEffect(() => {
    if (!isOpen) return undefined;
    const previouslyFocused = document.activeElement;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [isOpen]);

  // Lock page scroll while open, restoring whatever value was set before.
  useEffect(() => {
    if (!isOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  // Start clean every time the palette closes.
  useEffect(() => {
    if (isOpen) return;
    setSearchQuery('');
    setSelectedIndex(0);
    resetAi();
  }, [isOpen, resetAi]);

  // New AI results restart selection at the top.
  useEffect(() => {
    setSelectedIndex(0);
  }, [aiData]);

  // Keep the keyboard-selected row visible. Pointer hover never scrolls.
  useEffect(() => {
    if (!isOpen || activeIndex < 0 || !keyboardNavRef.current) return;
    keyboardNavRef.current = false;
    if (activeIndex === 0) {
      scrollRef.current?.scrollTo({ top: 0 });
      return;
    }
    document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: 'nearest' });
  }, [isOpen, activeIndex, optionId]);

  // Close when the route changes.
  useEffect(() => {
    setIsOpen(false);
  }, [location.pathname]);

  /* --------------------------------- Render --------------------------------- */

  const renderRow = (item) => (
    <ResultRow
      key={item.id}
      item={item}
      id={optionId(item.index)}
      selected={item.index === activeIndex}
      onHover={() => {
        if (item.index !== activeIndex) setSelectedIndex(item.index);
      }}
      onSelect={handleSelect}
    />
  );

  const showSkeleton = hasQuery && isAiLoading && !aiData;
  const showNoResults = hasQuery && !isAiLoading && !aiData && items.length === 0;

  let statusText = '';
  if (hasQuery) {
    if (isAiLoading) statusText = 'Searching';
    else if (items.length > 0) statusText = `${items.length} results available`;
    else statusText = 'No results';
  }

  const placeholder = userIsAdmin ? 'Search people or ask a question' : 'Ask a question or search';

  return (
    <>
      {/* Header trigger, desktop and tablet */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        onMouseEnter={prefetchEmployees}
        onFocus={prefetchEmployees}
        aria-label="Open search"
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+K Meta+K"
        className="group hidden h-9 w-56 md:flex md:w-60 lg:w-72 items-center gap-2.5 rounded-md border border-slate-200 bg-slate-50/90 pl-3 pr-2 text-left text-xs text-slate-500 shadow-2xs cursor-pointer transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:w-72 md:hover:w-80 lg:hover:w-96 hover:border-accent/70 hover:bg-white hover:shadow-xs hover:ring-2 hover:ring-accent/10 focus-visible:w-72 md:focus-visible:w-80 lg:focus-visible:w-96 focus-visible:border-accent focus-visible:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20 motion-reduce:transition-none"
      >
        <span className="grid size-5 place-items-center rounded text-slate-400 transition-all duration-200 group-hover:scale-110 group-hover:text-accent">
          <i className="ti ti-search text-base" aria-hidden="true" />
        </span>
        <span className="flex-1 truncate font-medium text-slate-500 transition-colors duration-200 group-hover:text-slate-900">
          Search or ask AI
        </span>
        <span className="flex items-center gap-0.5 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true">
          <Kbd className="group-hover:border-slate-300 group-hover:bg-slate-50 group-hover:text-slate-700">{IS_MAC ? '⌘' : 'Ctrl'}</Kbd>
          <Kbd className="group-hover:border-slate-300 group-hover:bg-slate-50 group-hover:text-slate-700">K</Kbd>
        </span>
      </button>

      {/* Header trigger, mobile */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label="Open search"
        aria-haspopup="dialog"
        className="grid size-9 place-items-center rounded-md border border-slate-200 bg-white text-slate-600 shadow-2xs transition-all duration-200 hover:border-accent hover:bg-slate-50 hover:text-accent active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 md:hidden"
      >
        <i className="ti ti-search text-base" aria-hidden="true" />
      </button>

      {isOpen &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-start justify-center px-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-4 sm:pt-[10vh]">
            <div
              aria-hidden="true"
              onClick={closePalette}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-[6px] transition-opacity duration-200 starting:opacity-0 motion-reduce:transition-none"
            />

            <div
              role="dialog"
              aria-modal="true"
              aria-label="Search and AI assistant"
              tabIndex={-1}
              onKeyDown={handleKeyDown}
              className="relative z-10 flex max-h-[min(40rem,calc(100dvh-1.5rem))] w-full max-w-[40rem] flex-col overflow-hidden rounded-xl bg-slate-100 shadow-[0_32px_80px_-16px_rgba(15,23,42,0.35),0_0_0_1px_rgba(15,23,42,0.08)] outline-none transition duration-200 ease-out starting:translate-y-1 starting:scale-[0.985] starting:opacity-0 motion-reduce:transition-none"
            >
              {/* Search field */}
              <div className="flex items-center gap-3 p-3 pb-2 sm:p-4 sm:pb-3">
                <div className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-lg bg-white pl-4 pr-2 ring-1 ring-slate-900/[0.06] transition-shadow focus-within:ring-2 focus-within:ring-accent/40">
                  <i className="ti ti-search text-xl text-slate-400" aria-hidden="true" />
                  <input
                    ref={inputRef}
                    type="text"
                    role="combobox"
                    aria-label="Search or ask AI"
                    maxLength={250}
                    aria-expanded={items.length > 0}
                    aria-controls={items.length > 0 ? listId : undefined}
                    aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
                    aria-autocomplete="list"
                    value={searchQuery}
                    onChange={handleInputChange}
                    placeholder={placeholder}
                    enterKeyHint="search"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    className="h-full min-w-0 flex-1 bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400"
                  />
                  {isAiLoading && <Spinner />}
                  {searchQuery ? (
                    <button
                      type="button"
                      onClick={handleClear}
                      tabIndex={-1}
                      aria-label="Clear search"
                      className="grid size-8 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700"
                    >
                      <i className="ti ti-x text-sm" aria-hidden="true" />
                    </button>
                  ) : (
                    <span className="mr-1 hidden sm:inline-flex" aria-hidden="true">
                      <Kbd>Esc</Kbd>
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={closePalette}
                  className="shrink-0 px-1 text-[15px] font-medium text-accent sm:hidden"
                >
                  Cancel
                </button>
              </div>

              <p role="status" aria-live="polite" className="sr-only">
                {statusText}
              </p>

              {/* Results */}
              <div
                ref={scrollRef}
                className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 pb-3 sm:px-4 sm:pb-4 no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
              >
                {showSkeleton && <AnswerSkeleton />}
                {hasQuery && aiData && <AnswerCard data={aiData} stale={isAiStale} ms={aiMs} />}

                {items.length > 0 && (
                  <div
                    id={listId}
                    role="listbox"
                    aria-label="Results"
                    onMouseDown={(event) => event.preventDefault()}
                    className="space-y-4"
                  >
                    {primary.length > 0 && (
                      <ResultGroup id={`${uid}-g-primary`} label="Suggested action">
                        {primary.map(renderRow)}
                      </ResultGroup>
                    )}
                    {related.length > 0 && (
                      <ResultGroup id={`${uid}-g-related`} label="Related">
                        {related.map(renderRow)}
                      </ResultGroup>
                    )}
                    {people.length > 0 && (
                      <ResultGroup id={`${uid}-g-people`} label="People">
                        {people.map(renderRow)}
                      </ResultGroup>
                    )}
                  </div>
                )}

                {showNoResults && <NoResults query={trimmed} />}

                {trimmed.length > 0 && !hasQuery && (
                  <p className="px-6 py-10 text-center text-[13px] text-slate-500">
                    Keep typing to search.
                  </p>
                )}

                {!trimmed && <EmptyState canSearchPeople={userIsAdmin} />}
              </div>

              {/* Keyboard hints, hidden on touch layouts */}
              <div
                aria-hidden="true"
                className="hidden items-center gap-5 border-t border-slate-200 px-5 py-2.5 text-xs text-slate-500 sm:flex"
              >
                <span className="flex items-center gap-1.5">
                  <Kbd>↑</Kbd>
                  <Kbd>↓</Kbd>
                  Navigate
                </span>
                <span className="flex items-center gap-1.5">
                  <Kbd>↵</Kbd>
                  Open
                </span>
                <span className="flex items-center gap-1.5">
                  <Kbd>Esc</Kbd>
                  Close
                </span>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
};

export default React.memo(GlobalSearch);