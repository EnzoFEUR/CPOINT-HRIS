import React, { useState } from 'react';
import EmployeeAvatar from '../../../../components/EmployeeAvatar';
import { getEmployeeDept } from '../utils/payrollHelpers';

const GroupSelectionModal = ({
    isOpen,
    onClose,
    selectedGroup,
    employeesInSelectedGroup,
    selectedGroupMemberIds,
    toggleGroupMember,
    selectAllGroupMembers,
    clearAllGroupMembers
}) => {
    const [groupSearch, setGroupSearch] = useState('');

    if (!isOpen) return null;

    const filtered = employeesInSelectedGroup.filter(emp =>
        `${emp.first_name || ''} ${emp.last_name || ''}`.toLowerCase().includes(groupSearch.toLowerCase())
    );

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div onClick={onClose} className="fixed inset-0 bg-slate-950/70" />
            <div className="relative w-full max-w-lg bg-white rounded-t-lg sm:rounded-lg shadow-xl overflow-hidden flex flex-col max-h-[85vh] sm:max-h-[80vh] z-10 border border-slate-200">
                <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                    <div>
                        <h3 className="text-sm font-bold text-slate-800">Select {selectedGroup} Members</h3>
                        <p className="text-[11px] text-slate-400 font-semibold">Choose active members under {selectedGroup}</p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-8 h-8 rounded-md bg-white hover:bg-slate-100 text-slate-500 hover:text-slate-700 flex items-center justify-center transition-colors duration-100 border border-slate-200 cursor-pointer"
                    >
                        <i className="ti ti-x text-base font-semibold"></i>
                    </button>
                </div>

                <div className="p-3.5 border-b border-slate-100 space-y-3 bg-white">
                    <input
                        type="text"
                        value={groupSearch}
                        onChange={(e) => setGroupSearch(e.target.value)}
                        placeholder={`Search ${selectedGroup} worker...`}
                        className="h-9 w-full px-3.5 bg-slate-50 border border-slate-200 focus:bg-white focus:border-accent rounded-md text-sm font-medium text-slate-800 outline-none transition-colors duration-100 placeholder:text-slate-400"
                    />
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-500">
                            {selectedGroupMemberIds.length} of {employeesInSelectedGroup.length} Selected
                        </span>
                        <div className="flex items-center gap-1.5">
                            <button
                                type="button"
                                onClick={selectAllGroupMembers}
                                className="h-7 px-2.5 bg-accent-subtle text-accent hover:bg-accent-subtle rounded-md text-xs font-semibold transition-colors duration-100 cursor-pointer flex items-center"
                            >
                                Select All
                            </button>
                            <button
                                type="button"
                                onClick={clearAllGroupMembers}
                                className="h-7 px-2.5 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-md text-xs font-semibold transition-colors duration-100 cursor-pointer flex items-center"
                            >
                                Clear
                            </button>
                        </div>
                    </div>
                </div>

                <div className="overflow-y-auto p-2.5 space-y-1.5">
                    {filtered.map((emp) => {
                        const isChecked = selectedGroupMemberIds.includes(String(emp.id));

                        return (
                            <div
                                key={emp.id}
                                onClick={() => toggleGroupMember(emp.id)}
                                className={`w-full p-2.5 rounded-md flex items-center justify-between text-left cursor-pointer transition-colors duration-100 ${isChecked ? 'bg-accent-subtle/80 border border-accent/20' : 'hover:bg-slate-50 border border-transparent'}`}
                            >
                                <div className="flex items-center gap-3 min-w-0">
                                    <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => { }}
                                        className="w-4 h-4 rounded text-accent focus:ring-accent cursor-pointer shrink-0"
                                    />
                                    <EmployeeAvatar employee={emp} size="h-9 w-9" rounded="rounded-md" textSize="text-xs" />
                                    <div className="min-w-0">
                                        <p className="text-xs font-bold text-slate-800 truncate">{emp.first_name} {emp.last_name}</p>
                                        <p className="text-[10px] text-slate-500 uppercase">{emp.job_title || emp.group} &middot; {getEmployeeDept(emp)}</p>
                                    </div>
                                </div>
                                {isChecked && (
                                    <span className="text-[10px] font-bold text-accent bg-accent-subtle/80 px-2 py-0.5 rounded-md shrink-0">
                                        Included
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>

                <div className="p-3.5 border-t border-slate-100 bg-slate-50/50">
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-full h-10 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-md shadow-2xs transition-colors duration-100 cursor-pointer"
                    >
                        Confirm Selection ({selectedGroupMemberIds.length} Members)
                    </button>
                </div>
            </div>
        </div>
    );
};

export default React.memo(GroupSelectionModal);
