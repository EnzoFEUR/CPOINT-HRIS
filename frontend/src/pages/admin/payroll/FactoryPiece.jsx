import React, { useState, useMemo, useEffect, useRef } from 'react';
import { matchJobTitle } from './Create';

export default function FactoryPiece({
    isOpen,
    onClose,
    onSave,
    availableGroups = [],
    selectedGroup,
    handleGroupTabChange,
    factoryEmployees = [],
    activeGroupEmployees = [],
    grandTotalFactoryPayout = 0,
    factoryRows = [],
    setFactoryRows,
    computedFactoryRows = []
}) {
    const [localRows, setLocalRows] = useState(factoryRows);
    const draftsRef = useRef({});

    // Reset session drafts when modal opens or closes
    useEffect(() => {
        if (!isOpen) {
            draftsRef.current = {};
        }
    }, [isOpen]);

    useEffect(() => {
        if (isOpen) {
            if (selectedGroup && draftsRef.current[selectedGroup]) {
                setLocalRows(draftsRef.current[selectedGroup]);
            } else {
                setLocalRows(factoryRows);
            }
        }
    }, [isOpen, selectedGroup, factoryRows]);

    const activeGroupSet = useMemo(() => new Set(activeGroupEmployees.map(e => String(e.id))), [activeGroupEmployees]);

    const activeComputedRows = useMemo(() => {
        return localRows.map(row => {
            const qty = parseFloat(row.quantity_in) || 0;
            const amt = parseFloat(row.amount) || 0;
            const totalPrice = qty * amt;

            const rawAssigned = Array.isArray(row.assignedEmployeeIds) ? row.assignedEmployeeIds : [];
            const groupAssignedIds = rawAssigned.filter(id => activeGroupSet.has(String(id)));

            let effectiveAssignedIds = [];

            if (row.isExplicitlyEmpty) {
                effectiveAssignedIds = [];
            } else if (groupAssignedIds.length > 0) {
                effectiveAssignedIds = groupAssignedIds;
            } else {
                const jobMatchedEmployees = activeGroupEmployees.filter(emp => {
                    const empJobTitle = emp.job_title || emp.position || '';
                    return matchJobTitle(empJobTitle, row.operation);
                });
                effectiveAssignedIds = jobMatchedEmployees.map(e => String(e.id));
            }

            return {
                ...row,
                qty,
                amt,
                totalPrice,
                effectiveAssignedIds,
                perWorkerShare: effectiveAssignedIds.length > 0 ? totalPrice / effectiveAssignedIds.length : 0
            };
        });
    }, [localRows, activeGroupEmployees, activeGroupSet]);

    const displayTotalPayout = useMemo(() => {
        if (!selectedGroup) return 0;
        return activeComputedRows.reduce((sum, r) => sum + r.totalPrice, 0);
    }, [activeComputedRows, selectedGroup]);

    const [isOpAssignModalOpen, setIsOpAssignModalOpen] = useState(false);
    const [currentOpRowId, setCurrentOpRowId] = useState(null);
    const [opWorkerSearch, setOpWorkerSearch] = useState('');

    // HR Layout View State: 'compact' | 'grid'
    const [viewMode, setViewMode] = useState('compact');

    // Close modal WITHOUT saving (discards in-memory session drafts)
    const handleClose = (e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        draftsRef.current = {};
        setLocalRows(factoryRows);
        if (onClose) {
            onClose();
        }
    };

    // Explicitly commit changes to database and close modal
    const handleSaveAndClose = async (e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }

        const drafts = { ...draftsRef.current };
        if (selectedGroup) {
            drafts[selectedGroup] = localRows;
        }

        if (onSave) {
            const otherEntries = Object.entries(drafts).filter(([grp]) => grp !== selectedGroup);
            for (const [grpName, rows] of otherEntries) {
                await onSave(rows, false, grpName);
            }
            await onSave(localRows, true, selectedGroup);
        } else if (onClose) {
            onClose();
        }

        draftsRef.current = {};
    };

    // Close on Escape key without saving
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                if (isOpAssignModalOpen) {
                    setIsOpAssignModalOpen(false);
                } else {
                    handleClose();
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, isOpAssignModalOpen, factoryRows]);

    // Updates row value, auto-syncing Stock No. and Quantity IN across all rows locally
    const handleFactoryRowChange = (id, field, value) => {
        setLocalRows(prev => prev.map(row => {
            if (field === 'stock_no' || field === 'quantity_in') {
                return { ...row, [field]: value };
            }
            return String(row.id) === String(id) ? { ...row, [field]: value } : row;
        }));
    };

    const addFactoryRow = () => {
        const lastRow = localRows[localRows.length - 1];
        const defaultStock = lastRow ? lastRow.stock_no : 'Formal';
        const defaultQty = lastRow ? lastRow.quantity_in : '';

        setLocalRows(prev => [
            ...prev,
            {
                id: Date.now(),
                operation: '',
                stock_no: defaultStock,
                quantity_in: defaultQty,
                amount: '0.00',
                assignedEmployeeIds: []
            }
        ]);
    };

    const removeFactoryRow = (id) => {
        if (localRows.length <= 1) return;
        setLocalRows(prev => prev.filter(row => String(row.id) !== String(id)));
    };

    const openOpWorkerModal = (rowId) => {
        setCurrentOpRowId(rowId);
        setOpWorkerSearch('');
        setIsOpAssignModalOpen(true);
    };

    const activeOpRow = useMemo(() => {
        return activeComputedRows.find(r => String(r.id) === String(currentOpRowId)) || null;
    }, [activeComputedRows, currentOpRowId]);

    const toggleOpWorker = (empId) => {
        if (!currentOpRowId) return;
        const idStr = String(empId);

        setLocalRows(prev => prev.map(row => {
            if (String(row.id) !== String(currentOpRowId)) return row;
            const baseIds = (Array.isArray(row.assignedEmployeeIds) && row.assignedEmployeeIds.length > 0)
                ? row.assignedEmployeeIds
                : (row.isExplicitlyEmpty ? [] : (activeOpRow ? activeOpRow.effectiveAssignedIds : []));
            const nextIds = baseIds.includes(idStr)
                ? baseIds.filter(id => id !== idStr)
                : [...baseIds, idStr];
            return {
                ...row,
                assignedEmployeeIds: nextIds,
                isExplicitlyEmpty: nextIds.length === 0
            };
        }));
    };

    const selectAllOpWorkers = () => {
        if (!currentOpRowId) return;
        const allIds = activeGroupEmployees.map(e => String(e.id));
        setLocalRows(prev => prev.map(row => String(row.id) === String(currentOpRowId) ? { ...row, assignedEmployeeIds: allIds, isExplicitlyEmpty: false } : row));
    };

    const clearAllOpWorkers = () => {
        if (!currentOpRowId) return;
        setLocalRows(prev => prev.map(row => String(row.id) === String(currentOpRowId) ? { ...row, assignedEmployeeIds: [], isExplicitlyEmpty: true } : row));
    };

    if (!isOpen) return null;

    return (
        <div
            onClick={(e) => {
                if (e.target === e.currentTarget) {
                    handleClose(e);
                }
            }}
            className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/70 transition-opacity"
        >
            {/* Main Modal Container */}
            <div className="relative w-full max-w-5xl bg-white rounded-lg shadow-xl overflow-hidden flex flex-col max-h-[90vh] z-10 border border-slate-200">
                {/* Modal Header */}
                <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/80">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-md bg-accent text-white flex items-center justify-center text-base shrink-0">
                            <i className="ti ti-building-factory" />
                        </div>
                        <div>
                            <h2 className="text-base font-bold text-slate-800">Factory Production &amp; Piece-Rate Manager</h2>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={handleClose}
                        className="w-8 h-8 rounded-md bg-white hover:bg-slate-100 text-slate-500 hover:text-slate-700 flex items-center justify-center transition-colors duration-100 border border-slate-200 cursor-pointer"
                        title="Close without saving"
                    >
                        <i className="ti ti-x text-base" />
                    </button>
                </div>

                {/* Modal Body */}
                <div className="p-4 sm:p-6 overflow-y-auto space-y-6">
                    {/* 1. Factory Production Groups Cards */}
                    <div className="bg-slate-50/50 p-4 rounded-lg border border-slate-200 space-y-3 shadow-2xs">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <div className="w-7 h-7 rounded-md bg-accent-subtle text-accent flex items-center justify-center text-xs font-bold shrink-0">
                                    <i className="ti ti-users-group"></i>
                                </div>
                                <div className="min-w-0">
                                    <h3 className="text-xs sm:text-sm font-bold text-slate-800 tracking-tight">Factory Production Groups</h3>
                                </div>
                            </div>
                            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-md border shrink-0 ${selectedGroup ? 'text-accent bg-accent-subtle border-accent/20' : 'text-slate-600 bg-slate-100 border-slate-200'}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${selectedGroup ? 'bg-accent' : 'bg-slate-400'}`} />
                                {selectedGroup ? `${activeGroupEmployees.length} Workers Active` : 'No Group Selected'}
                            </span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 gap-2.5">
                            {availableGroups.length === 0 ? (
                                <div className="col-span-full p-3 bg-warning-subtle text-warning-ink text-xs font-semibold rounded-md border border-warning/20">
                                    No production group assigned in database.
                                </div>
                            ) : (
                                availableGroups.map((groupName) => {
                                    const isSelected = selectedGroup === groupName;
                                    const groupWorkerCount = factoryEmployees.filter(e => e.group === groupName).length;

                                    return (
                                        <button
                                            key={groupName}
                                            type="button"
                                            onClick={() => {
                                                if (groupName === selectedGroup) return;

                                                if (selectedGroup) {
                                                    draftsRef.current[selectedGroup] = localRows;
                                                }
                                                handleGroupTabChange(groupName);
                                            }}
                                            className={`p-2.5 rounded-md border text-left transition-colors duration-100 flex items-center justify-between cursor-pointer ${isSelected
                                                ? 'bg-accent-subtle/90 border-accent shadow-2xs'
                                                : 'bg-white border-slate-200 hover:border-slate-300'
                                                }`}
                                        >
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <div className={`w-8 h-8 rounded-md flex items-center justify-center font-bold text-xs shrink-0 ${isSelected ? 'bg-accent text-white' : 'bg-slate-100 text-slate-600'
                                                    }`}>
                                                <i className="ti ti-users" />
                                                </div>
                                                <div className="min-w-0">
                                                    <h4 className={`text-xs sm:text-sm font-bold truncate ${isSelected ? 'text-accent-strong' : 'text-slate-800'}`}>
                                                        {groupName}
                                                    </h4>
                                                    <p className="text-[10px] sm:text-[11px] text-slate-500 font-medium truncate">
                                                        {groupWorkerCount} Employees
                                                    </p>
                                                </div>
                                            </div>
                                            {isSelected && (
                                                <span className="w-4 h-4 rounded-full bg-accent text-white flex items-center justify-center text-[9px] font-bold shrink-0 ml-1">
                                                    <i className="ti ti-check" />
                                                </span>
                                            )}
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    {/* 2. Factory Operation & Process Log Section */}
                    <div className="bg-slate-50/50 p-4 rounded-lg border border-slate-200 space-y-4 shadow-2xs">
                        <div className="flex items-center justify-between flex-wrap gap-3">
                            <div>
                                <h3 className="text-sm sm:text-base font-bold text-slate-800 flex items-center gap-2">
                                    <i className="ti ti-table text-accent" />
                                    <span>Factory Operation &amp; Process Piece-Rate Log</span>
                                </h3>
                            </div>

                            <div className="flex items-center gap-2 flex-wrap">
                                {/* HR View Switcher Mode Buttons */}
                                <div className="flex items-center bg-slate-100 border border-slate-200 p-0.5 rounded-md">
                                    <button
                                        type="button"
                                        onClick={() => setViewMode('compact')}
                                        className={`h-7 px-2.5 rounded-sm text-xs font-medium transition-colors duration-100 flex items-center gap-1.5 cursor-pointer ${viewMode === 'compact' ? 'bg-white text-accent shadow-2xs font-semibold' : 'text-slate-600 hover:text-slate-900'
                                            }`}
                                    >
                                        <i className="ti ti-list-details" />
                                        <span>Compact View</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setViewMode('grid')}
                                        className={`h-7 px-2.5 rounded-sm text-xs font-medium transition-colors duration-100 flex items-center gap-1.5 cursor-pointer ${viewMode === 'grid' ? 'bg-white text-accent shadow-2xs font-semibold' : 'text-slate-600 hover:text-slate-900'
                                            }`}
                                    >
                                        <i className="ti ti-layout-grid" />
                                        <span>Grid / Cards</span>
                                    </button>
                                </div>

                                <button
                                    type="button"
                                    onClick={addFactoryRow}
                                    className="h-8 px-3 bg-accent hover:bg-accent-hover text-white rounded-md text-xs font-semibold transition-colors duration-100 flex items-center gap-1 cursor-pointer shadow-2xs"
                                >
                                    <i className="ti ti-plus" />
                                    <span>Add Process</span>
                                </button>
                            </div>
                        </div>

                        {/* VIEW MODE: Compact View */}
                        {viewMode === 'compact' && (
                            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-2xs">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-slate-50/90 border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                            <th className="p-3">Process / Operation</th>
                                            <th className="p-3">Batch Info (Stock No &amp; Qty)</th>
                                            <th className="p-3 text-right">Rate / Unit (₱)</th>
                                            <th className="p-3 text-right">Total Price (₱)</th>
                                            <th className="p-3 text-center">Assigned Workers</th>
                                            <th className="p-3 text-center">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 text-xs">
                                        {activeComputedRows.map((row) => (
                                            <tr key={row.id} className="hover:bg-slate-50 transition-colors duration-100">
                                                <td className="p-2.5 font-bold text-slate-800">
                                                    <input
                                                        type="text"
                                                        value={row.operation}
                                                        onChange={(e) => handleFactoryRowChange(row.id, 'operation', e.target.value)}
                                                        placeholder="e.g. Cutter"
                                                        className="w-full h-8 px-2.5 border border-slate-200 rounded-md font-bold text-slate-800 bg-white outline-none focus:border-accent focus:ring-1 focus:ring-accent text-xs transition-colors duration-100"
                                                    />
                                                </td>
                                                <td className="p-2.5">
                                                    <div className="flex items-center gap-1.5">
                                                        <input
                                                            type="text"
                                                            value={row.stock_no}
                                                            onChange={(e) => handleFactoryRowChange(row.id, 'stock_no', e.target.value)}
                                                            placeholder="Stock No"
                                                            className="w-24 h-8 px-2 border border-slate-200 rounded-md font-medium text-slate-700 text-xs outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors duration-100"
                                                        />
                                                        <span className="text-slate-400">×</span>
                                                        <input
                                                            type="number"
                                                            value={row.quantity_in}
                                                            onChange={(e) => handleFactoryRowChange(row.id, 'quantity_in', e.target.value)}
                                                            placeholder="Qty"
                                                            className="w-20 h-8 px-2 border border-slate-200 rounded-md font-mono font-bold text-slate-800 text-xs text-right outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors duration-100"
                                                        />
                                                    </div>
                                                </td>
                                                <td className="p-2.5 text-right font-mono">
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        value={row.amount}
                                                        onChange={(e) => handleFactoryRowChange(row.id, 'amount', e.target.value)}
                                                        placeholder="0.00"
                                                        className="w-24 h-8 px-2.5 border border-slate-200 rounded-md font-mono font-bold text-right text-slate-800 text-xs outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors duration-100"
                                                    />
                                                </td>
                                                <td className="p-2.5 text-right font-mono font-bold text-slate-900 bg-slate-50/50">
                                                    ₱{row.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                                </td>
                                                <td className="p-2.5 text-center">
                                                    <button
                                                        type="button"
                                                        onClick={() => openOpWorkerModal(row.id)}
                                                        className="h-7 px-2.5 bg-accent-subtle hover:bg-accent-subtle text-accent text-xs font-semibold rounded-md border border-accent/20 transition-colors duration-100 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                                    >
                                                        <i className="ti ti-users" />
                                                        <span>{row.effectiveAssignedIds.length} Workers</span>
                                                    </button>
                                                </td>
                                                <td className="p-2.5 text-center">
                                                    <button
                                                        type="button"
                                                        onClick={() => removeFactoryRow(row.id)}
                                                        disabled={localRows.length <= 1}
                                                        className="w-7 h-7 mx-auto rounded-md text-slate-400 hover:text-danger-ink hover:bg-danger-subtle flex items-center justify-center transition-colors duration-100 cursor-pointer disabled:opacity-30"
                                                    >
                                                        <i className="ti ti-trash text-sm" />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {/* VIEW MODE: Grid & Cards Stack View */}
                        {viewMode === 'grid' && (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {activeComputedRows.map((row, idx) => (
                                    <div
                                        key={row.id}
                                        className="bg-white rounded-lg border border-slate-200 p-4 shadow-2xs hover:border-slate-300 transition-colors duration-100 flex flex-col justify-between space-y-3 relative"
                                    >
                                        <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                                            <span className="text-[10px] font-bold uppercase text-accent bg-accent-subtle px-2 py-0.5 rounded-md">
                                                Process #{idx + 1}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => removeFactoryRow(row.id)}
                                                disabled={localRows.length <= 1}
                                                className="w-7 h-7 rounded-md text-slate-400 hover:text-danger-ink hover:bg-danger-subtle flex items-center justify-center transition-colors duration-100 cursor-pointer disabled:opacity-30"
                                            >
                                                <i className="ti ti-trash text-sm" />
                                            </button>
                                        </div>

                                        <div className="space-y-2.5">
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-400 uppercase">Process Name</label>
                                                <input
                                                    type="text"
                                                    value={row.operation}
                                                    onChange={(e) => handleFactoryRowChange(row.id, 'operation', e.target.value)}
                                                    placeholder="e.g. Cutter"
                                                    className="w-full h-8 px-2.5 mt-0.5 border border-slate-200 rounded-md font-bold text-slate-800 text-xs bg-white outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors duration-100"
                                                />
                                            </div>

                                            <div className="grid grid-cols-2 gap-2">
                                                <div>
                                                    <label className="text-[10px] font-bold text-slate-400 uppercase">Stock No. (Auto-Sync)</label>
                                                    <input
                                                        type="text"
                                                        value={row.stock_no}
                                                        onChange={(e) => handleFactoryRowChange(row.id, 'stock_no', e.target.value)}
                                                        placeholder="Stock No."
                                                        className="w-full h-8 px-2.5 mt-0.5 border border-slate-200 rounded-md font-medium text-slate-700 text-xs bg-white outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors duration-100"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-[10px] font-bold text-slate-400 uppercase">Quantity IN (Auto-Sync)</label>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        value={row.quantity_in}
                                                        onChange={(e) => handleFactoryRowChange(row.id, 'quantity_in', e.target.value)}
                                                        placeholder="0"
                                                        className="w-full h-8 px-2.5 mt-0.5 border border-slate-200 rounded-md font-mono font-bold text-right text-slate-800 text-xs bg-white outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors duration-100"
                                                    />
                                                </div>
                                            </div>

                                            <div>
                                                <label className="text-[10px] font-bold text-slate-400 uppercase">Amount Rate (₱)</label>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    min="0"
                                                    value={row.amount}
                                                    onChange={(e) => handleFactoryRowChange(row.id, 'amount', e.target.value)}
                                                    placeholder="0.00"
                                                    className="w-full h-8 px-2.5 mt-0.5 border border-slate-200 rounded-md font-mono font-bold text-right text-slate-800 text-xs bg-white outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors duration-100"
                                                />
                                            </div>
                                        </div>

                                        <div className="pt-2 border-t border-slate-100 flex items-center justify-between bg-slate-50/80 -mx-4 -mb-4 p-3 rounded-b-lg">
                                            <div>
                                                <span className="text-[10px] font-bold text-slate-400 uppercase block">Total Output</span>
                                                <span className="text-sm font-mono font-bold text-ink">
                                                    ₱{row.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                                </span>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => openOpWorkerModal(row.id)}
                                                className="h-7 px-2.5 bg-accent hover:bg-accent-hover text-white text-xs font-semibold rounded-md transition-colors duration-100 inline-flex items-center gap-1.5 cursor-pointer shadow-2xs"
                                            >
                                                <i className="ti ti-users" />
                                                <span>{row.effectiveAssignedIds.length} Workers</span>
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* 3. Total Operation Output Summary Banner */}
                    <div className="p-4 bg-slate-900 border border-slate-800 text-white rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-2xs">
                        <div>
                            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                                {selectedGroup ? `${selectedGroup} Total Operation Output` : 'Overall Operation Output'}
                            </span>
                            <p className="text-2xl font-bold font-mono text-ink mt-0.5">
                                ₱{displayTotalPayout.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </p>
                        </div>
                        <div className="bg-slate-800 border border-slate-700 px-3.5 py-2 rounded-md text-xs font-medium flex items-center gap-3">
                            <div>
                                <span className="text-[10px] text-slate-300 uppercase font-bold block">{selectedGroup ? `${selectedGroup} Active Workers` : 'Active Workers'}</span>
                                <span className="text-base font-mono font-bold text-white">{selectedGroup ? activeGroupEmployees.length : 0} Workers</span>
                            </div>
                            <div className="border-l border-white/20 pl-3">
                                <span className="text-[10px] text-warning uppercase font-bold block">Division Method</span>
                                <span className="text-xs font-bold text-warning">Auto-assigned via Job Title</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Modal Footer */}
                <div className="p-4 border-t border-slate-200 bg-slate-50/80 flex items-center justify-end gap-3">
                    <button
                        type="button"
                        onClick={handleClose}
                        className="h-9 px-4 bg-white hover:bg-slate-100 text-slate-700 font-semibold text-xs rounded-md border border-slate-200 shadow-2xs transition-colors duration-100 cursor-pointer"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleSaveAndClose}
                        className="h-9 px-4 bg-accent hover:bg-accent-hover text-white font-semibold text-xs rounded-md shadow-2xs transition-colors duration-100 flex items-center gap-2 cursor-pointer"
                    >
                        <i className="ti ti-device-floppy text-base" />
                        <span>Save &amp; Close Log</span>
                    </button>
                </div>
            </div>

            {/* Inner Modal: Assign Workers to Operation Row */}
            {isOpAssignModalOpen && activeOpRow && (
                <div
                    onClick={(e) => {
                        if (e.target === e.currentTarget) {
                            setIsOpAssignModalOpen(false);
                        }
                    }}
                    className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/70"
                >
                    <div className="relative w-full max-w-lg bg-white rounded-t-lg sm:rounded-lg shadow-xl overflow-hidden flex flex-col max-h-[85vh] sm:max-h-[80vh] z-10 border border-slate-200">
                        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                            <div>
                                <h3 className="text-sm font-bold text-slate-800">
                                    Assign Workers to: <span className="text-accent">{activeOpRow.operation || 'Process'}</span>
                                </h3>
                                <p className="text-[11px] text-slate-400 font-semibold">
                                    Total Price: ₱{activeOpRow.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })} &middot; Divided among assigned personnel
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsOpAssignModalOpen(false)}
                                className="w-8 h-8 rounded-md bg-white hover:bg-slate-100 text-slate-500 hover:text-slate-700 flex items-center justify-center transition-colors duration-100 border border-slate-200 cursor-pointer"
                            >
                                <i className="ti ti-x text-sm"></i>
                            </button>
                        </div>

                        <div className="p-3.5 border-b border-slate-100 space-y-3 bg-white">
                            <input
                                type="text"
                                value={opWorkerSearch}
                                onChange={(e) => setOpWorkerSearch(e.target.value)}
                                placeholder="Search worker for this process..."
                                className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md text-xs font-medium text-slate-800 outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors duration-100 shadow-2xs"
                            />
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-bold text-slate-500">
                                    {activeOpRow.effectiveAssignedIds.length} of {activeGroupEmployees.length} Workers Assigned
                                </span>
                                <div className="flex items-center gap-1.5">
                                    <button
                                        type="button"
                                        onClick={selectAllOpWorkers}
                                        className="h-7 px-2.5 bg-accent-subtle text-accent hover:bg-accent-subtle rounded-sm text-xs font-medium transition-colors duration-100 cursor-pointer"
                                    >
                                        Assign All
                                    </button>
                                    <button
                                        type="button"
                                        onClick={clearAllOpWorkers}
                                        className="h-7 px-2.5 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-sm text-xs font-medium transition-colors duration-100 cursor-pointer"
                                    >
                                        Clear
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="overflow-y-auto p-2.5 space-y-1.5">
                            {activeGroupEmployees
                                .filter(emp => `${emp.first_name || ''} ${emp.last_name || ''} ${emp.job_title || ''}`.toLowerCase().includes(opWorkerSearch.toLowerCase()))
                                .map((emp) => {
                                    const isChecked = activeOpRow.effectiveAssignedIds.includes(String(emp.id));
                                    const isMatchedJob = matchJobTitle(emp.job_title || emp.position, activeOpRow.operation);

                                    return (
                                        <div
                                            key={emp.id}
                                            onClick={() => toggleOpWorker(emp.id)}
                                            className={`w-full p-2 rounded-md flex items-center justify-between text-left cursor-pointer transition-colors duration-100 ${isChecked ? 'bg-accent-subtle/80 border border-accent/20' : 'hover:bg-slate-50 border border-transparent'}`}
                                        >
                                            <div className="flex items-center gap-3 min-w-0">
                                                <input
                                                    type="checkbox"
                                                    checked={isChecked}
                                                    onChange={() => { }}
                                                    className="w-4 h-4 rounded text-accent focus:ring-accent cursor-pointer shrink-0"
                                                />
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-1.5">
                                                        <p className="text-xs font-bold text-slate-800 truncate">{emp.first_name} {emp.last_name}</p>
                                                        {isMatchedJob && (
                                                            <span className="text-[9px] font-bold bg-accent-subtle text-accent px-1.5 py-0.2 rounded shrink-0">
                                                                Job Match
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-[10px] text-slate-500 uppercase">
                                                        {emp.job_title ? `Title: ${emp.job_title}` : `${emp.group}`}
                                                    </p>
                                                </div>
                                            </div>
                                            {isChecked && (
                                                <span className="text-[10px] font-bold text-ink bg-surface-muted border border-line px-2 py-0.5 rounded-md shrink-0 font-mono">
                                                    +₱{activeOpRow.perWorkerShare.toFixed(2)}
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                        </div>

                        <div className="p-3.5 border-t border-slate-100 bg-slate-50/50">
                            <button
                                type="button"
                                onClick={() => setIsOpAssignModalOpen(false)}
                                className="w-full h-10 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-md shadow-2xs transition-colors duration-100 cursor-pointer flex items-center justify-center"
                            >
                                Confirm Process Workers ({activeOpRow.effectiveAssignedIds.length} Assigned)
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}