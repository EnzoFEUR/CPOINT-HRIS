import React from 'react';
import EmployeeAvatar from '../../../../components/EmployeeAvatar';
import { getEmployeeDept } from '../utils/payrollHelpers';

const EmployeeSelectionModal = ({
    isOpen,
    onClose,
    filteredEmployees,
    availableDepartments,
    selectedDeptFilter,
    setSelectedDeptFilter,
    empSearch,
    setEmpSearch,
    onSelectEmployee
}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div onClick={onClose} className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs" />
            <div className="relative w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] sm:max-h-[80vh] z-10">
                <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                    <h3 className="text-sm font-extrabold text-slate-800">Select Regular Employee</h3>
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-8 h-8 rounded-full bg-slate-200/70 hover:bg-slate-200 flex items-center justify-center cursor-pointer"
                    >
                        <i className="ti ti-x"></i>
                    </button>
                </div>

                <div className="p-3.5 border-b border-slate-100 space-y-3 bg-white">
                    <input
                        type="text"
                        value={empSearch}
                        onChange={(e) => setEmpSearch(e.target.value)}
                        placeholder="Search regular employee by name or department..."
                        className="w-full px-4 py-2.5 bg-slate-100 border border-transparent focus:border-blue-500 rounded-xl text-sm font-medium text-slate-800 outline-none"
                    />
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                        {availableDepartments.map((dept) => (
                            <button
                                key={dept}
                                type="button"
                                onClick={() => setSelectedDeptFilter(dept)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${selectedDeptFilter === dept ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                            >
                                {dept}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="overflow-y-auto p-2.5 space-y-1.5">
                    {filteredEmployees.length === 0 ? (
                        <p className="text-center text-slate-400 text-xs py-8">No regular employees found.</p>
                    ) : (
                        filteredEmployees.map((emp) => (
                            <button
                                key={emp.id}
                                type="button"
                                onClick={() => {
                                    onSelectEmployee(String(emp.id));
                                    onClose();
                                }}
                                className="w-full p-2.5 hover:bg-blue-50/60 rounded-2xl flex items-center justify-between text-left transition-colors cursor-pointer group border border-transparent hover:border-blue-100"
                            >
                                <div className="flex items-center gap-3 min-w-0">
                                    <EmployeeAvatar employee={emp} size="h-9 w-9" rounded="rounded-xl" textSize="text-xs" />
                                    <div className="min-w-0">
                                        <p className="text-xs font-bold text-slate-800 group-hover:text-blue-700 transition-colors truncate">
                                            {emp.first_name} {emp.last_name}
                                        </p>
                                        <p className="text-[10px] text-slate-400 font-semibold uppercase truncate">
                                            {getEmployeeDept(emp)} &middot; {emp.job_title || emp.position || 'Employee'}
                                        </p>
                                    </div>
                                </div>
                                <i className="ti ti-chevron-right text-slate-300 group-hover:text-blue-600 transition-colors"></i>
                            </button>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

export default React.memo(EmployeeSelectionModal);
