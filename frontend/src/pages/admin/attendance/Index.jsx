import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchWithAuth } from '../../../utils/api';
import EmployeeAvatar from '../../../components/EmployeeAvatar';
import PageHeader from '../../../components/ui/PageHeader';
import Badge from '../../../components/ui/Badge';

const Index = () => {
    const fetchAttendance = async () => {
        const res = await fetchWithAuth('/api/attendance');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch');
        return data.data || data || [];
    };

    const { data: logs = [], isLoading } = useQuery({
        queryKey: ['adminAttendance'],
        queryFn: fetchAttendance
    });

    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;
    const [selectedImage, setSelectedImage] = useState(null);
    const [selectedImageType, setSelectedImageType] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    const todayStr = new Date().toISOString().split('T')[0];
    const todaysCount = logs.filter(log => log.date === todayStr).length;

    const openImageModal = (imageUrl, type) => {
        if (!imageUrl) return;
        setSelectedImage(imageUrl);
        setSelectedImageType(type);
        setIsModalOpen(true);
        document.body.style.overflow = 'hidden';
    };

    const closeImageModal = () => {
        setIsModalOpen(false);
        document.body.style.overflow = '';
        setTimeout(() => setSelectedImage(null), 300);
    };

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && isModalOpen) closeImageModal();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isModalOpen]);

    const filteredLogs = logs.filter(log => {
        const name = `${log.employees?.first_name} ${log.employees?.last_name}`.toLowerCase();
        return name.includes(searchQuery.toLowerCase()) || log.date.includes(searchQuery);
    });

    const totalItems = filteredLogs.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
    const paginatedLogs = filteredLogs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
                <div className="w-10 h-10 border-3 border-slate-200 border-t-blue-600 rounded-full animate-spin" />
                <p className="text-slate-500 font-semibold tracking-wider uppercase text-xs">Loading Attendance Records...</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto pb-24 lg:pb-8 px-4 sm:px-6 lg:px-8 font-sans">
            <PageHeader
                breadcrumbs={['Admin', 'Surveillance', 'Attendance Logs']}
                title="Real-Time Attendance"
                description="Live employee biometric punch records, facial verification audits, and facility access history."
                actions={
                    <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 px-3.5 py-2 rounded-lg">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Today's Scans:</span>
                        <span className="font-mono text-sm font-bold text-slate-900 tabular-nums">{todaysCount}</span>
                    </div>
                }
            />

            <div className="space-y-4 sm:space-y-6">
                {/* Search & Filter Bar */}
                <div className="flex bg-white p-2 sm:p-2.5 rounded-xl shadow-xs border border-slate-200">
                    <div className="relative flex-1">
                        <i className="ti ti-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-lg" />
                        <input 
                            type="text" 
                            placeholder="Search by employee name, ID, or date (YYYY-MM-DD)..." 
                            value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value);
                                setCurrentPage(1);
                            }}
                            className="w-full pl-11 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 font-medium text-slate-800 transition-colors placeholder:text-slate-400"
                        />
                    </div>
                </div>

                <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
                    
                    {/* MOBILE LIST VIEW (Visible on phones only) */}
                    <div className="block md:hidden divide-y divide-slate-100">
                        {paginatedLogs.length > 0 ? paginatedLogs.map((log) => (
                            <div 
                                key={`mobile-${log.id}`} 
                                className="p-4 space-y-3 hover:bg-cyan-50/20 transition-colors"
                            >
                                {/* Card Header: Employee Info + Date */}
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <EmployeeAvatar employee={log.employees} employeeId={log.employee_id} size="h-10 w-10" />
                                        <div className="min-w-0">
                                            <p className="text-sm font-black text-slate-800 truncate">
                                                {log.employees ? `${log.employees.first_name} ${log.employees.last_name}` : 'Unknown'}
                                            </p>
                                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                                                ID: #{String(log.employee_id).substring(0,8)}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="text-right shrink-0">
                                        <span className="text-[11px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                                            {new Date(log.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                        </span>
                                    </div>
                                </div>

                                {/* Card Timing Grid */}
                                <div className="grid grid-cols-2 gap-2 bg-slate-50/80 p-2.5 rounded-xl border border-slate-100">
                                    {/* Time In */}
                                    <div className="flex items-center justify-between gap-2">
                                        <div>
                                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Time In</p>
                                            <span className="font-mono text-xs font-bold text-emerald-600">
                                                {new Date(log.time_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                        {log.time_in_photo && (
                                            <button 
                                                onClick={() => openImageModal(`https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${log.time_in_photo}`, 'Time In Proof')}
                                                onContextMenu={(e) => e.preventDefault()}
                                                className="w-8 h-8 rounded-lg overflow-hidden border border-slate-200 shadow-xs shrink-0 tap-active select-none"
                                            >
                                                <img 
                                                    src={`https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${log.time_in_photo}`} 
                                                    onContextMenu={(e) => e.preventDefault()}
                                                    draggable={false}
                                                    className="w-full h-full object-cover pointer-events-none select-none" 
                                                    alt="Proof" 
                                                />
                                            </button>
                                        )}
                                    </div>

                                    {/* Time Out */}
                                    <div className="flex items-center justify-between gap-2 border-l border-slate-200 pl-2">
                                        <div>
                                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Time Out</p>
                                            {log.time_out ? (
                                                <span className="font-mono text-xs font-bold text-slate-700">
                                                    {new Date(log.time_out).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            ) : log.date === new Date().toISOString().split('T')[0] ? (
                                                <span className="text-[10px] font-black text-amber-600 uppercase tracking-wider">
                                                    Active
                                                </span>
                                            ) : (
                                                <span className="text-[9px] font-black text-red-500 uppercase tracking-wider">
                                                    Missed
                                                </span>
                                            )}
                                        </div>
                                        {log.time_out_photo && (
                                            <button 
                                                onClick={() => openImageModal(`https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${log.time_out_photo}`, 'Time Out Proof')}
                                                onContextMenu={(e) => e.preventDefault()}
                                                className="w-8 h-8 rounded-lg overflow-hidden border border-slate-200 shadow-xs shrink-0 tap-active select-none"
                                            >
                                                <img 
                                                    src={`https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${log.time_out_photo}`} 
                                                    onContextMenu={(e) => e.preventDefault()}
                                                    draggable={false}
                                                    className="w-full h-full object-cover pointer-events-none select-none" 
                                                    alt="Proof" 
                                                />
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* Card Footer: Status */}
                                <div className="flex items-center justify-between pt-1">
                                    <Badge 
                                        variant={
                                            log.status?.toLowerCase().includes('absent') ? 'absent' :
                                            log.status?.toLowerCase().includes('late') ? 'late' : 
                                            'present'
                                        }
                                    >
                                        {log.status}
                                    </Badge>
                                </div>
                            </div>
                        )) : (
                            <div className="p-8 text-center text-slate-400">
                                <p className="text-xs font-bold">No attendance records found</p>
                            </div>
                        )}
                    </div>

                    {/* DESKTOP TABLE VIEW (Visible on tablet & desktop) */}
                    <div className="hidden md:block overflow-x-auto no-scrollbar [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider font-semibold border-b border-slate-200">
                                <tr>
                                    <th className="px-6 py-3.5">Employee</th>
                                    <th className="px-6 py-3.5">Date</th>
                                    <th className="px-6 py-3.5 text-center">Time In</th>
                                    <th className="px-6 py-3.5 text-center">Time Out</th>
                                    <th className="px-6 py-3.5 text-center">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-sm">
                                {paginatedLogs.length > 0 ? paginatedLogs.map((log) => (
                                    <tr key={log.id} className="hover:bg-slate-50/70 transition-colors duration-100">
                                        <td className="px-6 py-3.5">
                                            <div className="flex items-center gap-3">
                                                <EmployeeAvatar employee={log.employees} employeeId={log.employee_id} size="h-10 w-10" />
                                                <div>
                                                    <p className="text-sm font-semibold text-slate-900">
                                                        {log.employees ? `${log.employees.first_name} ${log.employees.last_name}` : 'Unknown'}
                                                    </p>
                                                    <p className="text-[11px] text-slate-400 font-mono">ID: #{String(log.employee_id).substring(0,8)}</p>
                                                </div>
                                            </div>
                                        </td>

                                        {/* Date Column */}
                                        <td className="px-6 py-3.5">
                                            <p className="text-sm font-medium text-slate-600 font-mono tabular-nums">
                                                {new Date(log.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                            </p>
                                        </td>
                                        
                                        {/* Time In Column */}
                                        <td className="px-6 py-3.5 text-center">
                                            <div className="flex flex-col items-center gap-1.5">
                                                {log.time_in ? (
                                                    <span className="font-mono text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-200 tabular-nums">
                                                        {new Date(log.time_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                ) : (
                                                    <span className="text-xs text-slate-300 font-mono">--:--</span>
                                                )}
                                                {log.time_in_photo && (
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); openImageModal(`https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${log.time_in_photo}`, 'Time In'); }}
                                                        onContextMenu={(e) => e.preventDefault()}
                                                        className="relative w-9 h-9 rounded overflow-hidden border border-slate-200 shadow-xs hover:border-blue-500 transition-all cursor-zoom-in group/img select-none"
                                                    >
                                                        <img 
                                                            src={`https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${log.time_in_photo}`} 
                                                            onContextMenu={(e) => e.preventDefault()}
                                                            draggable={false}
                                                            className="w-full h-full object-cover pointer-events-none select-none" 
                                                            alt="Proof" 
                                                        />
                                                    </button>
                                                )}
                                            </div>
                                        </td>

                                        {/* Time Out Column */}
                                        <td className="px-6 py-3.5 text-center">
                                            <div className="flex flex-col items-center gap-1.5">
                                                {log.time_out ? (
                                                    <span className="font-mono text-xs font-semibold text-slate-700 bg-slate-100 px-2.5 py-0.5 rounded border border-slate-200 tabular-nums">
                                                        {new Date(log.time_out).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                ) : log.date === new Date().toISOString().split('T')[0] ? (
                                                    <span className="bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wider">
                                                        Active
                                                    </span>
                                                ) : (
                                                    <span className="bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wider">
                                                        Missed Punch
                                                    </span>
                                                )}
                                                {log.time_out_photo && (
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); openImageModal(`https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${log.time_out_photo}`, 'Time Out'); }}
                                                        onContextMenu={(e) => e.preventDefault()}
                                                        className="relative w-9 h-9 rounded overflow-hidden border border-slate-200 shadow-xs hover:border-blue-500 transition-all cursor-zoom-in group/img select-none"
                                                    >
                                                        <img 
                                                            src={`https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${log.time_out_photo}`} 
                                                            onContextMenu={(e) => e.preventDefault()}
                                                            draggable={false}
                                                            className="w-full h-full object-cover pointer-events-none select-none" 
                                                            alt="Proof" 
                                                        />
                                                    </button>
                                                )}
                                            </div>
                                        </td>

                                        {/* Status Column */}
                                        <td className="px-6 py-3.5 text-center">
                                            <Badge 
                                                variant={
                                                    log.status?.toLowerCase().includes('absent') ? 'absent' :
                                                    log.status?.toLowerCase().includes('late') ? 'late' : 
                                                    'present'
                                                }
                                            >
                                                {log.status}
                                            </Badge>
                                        </td>
                                    </tr>
                                )) : (
                                    <tr>
                                        <td colSpan="5" className="px-6 py-20 text-center">
                                            <div className="flex flex-col items-center justify-center text-slate-400">
                                                <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mb-4">
                                                    <i className="ti ti-ghost text-4xl text-slate-300" />
                                                </div>
                                                <p className="text-xl font-black text-slate-800 tracking-tight">No Scans Found</p>
                                                <p className="text-sm font-medium mt-1 max-w-sm">No one has clocked in recently or your search returned no results.</p>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* PAGINATION BAR */}
                    <div className="px-4 sm:px-8 py-4 border-t border-slate-100 bg-slate-50/60 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 font-bold">
                        <div>
                            {totalItems > 0 ? (
                                <span>Showing <span className="text-slate-800 font-black">{(currentPage - 1) * itemsPerPage + 1}</span> - <span className="text-slate-800 font-black">{Math.min(currentPage * itemsPerPage, totalItems)}</span> of <span className="text-slate-800 font-black">{totalItems}</span></span>
                            ) : (
                                <span>Showing <span className="text-slate-800 font-black">0</span> of <span className="text-slate-800 font-black">0</span></span>
                            )}
                        </div>

                        <div className="flex items-center gap-2">
                            <button 
                                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                disabled={currentPage === 1}
                                className="px-3.5 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed tap-active transition-all shadow-xs flex items-center gap-1.5"
                            >
                                <i className="ti ti-chevron-left text-sm" /> Prev
                            </button>
                            
                            <span className="px-3 py-1 bg-white border border-slate-200 rounded-xl text-slate-800 font-black text-xs">
                                {currentPage} / {totalPages}
                            </span>

                            <button 
                                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                                disabled={currentPage >= totalPages}
                                className="px-3.5 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed tap-active transition-all shadow-xs flex items-center gap-1.5"
                            >
                                Next <i className="ti ti-chevron-right text-sm" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Image modal */}
            
                {isModalOpen && selectedImage && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                        <div 
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-slate-900/80 backdrop-blur-md"
                            onClick={closeImageModal}
                        />
                        <div 
                            initial={{ scale: 0.95, y: 15, opacity: 0 }}
                            animate={{ scale: 1, y: 0, opacity: 1 }}
                            exit={{ scale: 0.95, y: 15, opacity: 0 }}
                            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                            className="relative bg-white rounded-[2px] p-5 w-full max-w-lg shadow-2xl border border-slate-200"
                        >
                            {/* Modal Header */}
                            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
                                <div>
                                    <h3 className="text-sm font-bold text-slate-800 tracking-wide flex items-center gap-1.5">
                                        <i className="ti ti-camera text-blue-500 text-base" />
                                        <span>{selectedImageType} Verification Capture</span>
                                    </h3>
                                    <p className="text-[10px] font-mono text-slate-400 mt-0.5 truncate max-w-[340px]">
                                        {selectedImage.split('/').pop()}
                                    </p>
                                </div>
                                <button 
                                    onClick={closeImageModal}
                                    title="Close Preview (Esc)"
                                    className="w-8 h-8 rounded-full bg-slate-100 hover:bg-red-50 text-slate-500 hover:text-red-500 flex items-center justify-center transition-all duration-200 hover:rotate-90 shadow-sm border border-slate-200 cursor-pointer active:scale-95"
                                >
                                    <i className="ti ti-x text-lg font-bold" />
                                </button>
                            </div>

                            {/* Image Container with subtle 2px rounding & anti-save protections */}
                            <div 
                                onContextMenu={(e) => e.preventDefault()}
                                className="bg-slate-900/5 rounded-[2px] overflow-hidden flex justify-center min-h-[200px] border border-slate-200 select-none"
                            >
                                <img 
                                    key={selectedImage} 
                                    src={selectedImage} 
                                    onContextMenu={(e) => e.preventDefault()}
                                    draggable={false}
                                    alt="Verification" 
                                    className="w-full h-auto object-contain max-h-[65vh] rounded-[2px] pointer-events-none select-none" 
                                />
                            </div>
                        </div>
                    </div>
                )}
            

        </div>
    );
};

export default Index;
