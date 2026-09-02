import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { fetchWithAuth } from '../../../utils/api';
import EmployeeAvatar from '../../../components/EmployeeAvatar';
import PageHeader from '../../../components/ui/PageHeader';

const SHIFT_TYPES = [
    { 
        id: 'Morning', 
        name: 'Morning Shift', 
        time: '06:00 AM - 02:00 PM', 
        styles: {
            bg: 'bg-amber-500',
            lightBg: 'bg-amber-50',
            text: 'text-amber-700',
            border: 'border-amber-200'
        }
    },
    { 
        id: 'Mid', 
        name: 'Mid Shift', 
        time: '02:00 PM - 10:00 PM', 
        styles: {
            bg: 'bg-blue-600',
            lightBg: 'bg-blue-50',
            text: 'text-blue-700',
            border: 'border-blue-200'
        }
    },
    { 
        id: 'Night', 
        name: 'Night Shift', 
        time: '10:00 PM - 06:00 AM', 
        styles: {
            bg: 'bg-indigo-600',
            lightBg: 'bg-indigo-50',
            text: 'text-indigo-700',
            border: 'border-indigo-200'
        }
    },
    { 
        id: 'Unassigned', 
        name: 'No Schedule', 
        time: 'Shift not set', 
        styles: {
            bg: 'bg-slate-400',
            lightBg: 'bg-slate-50',
            text: 'text-slate-600',
            border: 'border-slate-200'
        }
    },
];

