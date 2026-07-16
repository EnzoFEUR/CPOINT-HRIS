import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';

const Index = () => {
    const fetchAttendance = async () => {
        const res = await fetch('http://localhost:5000/api/attendance');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch');
        return data || [];
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

    const paginatedLogs = filteredLogs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    const containerVariants = {
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { staggerChildren: 0.05 } }
    };
    
    const rowVariants = {
        hidden: { opacity: 0, y: 10 },
        visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 400, damping: 30 } }
    };

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
                <div className="w-12 h-12 border-4 border-slate-200 border-t-cyan-500 rounded-full animate-spin" />
                <p className="text-slate-500 font-bold tracking-widest uppercase text-sm">Loading Biometrics...</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto pb-16 font-sans">
            
            
            
            

            <div className="space-y-8">
                
                {/* Page header */}
                <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden bg-slate-900 rounded-md p-8 md:p-12 shadow-sm group">
                    
                    
                    <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-8">
                        <div>
                            <div className="flex items-center gap-3 mb-4">
                                <div className="h-12 w-12 bg-white/10 backdrop-blur-xl rounded-lg flex items-center justify-center border border-white/20 shadow-inner">
                                    <i className="ti ti-scan text-2xl text-cyan-400" />
                                </div>
                                <span className="px-4 py-1.5 text-xs font-black tracking-widest uppercase bg-cyan-500/20 text-cyan-300 rounded-md border border-cyan-500/30">Biometric Surveillance</span>
                            </div>
                            <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight">Real-Time Attendance</h1>
                            <p className="text-cyan-100/70 font-medium mt-2 text-lg max-w-xl">Monitor live clock-ins, verify Face-AI proofs, and track daily facility access.</p>
                        </div>
                        
                        {/* Summary Widget */}
                        <div className="flex items-center gap-4 bg-white/10 backdrop-blur-md border border-white/20 p-5 rounded-lg">
                            <div className="text-right">
                                <p className="text-xs font-bold text-white/60 uppercase tracking-widest">Today's Scans</p>
                                <p className="text-3xl font-black text-white">{todaysCount}</p>
                            </div>
                            <div className="h-14 w-14 rounded-full bg-cyan-500/30 flex items-center justify-center text-cyan-300 border border-cyan-500/50">
                                <i className="ti ti-radar text-2xl animate-pulse" />
                            </div>
                        </div>
                    </div>
                </motion.div>

                {/* Search */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex bg-white p-3 rounded-lg shadow-sm border border-slate-100">
                    <div className="relative flex-1">
                        <i className="ti ti-search absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 text-xl" />
                        <input 
                            type="text" 
                            placeholder="Search by employee name or date (YYYY-MM-DD)..." 
                            value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value);
                                setCurrentPage(1); // Reset pagination on search
                            }}
                            className="w-full pl-14 pr-6 py-4 bg-slate-50 border-none rounded-lg outline-none focus:ring-4 focus:ring-cyan-500/10 font-bold text-slate-700 transition-all placeholder:text-slate-400 placeholder:font-medium"
                        />
                    </div>
                </motion.div>

                {/* Data table */}
                <motion.div variants={containerVariants} initial="hidden" animate="visible" className="bg-white rounded-md shadow-sm border border-slate-100 overflow-hidden">
                    <div className="overflow-x-auto overflow-y-hidden">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-slate-50/80 text-slate-400 text-xs uppercase tracking-widest font-black border-b border-slate-100">
                                <tr>
                                    <th className="px-8 py-6">Employee</th>
                                    <th className="px-8 py-6">Date</th>
                                    <th className="px-8 py-6 text-center">Time In</th>
                                    <th className="px-8 py-6 text-center">Time Out</th>
                                    <th className="px-8 py-6 text-center">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                <AnimatePresence>
                                    {paginatedLogs.length > 0 ? paginatedLogs.map((log) => (
                                        <motion.tr variants={rowVariants} key={log.id} className="hover:bg-cyan-50/30 transition-colors group">
                                            
                                            {/* Employee Column */}
                                            <td className="px-8 py-5">
                                                <div className="flex items-center gap-4">
                                                    <div className="h-12 w-12 rounded-lg bg-cyan-50 flex items-center justify-center font-black text-cyan-600 text-lg shadow-inner border border-cyan-100 shrink-0">
                                                        {(log.employees?.first_name || '?').charAt(0)}
                                                    </div>
                                                    <div>
                                                        <p className="text-base font-black text-slate-800 group-hover:text-cyan-600 transition-colors">
                                                            {log.employees ? `${log.employees.first_name} ${log.employees.last_name}` : 'Unknown'}
                                                        </p>
                                                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">ID: #{String(log.employee_id).substring(0,8)}</p>
                                                    </div>
                                                </div>
                                            </td>

                                            {/* Date Column */}
                                            <td className="px-8 py-5">
                                                <p className="text-sm font-bold text-slate-600">
                                                    {new Date(log.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                                </p>
                                            </td>
                                            
                                            {/* Time In Column */}
                                            <td className="px-8 py-5 text-center">
                                                <div className="flex flex-col items-center gap-2">
                                                    <span className="font-mono text-emerald-600 font-bold bg-emerald-50 px-3 py-1 rounded-lg text-sm border border-emerald-100">
                                                        {new Date(log.time_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                    {log.time_in_photo ? (
                                                        <button 
                                                            onClick={(e) => { e.stopPropagation(); openImageModal(`https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${log.time_in_photo}`, 'Time In'); }}
                                                            className="relative w-12 h-12 rounded-md overflow-hidden border-2 border-white shadow-md hover:scale-110 hover:shadow-lg transition-all cursor-zoom-in group/img"
                                                        >
                                                            <div className="absolute inset-0 bg-black/20 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center">
                                                                <i className="ti ti-maximize text-white" />
                                                            </div>
                                                            <img src={`https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${log.time_in_photo}`} className="w-full h-full object-cover" alt="Proof" />
                                                        </button>
                                                    ) : (
                                                        <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">No Proof</span>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Time Out Column */}
                                            <td className="px-8 py-5 text-center">
                                                <div className="flex flex-col items-center gap-2">
                                                    {log.time_out ? (
                                                        <span className="font-mono text-slate-600 font-bold bg-slate-100 px-3 py-1 rounded-lg text-sm border border-slate-200">
                                                            {new Date(log.time_out).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                    ) : (
                                                        <span className="bg-amber-50 text-amber-600 border border-amber-100 px-3 py-1 rounded-lg text-sm font-bold animate-pulse">
                                                            Active
                                                        </span>
                                                    )}
                                                    {log.time_out_photo && (
                                                        <button 
                                                            onClick={(e) => { e.stopPropagation(); openImageModal(`https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${log.time_out_photo}`, 'Time Out'); }}
                                                            className="relative w-12 h-12 rounded-md overflow-hidden border-2 border-white shadow-md hover:scale-110 hover:shadow-lg transition-all cursor-zoom-in group/img"
                                                        >
                                                            <div className="absolute inset-0 bg-black/20 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center">
                                                                <i className="ti ti-maximize text-white" />
                                                            </div>
                                                            <img src={`https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${log.time_out_photo}`} className="w-full h-full object-cover" alt="Proof" />
                                                        </button>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Status Column */}
                                            <td className="px-8 py-5 text-center">
                                                <span className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-md border ${
                                                    log.status.includes('Late') ? 'bg-orange-50 text-orange-600 border-orange-200' : 
                                                    'bg-cyan-50 text-cyan-600 border-cyan-200'
                                                }`}>
                                                    {log.status}
                                                </span>
                                            </td>
                                        </motion.tr>
                                    )) : (
                                        <motion.tr variants={rowVariants}>
                                            <td colSpan="5" className="px-8 py-20 text-center">
                                                <div className="flex flex-col items-center justify-center text-slate-400">
                                                    <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mb-4">
                                                        <i className="ti ti-ghost text-4xl text-slate-300" />
                                                    </div>
                                                    <p className="text-xl font-black text-slate-800 tracking-tight">No Scans Found</p>
                                                    <p className="text-sm font-medium mt-1 max-w-sm">No one has clocked in recently or your search returned no results.</p>
                                                </div>
                                            </td>
                                        </motion.tr>
                                    )}
                                </AnimatePresence>
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    {Math.ceil(filteredLogs.length / itemsPerPage) > 1 && (
                        <div className="px-8 py-6 border-t border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row items-center justify-between gap-4">
                            <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                                Showing <span className="text-slate-800">{(currentPage - 1) * itemsPerPage + 1}</span> - <span className="text-slate-800">{Math.min(currentPage * itemsPerPage, filteredLogs.length)}</span> of <span className="text-slate-800">{filteredLogs.length}</span>
                            </span>
                            <div className="flex gap-2">
                                <button 
                                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                    disabled={currentPage === 1}
                                    className="px-5 py-2.5 rounded-md bg-white border border-slate-200 text-xs font-bold uppercase tracking-widest text-slate-600 hover:bg-cyan-50 hover:text-cyan-600 hover:border-cyan-200 disabled:opacity-50 disabled:pointer-events-none transition-all shadow-sm flex items-center gap-2"
                                >
                                    <i className="ti ti-chevron-left text-lg" /> Prev
                                </button>
                                <button 
                                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, Math.ceil(filteredLogs.length / itemsPerPage)))}
                                    disabled={currentPage === Math.ceil(filteredLogs.length / itemsPerPage)}
                                    className="px-5 py-2.5 rounded-md bg-white border border-slate-200 text-xs font-bold uppercase tracking-widest text-slate-600 hover:bg-cyan-50 hover:text-cyan-600 hover:border-cyan-200 disabled:opacity-50 disabled:pointer-events-none transition-all shadow-sm flex items-center gap-2"
                                >
                                    Next <i className="ti ti-chevron-right text-lg" />
                                </button>
                            </div>
                        </div>
                    )}
                </motion.div>
            </div>

            {/* Image modal */}
            <AnimatePresence>
                {isModalOpen && selectedImage && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                        <motion.div 
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-slate-900/80 backdrop-blur-md"
                            onClick={closeImageModal}
                        />
                        <motion.div 
                            initial={{ scale: 0.9, y: 20, opacity: 0 }}
                            animate={{ scale: 1, y: 0, opacity: 1 }}
                            exit={{ scale: 0.9, y: 20, opacity: 0 }}
                            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                            className="relative bg-white rounded-[3rem] p-4 w-full max-w-lg shadow-2xl"
                        >
                            <button 
                                onClick={closeImageModal}
                                className="absolute -top-4 -right-4 w-12 h-12 bg-white text-slate-800 rounded-full shadow-xl flex items-center justify-center hover:bg-slate-100 hover:scale-110 transition-all z-10"
                            >
                                <i className="ti ti-x text-xl font-bold" />
                            </button>
                            <div className="rounded-md overflow-hidden bg-slate-100 flex justify-center min-h-[200px]">
                                <img key={selectedImage} src={selectedImage} alt="Verification" className="w-full h-auto object-contain max-h-[70vh]" />
                            </div>
                            <div className="p-4 text-center">
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                                    {selectedImageType} Verification Capture
                                </p>
                                <p className="text-[9px] text-slate-300 mt-1 max-w-full break-all px-4">{selectedImage.split('/').pop()}</p>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

        </div>
    );
};

export default Index;
