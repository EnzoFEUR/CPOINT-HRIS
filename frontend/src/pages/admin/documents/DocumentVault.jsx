import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../../supabaseClient';
import api from '../../../utils/api';

const CATEGORIES = ['Legal ID', 'Medical Record', 'Statutory', 'Other'];
const SUB_CATEGORIES = {
  'Legal ID': ['SSS', 'PhilHealth', 'Pag-IBIG', 'TIN'],
  'Medical Record': ['Fit-to-Work', 'PEME', 'Drug Test'],
  'Statutory': ['BIR 2316', 'Clearance'],
  'Other': ['General Document']
};

export default function DocumentVault() {
  const [documents, setDocuments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('Legal ID');
  const [filterStatus, setFilterStatus] = useState('All');
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [loading, setLoading] = useState(true);

  // Form State
  const [uploadData, setUploadData] = useState({
    employee_id: '',
    category: 'Legal ID',
    sub_category: 'SSS',
    file: null
  });

  useEffect(() => {
    fetchDocuments();
    fetchEmployees();
  }, [selectedCategory, filterStatus]);

  const fetchDocuments = async () => {
    setLoading(true);
    try {
      let url = `/api/documents?category=${selectedCategory}`;
      if (filterStatus !== 'All') url += `&status=${filterStatus}`;
      const res = await api.get(url);
      setDocuments(res.data.documents || []);
    } catch (err) {
      console.error('Failed to load documents:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchEmployees = async () => {
    const { data } = await supabase.from('employees').select('id, first_name, last_name, company_id');
    setEmployees(data || []);
  };

  const handleUploadSubmit = async (e) => {
    e.preventDefault();
    if (!uploadData.file || !uploadData.employee_id) return;

    try {
      const file = uploadData.file;
      const fileExt = file.name.split('.').pop();
      const filePath = `201_vault/${uploadData.employee_id}/${Date.now()}.${fileExt}`;

      // Upload to Supabase Storage Bucket 'documents'
      const { error: storageErr } = await supabase.storage
        .from('documents')
        .upload(filePath, file);

      if (storageErr) throw storageErr;

      // Save Metadata in PostgreSQL
      await api.post('/api/documents/record', {
        employee_id: uploadData.employee_id,
        category: uploadData.category,
        sub_category: uploadData.sub_category,
        file_name: file.name,
        file_path: filePath,
        file_size: file.size,
        file_type: file.type
      });

      setIsUploadOpen(false);
      setUploadData({ employee_id: '', category: 'Legal ID', sub_category: 'SSS', file: null });
      fetchDocuments();
    } catch (err) {
      alert(`Upload failed: ${err.message}`);
    }
  };

  const handleVerify = async (id, status, reason = '') => {
    try {
      await api.patch(`/api/documents/${id}/verify`, { status, rejection_reason: reason });
      fetchDocuments();
    } catch (err) {
      alert(`Verification failed: ${err.message}`);
    }
  };

  const getPublicUrl = (path) => {
    const { data } = supabase.storage.from('documents').getPublicUrl(path);
    return data.publicUrl;
  };

  return (
    <div className="p-6 bg-slate-900 text-slate-100 min-h-screen">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Digital 201 Document Vault</h1>
          <p className="text-slate-400 text-sm">Centralized statutory legal IDs, medical records, and audit compliance.</p>
        </div>
        <button
          onClick={() => setIsUploadOpen(true)}
          className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg font-medium shadow-md transition-all"
        >
          + Upload Document
        </button>
      </div>

      {/* Category Tabs & Status Filter */}
      <div className="flex flex-wrap justify-between items-center gap-4 mb-6 border-b border-slate-800 pb-4">
        <div className="flex space-x-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => { setSelectedCategory(cat); setUploadData(p => ({ ...p, category: cat, sub_category: SUB_CATEGORIES[cat][0] })); }}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                selectedCategory === cat ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="bg-slate-800 text-slate-200 text-sm rounded-lg px-3 py-2 border border-slate-700 outline-none"
        >
          <option value="All">All Verification Statuses</option>
          <option value="Pending">Pending</option>
          <option value="Verified">Verified</option>
          <option value="Rejected">Rejected</option>
        </select>
      </div>

      {/* Document Grid */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">Loading 201 vault records...</div>
      ) : documents.length === 0 ? (
        <div className="text-center py-12 bg-slate-800/40 rounded-xl border border-dashed border-slate-700 text-slate-400">
          No records found under {selectedCategory} ({filterStatus}).
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {documents.map((doc) => (
            <motion.div
              key={doc.id}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-col justify-between"
            >
              <div>
                <div className="flex justify-between items-start mb-2">
                  <span className="bg-slate-700 text-blue-400 text-xs font-semibold px-2.5 py-1 rounded">
                    {doc.sub_category}
                  </span>
                  <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                    doc.status === 'Verified' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                    doc.status === 'Rejected' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
                    'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                  }`}>
                    {doc.status}
                  </span>
                </div>
                <h3 className="font-semibold text-white truncate">{doc.file_name}</h3>
                <p className="text-slate-400 text-xs mt-1">
                  Employee: <span className="text-slate-200">{doc.employees?.first_name} {doc.employees?.last_name}</span> ({doc.employees?.company_id})
                </p>
                <p className="text-slate-500 text-xs mt-0.5">Uploaded: {new Date(doc.created_at).toLocaleDateString()}</p>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-700/60 flex items-center justify-between">
                <button
                  onClick={() => setPreviewDoc(doc)}
                  className="text-xs text-blue-400 hover:text-blue-300 font-medium underline"
                >
                  Preview Document
                </button>
                {doc.status === 'Pending' && (
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleVerify(doc.id, 'Verified')}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-2.5 py-1 rounded"
                    >
                      Verify
                    </button>
                    <button
                      onClick={() => {
                        const reason = prompt('Rejection Reason:');
                        if (reason) handleVerify(doc.id, 'Rejected', reason);
                      }}
                      className="bg-rose-600 hover:bg-rose-500 text-white text-xs px-2.5 py-1 rounded"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Upload Modal */}
      <AnimatePresence>
        {isUploadOpen && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-slate-800 border border-slate-700 rounded-xl max-w-md w-full p-6">
              <h2 className="text-lg font-bold text-white mb-4">Upload 201 Document</h2>
              <form onSubmit={handleUploadSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Select Employee</label>
                  <select
                    required
                    value={uploadData.employee_id}
                    onChange={(e) => setUploadData({ ...uploadData, employee_id: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-100"
                  >
                    <option value="">-- Choose Employee --</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name} ({emp.company_id})</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Category</label>
                    <select
                      value={uploadData.category}
                      onChange={(e) => setUploadData({ ...uploadData, category: e.target.value, sub_category: SUB_CATEGORIES[e.target.value][0] })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-100"
                    >
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Sub-Category</label>
                    <select
                      value={uploadData.sub_category}
                      onChange={(e) => setUploadData({ ...uploadData, sub_category: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-100"
                    >
                      {SUB_CATEGORIES[uploadData.category].map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Document File</label>
                  <input
                    type="file"
                    required
                    accept=".pdf,.png,.jpg,.jpeg"
                    onChange={(e) => setUploadData({ ...uploadData, file: e.target.files[0] })}
                    className="w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-slate-700 file:text-slate-200 hover:file:bg-slate-600"
                  />
                </div>

                <div className="flex justify-end space-x-2 pt-4 border-t border-slate-700">
                  <button type="button" onClick={() => setIsUploadOpen(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
                  <button type="submit" className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium">Upload File</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Preview Modal */}
      <AnimatePresence>
        {previewDoc && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <div className="bg-slate-800 border border-slate-700 rounded-xl max-w-3xl w-full h-[80vh] flex flex-col p-4">
              <div className="flex justify-between items-center mb-2 pb-2 border-b border-slate-700">
                <h3 className="font-bold text-white">{previewDoc.file_name}</h3>
                <button onClick={() => setPreviewDoc(null)} className="text-slate-400 hover:text-white text-lg">✕</button>
              </div>
              <iframe
                src={getPublicUrl(previewDoc.file_path)}
                className="w-full flex-1 rounded bg-slate-900"
                title="Document Preview"
              />
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}