export default function ShiftsIndex() {
    const queryClient = useQueryClient();
    const [searchQuery, setSearchQuery] = useState('');
    const [filterDept, setFilterDept] = useState('All');
    const [pendingEmployeeId, setPendingEmployeeId] = useState(null);

    // Fetch workforce directory
    const { data: rawEmployees = [], isLoading } = useQuery({
        queryKey: ['adminEmployees'],
        queryFn: async () => {
            const res = await fetchWithAuth('/api/employees');
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to fetch workforce');
            return Array.isArray(data) ? data : (data?.data || []);
        },
        staleTime: 60000,
    });

    const employees = useMemo(() => {
        return Array.isArray(rawEmployees) ? rawEmployees : (rawEmployees?.data || []);
    }, [rawEmployees]);

    // Optimistic shift assignment mutation
    const assignShiftMutation = useMutation({
        mutationFn: async ({ employeeId, shift }) => {
            const res = await fetchWithAuth('/api/shifts/assign', {
                method: 'POST',
                body: JSON.stringify({ employee_id: employeeId, shift })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to assign schedule');
            return data;
        },
        // Instant Frame-0 cache update
        onMutate: async ({ employeeId, shift }) => {
            await queryClient.cancelQueries({ queryKey: ['adminEmployees'] });
            const previousEmployees = queryClient.getQueryData(['adminEmployees']);

            queryClient.setQueryData(['adminEmployees'], (old) => {
                if (!old) return old;
                const list = Array.isArray(old) ? old : (old.data || []);
                const updated = list.map(emp => emp.id === employeeId ? { ...emp, shift } : emp);
                return Array.isArray(old) ? updated : { ...old, data: updated };
            });

            return { previousEmployees };
        },
        onError: (err, variables, context) => {
            if (context?.previousEmployees) {
                queryClient.setQueryData(['adminEmployees'], context.previousEmployees);
            }
            toast.error(err.message || 'Error assigning shift');
        },
        onSuccess: (_, variables) => {
            toast.success(`Schedule assigned: ${variables.shift}`);
        },
        onSettled: () => {
            setPendingEmployeeId(null);
            queryClient.invalidateQueries({ queryKey: ['adminEmployees'] });
        }
    });

    // Handle button click with anti-spam check
    const handleAssignShift = (employeeId, currentShift, newShiftId) => {
        if (currentShift === newShiftId) return;
        if (assignShiftMutation.isPending && pendingEmployeeId === employeeId) return;

        setPendingEmployeeId(employeeId);
        assignShiftMutation.mutate({ employeeId, shift: newShiftId });
    };

    const departments = useMemo(() => {
        return ['All', ...new Set(employees.map(e => e.department).filter(Boolean))];
    }, [employees]);

    const filteredEmployees = useMemo(() => {
        return employees.filter(emp => {
            const fullName = `${emp.first_name || ''} ${emp.last_name || ''}`.toLowerCase();
            const matchesSearch = fullName.includes(searchQuery.toLowerCase());
            const matchesDept = filterDept === 'All' || emp.department === filterDept;
            
            const isExcluded = fullName.includes('terminal guard') || 
                               fullName.includes('system admin') || 
                               emp.email === 'guard@c-point.com' || 
                               emp.email === 'admin@c-point.com' ||
                               emp.role?.includes('admin') ||
                               emp.role?.includes('security');

            return matchesSearch && matchesDept && !isExcluded;
        });
    }, [employees, searchQuery, filterDept]);

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
                <div className="w-10 h-10 border-3 border-slate-200 border-t-blue-600 rounded-full animate-spin" />
                <p className="text-slate-500 font-semibold tracking-wider uppercase text-xs">Loading Shift Assignments...</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto pb-24 lg:pb-8 px-4 sm:px-6 lg:px-8 font-sans">
            <PageHeader
                breadcrumbs={['Admin', 'Operations', 'Shift Deployment']}
                title="Shift Deployment"
                description="Assign operating schedules, track facility coverage, and manage rotational shifts in real-time."
                actions={
                    <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 px-3.5 py-2 rounded-lg">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Staff:</span>
                        <span className="font-mono text-sm font-bold text-slate-900 tabular-nums">{employees.length}</span>
                    </div>
                }
            />

            <div className="space-y-4 sm:space-y-6">

            {/* Filter toolbar */}
            <div className="flex flex-col md:flex-row gap-2.5 sm:gap-3 bg-white p-2 sm:p-3 rounded-2xl shadow-xs sm:shadow-sm border border-slate-100">
                <div className="relative flex-1">
                    <i className="ti ti-search absolute left-4 sm:left-5 top-1/2 -translate-y-1/2 text-slate-400 text-base sm:text-lg" />
                    <input 
                        type="text" 
                        placeholder="Search employees by name..." 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 sm:pl-12 pr-4 sm:pr-6 py-2.5 sm:py-3 bg-slate-50 border-none rounded-xl outline-none focus:ring-4 focus:ring-blue-500/10 font-bold text-xs sm:text-sm text-slate-700 transition-all placeholder:text-slate-400 placeholder:font-medium"
                    />
                </div>
                <div className="relative min-w-full md:min-w-[200px]">
                    <i className="ti ti-building absolute left-4 sm:left-5 top-1/2 -translate-y-1/2 text-slate-400 text-base sm:text-lg z-10" />
                    <select 
                        value={filterDept}
                        onChange={(e) => setFilterDept(e.target.value)}
                        className="w-full pl-10 sm:pl-12 pr-6 py-2.5 sm:py-3 bg-slate-50 border-none rounded-xl outline-none focus:ring-4 focus:ring-blue-500/10 font-bold text-xs sm:text-sm text-slate-700 transition-all appearance-none cursor-pointer"
                    >
                        {departments.map(dept => <option key={dept} value={dept}>{dept} Dept</option>)}
                    </select>
                    <i className="ti ti-chevron-down absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
            </div>

            {/* Employee schedule cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-5">
                {filteredEmployees.map(employee => {
                    const activeShift = SHIFT_TYPES.find(s => s.id === employee.shift) || SHIFT_TYPES[3];
                    const isCardPending = assignShiftMutation.isPending && pendingEmployeeId === employee.id;
                    
                    return (
                        <div 
                            key={employee.id} 
                            className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-100 shadow-xs sm:shadow-sm hover:shadow-md transition-all duration-200 relative overflow-hidden group"
                        >
                            <div className="flex items-start justify-between relative z-10">
                                <div className="flex items-center gap-3">
                                    <EmployeeAvatar employee={employee} />
                                    <div className="min-w-0">
                                        <h3 className="font-bold text-slate-800 text-sm sm:text-base tracking-tight group-hover:text-blue-600 transition-colors truncate">
                                            {employee.first_name} {employee.last_name}
                                        </h3>
                                        <p className="text-[10px] text-slate-400 font-bold tracking-widest uppercase mt-0.5 truncate">{employee.department}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-4 mb-4">
                                <div className={`inline-flex items-center px-2.5 py-1 rounded-lg border ${activeShift.styles.lightBg} ${activeShift.styles.text} ${activeShift.styles.border}`}>
                                    <span className="text-xs font-black uppercase tracking-widest">{activeShift.name || activeShift.id}</span>
                                </div>
                                <p className="text-xs font-bold text-slate-400 mt-1.5 ml-1">
                                    {activeShift.time}
                                </p>
                            </div>

                            <div className="relative z-10 pt-4 border-t border-slate-50">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5">Reassign Schedule</p>
                                <div className="flex bg-slate-50 p-1 rounded-xl border border-slate-100">
                                    {SHIFT_TYPES.slice(0, 3).map(shift => {
                                        const isSelected = employee.shift === shift.id;
                                        return (
                                            <button 
                                                key={shift.id}
                                                disabled={isCardPending}
                                                onClick={() => handleAssignShift(employee.id, employee.shift, shift.id)}
                                                className={`flex-1 py-2 text-[11px] sm:text-xs font-bold rounded-lg transition-all duration-150 cursor-pointer ${
                                                    isSelected 
                                                        ? `${shift.styles.bg} text-white shadow-xs` 
                                                        : 'text-slate-500 hover:bg-white hover:text-slate-800'
                                                } ${isCardPending ? 'opacity-70 cursor-not-allowed' : ''}`}
                                            >
                                                {shift.id}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Empty state */}
            {filteredEmployees.length === 0 && (
                <div className="flex flex-col items-center justify-center p-8 sm:p-16 bg-white rounded-xl border border-slate-200 shadow-xs text-center">
                    <div className="w-12 h-12 bg-slate-50 rounded-xl flex items-center justify-center mb-3">
                        <i className="ti ti-users-minus text-2xl text-slate-400" />
                    </div>
                    <h3 className="text-base font-semibold text-slate-800">No staff found</h3>
                    <p className="text-slate-500 font-medium text-xs mt-0.5">Try adjusting your search query or department filter.</p>
                </div>
            )}
            </div>
        </div>
    );
}
