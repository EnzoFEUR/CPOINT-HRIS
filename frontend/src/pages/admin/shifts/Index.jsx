import React, { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchWithAuth } from '../../../utils/api';

export default function ShiftsIndex() {
    const [employees, setEmployees] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterDept, setFilterDept] = useState('All');

    // Hardcode colors so Tailwind compiler doesn't strip them
    const SHIFT_TYPES = [
        { 
            id: 'Morning', label: 'Morning', time: '06:00 AM - 02:00 PM', 
            styles: { bg: 'bg-amber-500', text: 'text-amber-600', lightBg: 'bg-amber-50', border: 'border-amber-200' }
        },
        { 
            id: 'Swing', label: 'Swing', time: '02:00 PM - 10:00 PM', 
            styles: { bg: 'bg-orange-500', text: 'text-orange-600', lightBg: 'bg-orange-50', border: 'border-orange-200' }
        },
        { 
            id: 'Night', label: 'Night', time: '10:00 PM - 06:00 AM', 
            styles: { bg: 'bg-indigo-500', text: 'text-indigo-600', lightBg: 'bg-indigo-50', border: 'border-indigo-200' }
        },
        { 
            id: 'Unassigned', label: 'Unassigned', time: 'No Schedule', 
            styles: { bg: 'bg-slate-300', text: 'text-slate-500', lightBg: 'bg-slate-100', border: 'border-slate-200' }
        },
    ];

    const fetchEmployees = async () => {
        try {
            const res = await fetchWithAuth('/api/shifts');
            const data = await res.json();
            if (Array.isArray(data)) {
                setEmployees(data);
            } else if (data?.data && Array.isArray(data.data)) {
                setEmployees(data.data);
            } else {
                setEmployees([]);
            }
        } catch (err) {
            console.error("Failed to fetch shifts:", err);
            setEmployees([]);
            toast.error("Failed to load shift engine");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchEmployees();
    }, []);

    const handleAssignShift = async (employee_id, shift) => {
        const empList = Array.isArray(employees) ? employees : [];
        const previousEmployees = [...empList];
        setEmployees(prev => (Array.isArray(prev) ? prev : []).map(emp => emp.id === employee_id ? { ...emp, shift } : emp));

        try {
            const user = JSON.parse(localStorage.getItem('user'));
            const res = await fetchWithAuth('/api/shifts/assign', {
                method: 'POST',
                body: JSON.stringify({ employee_id, shift, admin_id: user?.id })
            });
            const data = await res.json();
            if (data.success) {
                toast.success('Shift assigned successfully!');
            } else {
                toast.error(data.error || 'Failed to assign shift');
                setEmployees(previousEmployees); // Rollback
            }
        } catch (err) {
            toast.error('Network Error');
            setEmployees(previousEmployees); // Rollback
        }
    };

    const departments = useMemo(() => {
        const empList = Array.isArray(employees) ? employees : [];
        const depts = new Set(empList.map(e => e.department));
        return ['All', ...Array.from(depts).filter(Boolean)];
    }, [employees]);

    const filteredEmployees = useMemo(() => {
        const empList = Array.isArray(employees) ? employees : [];
        return empList.filter(emp => {
            const roleStr = (emp.role || '').toLowerCase();
            if (roleStr === 'admin' || roleStr === 'security') return false;

            const matchSearch = `${emp.first_name || ''} ${emp.last_name || ''}`.toLowerCase().includes(searchQuery.toLowerCase());
            const matchDept = filterDept === 'All' || emp.department === filterDept;
            return matchSearch && matchDept;
        });
    }, [employees, searchQuery, filterDept]);

    const containerVariants = {
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { staggerChildren: 0.05 } }
    };
    
    const cardVariants = {
        hidden: { opacity: 0, y: 20 },
        visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 400, damping: 30 } }
    };

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
                <div className="w-12 h-12 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin" />
                <p className="text-slate-500 font-bold tracking-widest uppercase text-sm">Loading Roster...</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto pb-24 lg:pb-6 px-4 sm:px-6 lg:px-8 font-sans">
            
            
            <div className="space-y-4 sm:space-y-6">
                
                <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden bg-slate-900 rounded-2xl p-5 sm:p-8 lg:p-10 shadow-xs sm:shadow-sm group">
                    <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
                        <div>
                            <div className="flex items-center gap-2 sm:gap-3 mb-2 sm:mb-3">
                                <div className="h-9 w-9 sm:h-12 sm:w-12 bg-white/10 backdrop-blur-xl rounded-xl flex items-center justify-center border border-white/20 shadow-inner">
                                    <i className="ti ti-calendar-time text-lg sm:text-2xl text-blue-400" />
                                </div>
                                <span className="px-2.5 sm:px-4 py-0.5 sm:py-1 text-[10px] sm:text-xs font-black tracking-widest uppercase bg-blue-500/20 text-blue-300 rounded-md border border-blue-500/30">Workforce Control</span>
                            </div>
                            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-white tracking-tight">Shift Deployment</h1>
                            <p className="text-blue-100/70 font-medium mt-1 text-xs sm:text-base max-w-xl">Assign operating schedules and manage 24/7 coverage for all facility staff in real-time.</p>
                        </div>
                        
                        <div className="flex items-center justify-between sm:justify-start gap-3 sm:gap-4 bg-white/10 backdrop-blur-md border border-white/20 p-3 sm:p-4 rounded-xl shrink-0">
                            <div className="text-left sm:text-right">
                                <p className="text-[10px] sm:text-xs font-bold text-white/60 uppercase tracking-widest">Total Staff</p>
                                <p className="text-xl sm:text-3xl font-black text-white">{employees.length}</p>
                            </div>
                            <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-full bg-white/20 flex items-center justify-center text-white border border-white/30">
                                <i className="ti ti-users text-lg sm:text-xl" />
                            </div>
                        </div>
                    </div>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col md:flex-row gap-2.5 sm:gap-3 bg-white p-2 sm:p-3 rounded-2xl shadow-xs sm:shadow-sm border border-slate-100">
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
                </motion.div>

                <motion.div variants={containerVariants} initial="hidden" animate="visible" className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-5">
                    <AnimatePresence>
                        {filteredEmployees.map(employee => {
                            const activeShift = SHIFT_TYPES.find(s => s.id === employee.shift) || SHIFT_TYPES[3];
                            
                            return (
                                <motion.div 
                                    layout
                                    variants={cardVariants}
                                    initial="hidden" animate="visible" exit={{ opacity: 0, scale: 0.9 }}
                                    key={employee.id} 
                                    className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-100 shadow-xs sm:shadow-sm hover:shadow-lg transition-all duration-300 relative overflow-hidden group"
                                >
                                    <div className={`absolute -right-10 -top-10 w-32 h-32 rounded-full blur-3xl opacity-20 group-hover:opacity-40 transition-opacity ${activeShift.styles.bg}`} />
                                    
                                    <div className="flex items-start justify-between relative z-10">
                                        <div className="flex items-center gap-3">
                                            <div className="relative h-11 w-11 sm:h-12 sm:w-12 rounded-xl overflow-hidden shadow-inner border border-slate-200 shrink-0 bg-slate-50 flex items-center justify-center group-hover:scale-105 transition-transform">
                                                {employee.company_id && employee.id ? (
                                                    <img 
                                                        src={`https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${employee.company_id}/${employee.id}.jpg`}
                                                        onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                                                        alt={`${employee.first_name} ${employee.last_name}`}
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : null}
                                                <div 
                                                    className="w-full h-full rounded-xl flex items-center justify-center font-black text-slate-800 text-base sm:text-lg shadow-inner bg-slate-50 border border-slate-100"
                                                    style={{ display: (employee.company_id && employee.id) ? 'none' : 'flex' }}
                                                >
                                                    {employee.first_name?.charAt(0)}{employee.last_name?.charAt(0)}
                                                </div>
                                            </div>
                                            <div className="min-w-0">
                                                <h3 className="font-bold text-slate-800 text-sm sm:text-base tracking-tight group-hover:text-blue-600 transition-colors truncate">
                                                    {employee.first_name} {employee.last_name}
                                                </h3>
                                                <p className="text-[10px] text-slate-400 font-bold tracking-widest uppercase mt-0.5 truncate">{employee.department}</p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="mt-4 mb-4">
                                        <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border ${activeShift.styles.lightBg} ${activeShift.styles.text} ${activeShift.styles.border}`}>
                                            <div className={`w-2 h-2 rounded-full ${activeShift.styles.bg} animate-pulse`} />
                                            <span className="text-xs font-black uppercase tracking-widest">{activeShift.id}</span>
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
                                                        onClick={() => handleAssignShift(employee.id, shift.id)}
                                                        className={`flex-1 py-2 text-[11px] sm:text-xs font-bold rounded-lg transition-all duration-300 tap-active relative ${
                                                            isSelected 
                                                                ? `${shift.styles.bg} text-white shadow-md shadow-${shift.styles.bg}/30` 
                                                                : 'text-slate-500 hover:bg-white hover:text-slate-800'
                                                        }`}
                                                    >
                                                        {shift.id}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </motion.div>
                            );
                        })}
                    </AnimatePresence>
                </motion.div>

                {/* Empty state */}
                {filteredEmployees.length === 0 && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center p-8 sm:p-16 bg-white rounded-2xl border border-slate-100 shadow-xs sm:shadow-sm text-center">
                        <div className="w-16 h-16 sm:w-20 sm:h-20 bg-slate-50 rounded-2xl flex items-center justify-center mb-3 sm:mb-4">
                            <i className="ti ti-ghost text-3xl sm:text-4xl text-slate-300" />
                        </div>
                        <h3 className="text-lg sm:text-xl font-black text-slate-800 tracking-tight">No staff found</h3>
                        <p className="text-slate-400 font-medium text-xs sm:text-sm mt-1">Try adjusting your search or filters.</p>
                    </motion.div>
                )}
            </div>
        </div>
    );
}
