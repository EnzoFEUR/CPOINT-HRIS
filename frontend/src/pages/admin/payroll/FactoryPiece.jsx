import React, { useState, useMemo } from 'react';
import { matchJobTitle } from './Create';

export default function FactoryPiece({
    isOpen,
    onClose,
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
    const [isOpAssignModalOpen, setIsOpAssignModalOpen] = useState(false);
    const [currentOpRowId, setCurrentOpRowId] = useState(null);
    const [opWorkerSearch, setOpWorkerSearch] = useState('');

    // HR Layout View State: 'compact' | 'grid'
    const [viewMode, setViewMode] = useState('compact');

    // Updates row value, auto-syncing Stock No. and Quantity IN across all rows
    const handleFactoryRowChange = (id, field, value) => {
        setFactoryRows(prev => prev.map(row => {
            if (field === 'stock_no' || field === 'quantity_in') {
                return { ...row, [field]: value };
            }
            return row.id === id ? { ...row, [field]: value } : row;
        }));
    };

    const addFactoryRow = () => {
        const lastRow = factoryRows[factoryRows.length - 1];
        const defaultStock = lastRow ? lastRow.stock_no : 'Formal';
        const defaultQty = lastRow ? lastRow.quantity_in : '';

        setFactoryRows(prev => [
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
        if (factoryRows.length <= 1) return;
        setFactoryRows(prev => prev.filter(row => row.id !== id));
    };

    const openOpWorkerModal = (rowId) => {
        setCurrentOpRowId(rowId);
        setOpWorkerSearch('');
        setIsOpAssignModalOpen(true);
    };

    const activeOpRow = useMemo(() => {
        return computedFactoryRows.find(r => r.id === currentOpRowId) || null;
    }, [computedFactoryRows, currentOpRowId]);

    const toggleOpWorker = (empId) => {
        if (!currentOpRowId) return;
        const idStr = String(empId);

        setFactoryRows(prev => prev.map(row => {
            if (row.id !== currentOpRowId) return row;
            const currentIds = Array.isArray(row.assignedEmployeeIds) ? row.assignedEmployeeIds : [];
            const nextIds = currentIds.includes(idStr)
                ? currentIds.filter(id => id !== idStr)
                : [...currentIds, idStr];
            return { ...row, assignedEmployeeIds: nextIds };
        }));
    };

    const selectAllOpWorkers = () => {
        if (!currentOpRowId) return;
        const allIds = activeGroupEmployees.map(e => String(e.id));
        setFactoryRows(prev => prev.map(row => row.id === currentOpRowId ? { ...row, assignedEmployeeIds: allIds } : row));
    };

    const clearAllOpWorkers = () => {
        if (!currentOpRowId) return;
        setFactoryRows(prev => prev.map(row => row.id === currentOpRowId ? { ...row, assignedEmployeeIds: [] } : row));
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
            {/* Backdrop */}
            <div onClick={onClose} className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs transition-opacity" />

            {/* Main Modal Container */}
            <div className="relative w-full max-w-5xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] z-10 border border-slate-200">
                {/* Modal Header */}
                <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/80">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center text-lg font-bold shadow-md">
                            <i className="ti ti-building-factory" />
                        </div>
                        <div>
                            <h2 className="text-base sm:text-lg font-black text-slate-800">Factory Production &amp; Piece-Rate Manager</h2>
                            <p className="text-xs text-slate-500 font-medium">Configure production groups, output summaries, and piece-rate operations</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-9 h-9 rounded-full bg-slate-200/80 hover:bg-slate-300 flex items-center justify-center text-slate-600 transition-colors cursor-pointer"
                    >
                        <i className="ti ti-x text-lg" />
                    </button>
                </div>

                {/* Modal Body */}
                <div className="p-4 sm:p-6 overflow-y-auto space-y-6">
                    {/* 1. Factory Production Groups Cards */}
                    <div className="bg-slate-50/80 p-3.5 sm:p-4 rounded-2xl border border-slate-200 space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold shadow-xs shrink-0">
                                    <i className="ti ti-users-group"></i>
                                </div>
                                <div className="min-w-0">
                                    <h3 className="text-xs sm:text-sm font-bold text-slate-800 tracking-tight">Factory Production Groups</h3>
                                    <p className="text-[10px] text-slate-400 font-medium leading-snug truncate">
                                        Select a group to assign processes and calculate individual operation payout
                                    </p>
                                </div>
                            </div>
                            <span className="text-[10px] font-bold text-slate-500 bg-slate-200/60 px-2 py-0.5 rounded-full shrink-0">
                                {activeGroupEmployees.length} Workers Active
                            </span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 gap-2.5">
                            {availableGroups.length === 0 ? (
                                <div className="col-span-full p-3 bg-amber-50 text-amber-800 text-xs font-semibold rounded-xl border border-amber-200">
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
                                            onClick={() => handleGroupTabChange(groupName)}
                                            className={`p-2.5 rounded-xl border-2 text-left transition-all flex items-center justify-between cursor-pointer ${isSelected
                                                ? 'bg-blue-50/90 border-blue-600 shadow-xs shadow-blue-500/10'
                                                : 'bg-white border-slate-200 hover:border-slate-300'
                                                }`}
                                        >
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${isSelected ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
                                                    }`}>
                                                    <i className="ti ti-users" />
                                                </div>
                                                <div className="min-w-0">
                                                    <h4 className={`text-xs sm:text-sm font-bold truncate ${isSelected ? 'text-blue-900' : 'text-slate-800'}`}>
                                                        {groupName}
                                                    </h4>
                                                    <p className="text-[10px] sm:text-[11px] text-slate-500 font-medium truncate">
                                                        {groupWorkerCount} Employees
                                                    </p>
                                                </div>
                                            </div>
                                            {isSelected && (
                                                <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-bold shrink-0 ml-1">
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
                    <div className="bg-slate-50/80 p-4 sm:p-6 rounded-2xl border border-slate-200 space-y-4">
                        <div className="flex items-center justify-between flex-wrap gap-3">
                            <div>
                                <h3 className="text-sm sm:text-base font-black text-slate-800 flex items-center gap-2">
                                    <i className="ti ti-table text-blue-600" />
                                    <span>Factory Operation &amp; Process Piece-Rate Log</span>
                                </h3>
                                <p className="text-[11px] text-slate-500 font-medium">
                                    Each process total price is divided <strong>only</strong> among workers with matching job titles. Stock No. &amp; Quantity auto-sync across all processes.
                                </p>
                            </div>

                            <div className="flex items-center gap-2 flex-wrap">
                                {/* HR View Switcher Mode Buttons */}
                                <div className="flex items-center bg-slate-200/80 p-1 rounded-xl">
                                    <button
                                        type="button"
                                        onClick={() => setViewMode('compact')}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${viewMode === 'compact' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                                            }`}
                                    >
                                        <i className="ti ti-list-details" />
                                        <span>Compact View</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setViewMode('grid')}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${viewMode === 'grid' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                                            }`}
                                    >
                                        <i className="ti ti-layout-grid" />
                                        <span>Grid / Cards</span>
                                    </button>
                                </div>

                                <button
                                    type="button"
                                    onClick={addFactoryRow}
                                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer shadow-xs"
                                >
                                    <i className="ti ti-plus" />
                                    <span>Add Process</span>
                                </button>
                            </div>
                        </div>

                        {/* VIEW MODE: Compact View */}
                        {viewMode === 'compact' && (
                            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-slate-100/80 border-b border-slate-200 text-[11px] font-black text-slate-500 uppercase">
                                            <th className="p-3">Process / Operation</th>
                                            <th className="p-3">Batch Info (Stock No &amp; Qty)</th>
                                            <th className="p-3 text-right">Rate / Unit (₱)</th>
                                            <th className="p-3 text-right">Total Price (₱)</th>
                                            <th className="p-3 text-center">Assigned Workers</th>
                                            <th className="p-3 text-center">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 text-xs">
                                        {computedFactoryRows.map((row) => (
                                            <tr key={row.id} className="hover:bg-slate-50/50 transition-colors">
                                                <td className="p-2.5 font-bold text-slate-800">
                                                    <input
                                                        type="text"
                                                        value={row.operation}
                                                        onChange={(e) => handleFactoryRowChange(row.id, 'operation', e.target.value)}
                                                        placeholder="e.g. Cutter"
                                                        className="w-full p-1.5 border border-slate-200 rounded-lg font-bold text-slate-800 bg-white outline-none focus:ring-2 focus:ring-blue-500"
                                                    />
                                                </td>
                                                <td className="p-2.5">
                                                    <div className="flex items-center gap-1.5">
                                                        <input
                                                            type="text"
                                                            value={row.stock_no}
                                                            onChange={(e) => handleFactoryRowChange(row.id, 'stock_no', e.target.value)}
                                                            placeholder="Stock No"
                                                            className="w-24 p-1 border border-slate-200 rounded font-medium text-slate-700 text-xs"
                                                        />
                                                        <span className="text-slate-400">×</span>
                                                        <input
                                                            type="number"
                                                            value={row.quantity_in}
                                                            onChange={(e) => handleFactoryRowChange(row.id, 'quantity_in', e.target.value)}
                                                            placeholder="Qty"
                                                            className="w-20 p-1 border border-slate-200 rounded font-mono font-bold text-slate-800 text-xs text-right"
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
                                                        className="w-24 p-1.5 border border-slate-200 rounded-lg font-mono font-bold text-right text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
                                                    />
                                                </td>
                                                <td className="p-2.5 text-right font-mono font-black text-slate-900 bg-slate-50/50">
                                                    ₱{row.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                                </td>
                                                <td className="p-2.5 text-center">
                                                    <button
                                                        type="button"
                                                        onClick={() => openOpWorkerModal(row.id)}
                                                        className="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-lg border border-blue-200 transition-colors inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                                    >
                                                        <i className="ti ti-users" />
                                                        <span>{row.effectiveAssignedIds.length} Workers</span>
                                                    </button>
                                                </td>
                                                <td className="p-2.5 text-center">
                                                    <button
                                                        type="button"
                                                        onClick={() => removeFactoryRow(row.id)}
                                                        disabled={factoryRows.length <= 1}
                                                        className="p-1 text-slate-400 hover:text-red-500 disabled:opacity-30 cursor-pointer"
                                                    >
                                                        <i className="ti ti-trash text-base" />
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
                                {computedFactoryRows.map((row, idx) => (
                                    <div
                                        key={row.id}
                                        className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs hover:shadow-md transition-all flex flex-col justify-between space-y-3 relative"
                                    >
                                        <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                                            <span className="text-[10px] font-extrabold uppercase text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">
                                                Process #{idx + 1}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => removeFactoryRow(row.id)}
                                                disabled={factoryRows.length <= 1}
                                                className="text-slate-400 hover:text-red-500 disabled:opacity-30 transition-colors cursor-pointer"
                                            >
                                                <i className="ti ti-trash text-base" />
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
                                                    className="w-full mt-0.5 p-2 border border-slate-200 rounded-xl font-bold text-slate-800 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
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
                                                        className="w-full mt-0.5 p-1.5 border border-slate-200 rounded-lg font-medium text-slate-700 text-xs bg-white outline-none focus:ring-2 focus:ring-blue-500"
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
                                                        className="w-full mt-0.5 p-1.5 border border-slate-200 rounded-lg font-mono font-bold text-right text-slate-800 text-xs bg-white outline-none focus:ring-2 focus:ring-blue-500"
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
                                                    className="w-full mt-0.5 p-2 border border-slate-200 rounded-xl font-mono font-bold text-right text-slate-800 text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500"
                                                />
                                            </div>
                                        </div>

                                        <div className="pt-2 border-t border-slate-100 flex items-center justify-between bg-slate-50/80 -mx-4 -mb-4 p-3 rounded-b-2xl">
                                            <div>
                                                <span className="text-[10px] font-bold text-slate-400 uppercase block">Total Output</span>
                                                <span className="text-sm font-mono font-black text-emerald-600">
                                                    ₱{row.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                                </span>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => openOpWorkerModal(row.id)}
                                                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-colors inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
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
                    <div className="p-5 bg-gradient-to-r from-slate-900 to-blue-950 text-white rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-md">
                        <div>
                            <span className="text-xs font-bold text-blue-300 uppercase tracking-wider block">
                                {selectedGroup || 'Factory Group'} Total Operation Output
                            </span>
                            <p className="text-2xl sm:text-3xl font-black font-mono text-emerald-400 mt-0.5">
                                ₱{grandTotalFactoryPayout.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </p>
                        </div>
                        <div className="bg-white/10 px-4 py-2.5 rounded-xl text-xs font-semibold backdrop-blur-xs flex items-center gap-3">
                            <div>
                                <span className="text-[10px] text-slate-300 uppercase font-bold block">{selectedGroup} Active Workers</span>
                                <span className="text-base font-mono font-bold text-white">{activeGroupEmployees.length} Workers</span>
                            </div>
                            <div className="border-l border-white/20 pl-3">
                                <span className="text-[10px] text-amber-300 uppercase font-bold block">Division Method</span>
                                <span className="text-xs font-bold text-amber-300">Auto-assigned via Job Title</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Modal Footer */}
                <div className="p-4 border-t border-slate-200 bg-slate-50/80 flex justify-end">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-6 py-2.5 bg-slate-900 hover:bg-blue-600 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer"
                    >
                        Save &amp; Close Log
                    </button>
                </div>
            </div>

            {/* Inner Modal: Assign Workers to Operation Row */}
            {isOpAssignModalOpen && activeOpRow && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                    <div onClick={() => setIsOpAssignModalOpen(false)} className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs" />
                    <div className="relative w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] sm:max-h-[80vh] z-10">
                        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                            <div>
                                <h3 className="text-sm font-extrabold text-slate-800">
                                    Assign Workers to: <span className="text-blue-600">{activeOpRow.operation || 'Process'}</span>
                                </h3>
                                <p className="text-[11px] text-slate-400 font-semibold">
                                    Total Price: ₱{activeOpRow.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })} &middot; Divided among assigned personnel
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsOpAssignModalOpen(false)}
                                className="w-8 h-8 rounded-full bg-slate-200/70 hover:bg-slate-200 flex items-center justify-center cursor-pointer"
                            >
                                <i className="ti ti-x"></i>
                            </button>
                        </div>

                        <div className="p-3.5 border-b border-slate-100 space-y-3 bg-white">
                            <input
                                type="text"
                                value={opWorkerSearch}
                                onChange={(e) => setOpWorkerSearch(e.target.value)}
                                placeholder="Search worker for this process..."
                                className="w-full px-4 py-2.5 bg-slate-100 border border-transparent focus:border-blue-500 rounded-xl text-sm font-medium text-slate-800 outline-none"
                            />
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-bold text-slate-500">
                                    {activeOpRow.effectiveAssignedIds.length} of {activeGroupEmployees.length} Workers Assigned
                                </span>
                                <div className="flex items-center gap-1.5">
                                    <button
                                        type="button"
                                        onClick={selectAllOpWorkers}
                                        className="px-2.5 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                                    >
                                        Assign All
                                    </button>
                                    <button
                                        type="button"
                                        onClick={clearAllOpWorkers}
                                        className="px-2.5 py-1 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-lg text-xs font-bold transition-colors cursor-pointer"
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
                                            className={`w-full p-2.5 rounded-2xl flex items-center justify-between text-left cursor-pointer transition-colors ${isChecked ? 'bg-blue-50/80 border border-blue-200' : 'hover:bg-slate-50 border border-transparent'}`}
                                        >
                                            <div className="flex items-center gap-3 min-w-0">
                                                <input
                                                    type="checkbox"
                                                    checked={isChecked}
                                                    onChange={() => { }}
                                                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer shrink-0"
                                                />
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-1.5">
                                                        <p className="text-xs font-bold text-slate-800 truncate">{emp.first_name} {emp.last_name}</p>
                                                        {isMatchedJob && (
                                                            <span className="text-[9px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.2 rounded shrink-0">
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
                                                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md shrink-0 font-mono">
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
                                className="w-full py-3 bg-slate-900 hover:bg-blue-600 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer"
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