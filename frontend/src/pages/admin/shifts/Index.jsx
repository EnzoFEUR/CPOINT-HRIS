import React, { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';

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
            const res = await fetch('http://localhost:5000/api/shifts');
            const data = await res.json();
            setEmployees(data);
        } catch (err) {
            console.error("Failed to fetch shifts:", err);
            toast.error("Failed to load shift engine");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchEmployees();
    }, []);

    const handleAssignShift = async (employee_id, shift) => {
        // Optimistic UI update for premium snappy feel
        const previousEmployees = [...employees];
        const employee = employees.find(e => e.id === employee_id);
        setEmployees(prev => prev.map(emp => emp.id === employee_id ? { ...emp, shift } : emp));

        try {
            const user = JSON.parse(localStorage.getItem('user'));
            const res = await fetch('http://localhost:5000/api/shifts/assign', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ employee_id, shift, admin_id: user?.id })
            });
            const data = await res.json();
            if (data.success) {
                toast.success('Shift assigned successfully!', { icon: '✨' });
            } else {
                toast.error(data.error);
                setEmployees(previousEmployees); // Rollback
            }
        } catch (err) {
            toast.error('Network Error');
            setEmployees(previousEmployees); // Rollback
        }
    };

    const departments = useMemo(() => {
        const depts = new Set(employees.map(e => e.department));
        return ['All', ...Array.from(depts).filter(Boolean)];
    }, [employees]);

    const filteredEmployees = useMemo(() => {
        return employees.filter(emp => {
            const matchSearch = `${emp.first_name} ${emp.last_name}`.toLowerCase().includes(searchQuery.toLowerCase());
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
        <div className="max-w-7xl mx-auto pb-16 font-sans">
            
            {/* AMBIENT BACKGROUND */}
            <div className="fixed top-[-10%] left-[-5%] w-[40vw] h-[40vw] bg-blue-500/5 rounded-full blur-[120px] pointer-events-none -z-10" />
            <div className="fixed bottom-[-10%] right-[-5%] w-[40vw] h-[40vw] bg-indigo-500/5 rounded-full blur-[120px] pointer-events-none -z-10" />

            <div className="space-y-8">
                
                {/* 1. PREMIUM HEADER */}
                <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden bg-slate-900 rounded-[2.5rem] p-8 md:p-12 shadow-2xl shadow-slate-900/20 group">
                    <div className="absolute top-0 right-0 w-[30rem] h-[30rem] bg-gradient-to-bl from-blue-500/20 to-indigo-600/20 rounded-full blur-3xl -mr-20 -mt-20 transition-transform duration-700 group-hover:scale-110 pointer-events-none" />
                    
                    <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <div className="flex items-center gap-3 mb-4">
                                <div className="h-12 w-12 bg-white/10 backdrop-blur-xl rounded-2xl flex items-center justify-center border border-white/20 shadow-inner">
                                    <i className="ti ti-calendar-time text-2xl text-blue-400" />
                                </div>
                                <span className="px-4 py-1.5 text-xs font-black tracking-widest uppercase bg-blue-500/20 text-blue-300 rounded-xl border border-blue-500/30">Workforce Control</span>
                            </div>
                            <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight">Shift Deployment</h1>
                            <p className="text-blue-100/70 font-medium mt-2 text-lg max-w-xl">Assign operating schedules and manage 24/7 coverage for all facility staff in real-time.</p>
                        </div>
                        
                        {/* Summary Widget */}
                        <div className="flex items-center gap-4 bg-white/10 backdrop-blur-md border border-white/20 p-5 rounded-[2rem]">
                            <div className="text-right">
                                <p className="text-xs font-bold text-white/60 uppercase tracking-widest">Total Staff</p>
                                <p className="text-3xl font-black text-white">{employees.length}</p>
                            </div>
                            <div className="h-14 w-14 rounded-full bg-white/20 flex items-center justify-center text-white border border-white/30">
                                <i className="ti ti-users text-2xl" />
                            </div>
                        </div>
                    </div>
                </motion.div>

                {/* 2. SEARCH & FILTER BAR */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col md:flex-row gap-4 bg-white p-3 rounded-[2rem] shadow-sm border border-slate-100">
                    <div className="relative flex-1">
                        <i className="ti ti-search absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 text-lg" />
                        <input 
                            type="text" 
                            placeholder="Search employees by name..." 
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-12 pr-6 py-4 bg-slate-50 border-none rounded-2xl outline-none focus:ring-4 focus:ring-blue-500/10 font-bold text-slate-700 transition-all placeholder:text-slate-400 placeholder:font-medium"
                        />
                    </div>
                    <div className="relative min-w-[200px]">
                        <i className="ti ti-building absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 text-lg z-10" />
                        <select 
                            value={filterDept}
                            onChange={(e) => setFilterDept(e.target.value)}
                            className="w-full pl-12 pr-6 py-4 bg-slate-50 border-none rounded-2xl outline-none focus:ring-4 focus:ring-blue-500/10 font-bold text-slate-700 transition-all appearance-none cursor-pointer"
                        >
                            {departments.map(dept => <option key={dept} value={dept}>{dept} Dept</option>)}
                        </select>
                        <i className="ti ti-chevron-down absolute right-5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    </div>
                </motion.div>

                {/* 3. ROSTER GRID */}
                <motion.div variants={containerVariants} initial="hidden" animate="visible" className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    <AnimatePresence>
                        {filteredEmployees.map(employee => {
                            const activeShift = SHIFT_TYPES.find(s => s.id === employee.shift) || SHIFT_TYPES[3];
                            
                            return (
                                <motion.div 
                                    layout
                                    variants={cardVariants}
                                    initial="hidden" animate="visible" exit={{ opacity: 0, scale: 0.9 }}
                                    key={employee.id} 
                                    className="bg-white rounded-[2.5rem] p-6 border border-slate-100 shadow-sm hover:shadow-xl hover:shadow-slate-200/50 transition-all duration-300 relative overflow-hidden group"
                                >
                                    {/* Ambient Glow behind card */}
                                    <div className={`absolute -right-10 -top-10 w-32 h-32 rounded-full blur-3xl opacity-20 group-hover:opacity-40 transition-opacity ${activeShift.styles.bg}`} />
                                    
                                    {/* Top Section: Identity & Current Shift */}
                                    <div className="flex items-start justify-between relative z-10">
                                        <div className="flex items-center gap-4">
                                            <div className="h-14 w-14 rounded-2xl bg-slate-50 flex items-center justify-center font-black text-slate-800 text-xl shadow-inner border border-slate-100 shrink-0">
                                                {employee.first_name.charAt(0)}{employee.last_name.charAt(0)}
                                            </div>
                                            <div>
                                                <h3 className="font-black text-slate-800 text-lg tracking-tight group-hover:text-blue-600 transition-colors">
                                                    {employee.first_name} {employee.last_name}
                                                </h3>
                                                <p className="text-xs text-slate-400 font-bold tracking-widest uppercase mt-0.5">{employee.department}</p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Middle Section: Current Status */}
                                    <div className="mt-6 mb-6">
                                        <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border ${activeShift.styles.lightBg} ${activeShift.styles.text} ${activeShift.styles.border}`}>
                                            <div className={`w-2 h-2 rounded-full ${activeShift.styles.bg} animate-pulse`} />
                                            <span className="text-sm font-black uppercase tracking-widest">{activeShift.id}</span>
                                        </div>
                                        <p className="text-xs font-bold text-slate-400 mt-2 ml-1">
                                            {activeShift.time}
                                        </p>
                                    </div>

                                    {/* Bottom Section: Segmented Control Assignment */}
                                    <div className="relative z-10 pt-5 border-t border-slate-50">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Reassign Schedule</p>
                                        <div className="flex bg-slate-50 p-1.5 rounded-2xl border border-slate-100">
                                            {SHIFT_TYPES.slice(0, 3).map(shift => {
                                                const isSelected = employee.shift === shift.id;
                                                return (
                                                    <button 
                                                        key={shift.id}
                                                        onClick={() => handleAssignShift(employee.id, shift.id)}
                                                        className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all duration-300 relative ${
                                                            isSelected 
                                                                ? `${shift.styles.bg} text-white shadow-md shadow-${shift.styles.bg}/30` 
                                                                : 'text-slate-500 hover:bg-white hover:text-slate-800 hover:shadow-sm'
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

                {/* EMPTY STATE */}
                {filteredEmployees.length === 0 && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center p-16 bg-white rounded-[3rem] border border-slate-100 shadow-sm text-center">
                        <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mb-4">
                            <i className="ti ti-ghost text-4xl text-slate-300" />
                        </div>
                        <h3 className="text-xl font-black text-slate-800 tracking-tight">No staff found</h3>
                        <p className="text-slate-400 font-medium mt-1">Try adjusting your search or filters.</p>
                    </motion.div>
                )}
            </div>
        </div>
    );
}
