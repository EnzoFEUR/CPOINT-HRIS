import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';

/**
 * Enterprise ActionMenu Component
 * Provides a clean, accessible, zero-lag 3-dot dropdown menu for secondary actions.
 * Prevents row click propagation and automatically closes on outside click or Escape.
 */
export default function ActionMenu({
    items = [],
    align = 'right', // 'right' | 'left'
    triggerClassName = '',
    menuClassName = '',
    title = 'More options',
}) {
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef(null);

    const toggleOpen = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(prev => !prev);
    }, []);

    const closeMenu = useCallback(() => {
        setIsOpen(false);
    }, []);

    useEffect(() => {
        if (!isOpen) return;

        const handleClickOutside = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                closeMenu();
            }
        };

        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                closeMenu();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen, closeMenu]);

    return (
        <div className="relative inline-block text-left" ref={menuRef}>
            <button
                type="button"
                onClick={toggleOpen}
                className={`h-8 w-8 p-0 flex items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:text-slate-950 hover:bg-slate-50 active:bg-slate-100 transition-colors duration-100 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-950 disabled:opacity-50 disabled:pointer-events-none ${triggerClassName}`}
                title={title}
                aria-haspopup="true"
                aria-expanded={isOpen}
            >
                <i className="ti ti-dots text-base block" />
            </button>

            {isOpen && (
                <div
                    className={`absolute z-50 ${align === 'right' ? 'right-0' : 'left-0'} mt-1 w-48 rounded-md bg-white border border-slate-200 shadow-md p-1 animate-in fade-in duration-100 ${menuClassName}`}
                    role="menu"
                    aria-orientation="vertical"
                >
                    {items.map((item, index) => {
                        if (item.divider) {
                            return <div key={`divider-${index}`} className="my-1 border-t border-slate-100" />;
                        }

                        const content = (
                            <>
                                {item.icon && (
                                    <i className={`ti ${item.icon} text-sm shrink-0 ${item.destructive ? 'text-rose-600' : 'text-slate-400 group-hover:text-slate-600'}`} />
                                )}
                                <span className="flex-1 truncate">{item.label}</span>
                                {item.badge && (
                                    <span className={`text-[10px] font-mono px-1 py-0.2 rounded-xs border ${item.badgeClass || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                                        {item.badge}
                                    </span>
                                )}
                            </>
                        );

                        const commonClasses = `h-8 w-full text-left px-2 text-xs font-medium rounded-sm flex items-center gap-2 transition-colors duration-100 group cursor-pointer ${
                            item.destructive
                                ? 'text-rose-600 hover:bg-rose-50 hover:text-rose-700'
                                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-950'
                        }`;

                        if (item.to) {
                            return (
                                <Link
                                    key={item.label || index}
                                    to={item.to}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        closeMenu();
                                        item.onClick?.(e);
                                    }}
                                    className={commonClasses}
                                    role="menuitem"
                                >
                                    {content}
                                </Link>
                            );
                        }

                        return (
                            <button
                                key={item.label || index}
                                type="button"
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    closeMenu();
                                    item.onClick?.(e);
                                }}
                                disabled={item.disabled}
                                className={`${commonClasses} ${item.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                                role="menuitem"
                            >
                                {content}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
