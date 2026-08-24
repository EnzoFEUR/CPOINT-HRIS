import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import api from '../../utils/api';

export default function DocumentRequestPortal() {
  const [requests, setRequests] = useState([]);
  const [documentType, setDocumentType] = useState('COE');
  const [purpose, setPurpose] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchRequests();
  }, []);

  const fetchRequests = async () => {
    try {
      const res = await api.get('/api/document-requests');
      setRequests(res.data.requests || []);
    } catch (err) {
      console.error('Failed to load document requests:', err);
    }
  };

  const handleCreateRequest = async (e) => {
    e.preventDefault();
    if (!purpose) return;

    setLoading(true);
    try {
      await api.post('/api/document-requests', { document_type: documentType, purpose });
      setPurpose('');
      fetchRequests();
    } catch (err) {
      alert(`Request failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const downloadFile = (path) => {
    const { data } = supabase.storage.from('documents').getPublicUrl(path);
    window.open(data.publicUrl, '_blank');
  };

  return (
    <div className="p-6 bg-slate-900 text-slate-100 min-h-screen">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Employee Document Request Portal</h1>
        <p className="text-slate-400 text-sm">Self-service requisition for official COE, stamped payslips, and BIR Form 2316.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Requisition Form */}
        <div className="bg-slate-800 p-5 rounded-xl border border-slate-700 h-fit">
          <h2 className="text-lg font-bold text-white mb-4">New Document Request</h2>
          <form onSubmit={handleCreateRequest} className="space-y-4">
            <div>
              <label className="block text-xs text-slate-300 mb-1">Document Type</label>
              <select
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-100"
              >
                <option value="COE">Certificate of Employment (COE)</option>
                <option value="Payslip">Stamped Payslip Summary</option>
                <option value="BIR Form 2316">BIR Form 2316</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1">Purpose / Remarks</label>
              <textarea
                required
                rows={3}
                placeholder="e.g., Bank loan application, Visa processing..."
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-100 outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-2.5 rounded-lg text-sm transition-all"
            >
              {loading ? 'Submitting...' : 'Submit Requisition'}
            </button>
          </form>
        </div>

        {/* Requests Pipeline & History */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-lg font-bold text-white">Requisition Status Tracker</h2>
          {requests.length === 0 ? (
            <div className="text-center py-8 bg-slate-800/50 rounded-xl border border-slate-700 text-slate-400">
              No active or historical document requests found.
            </div>
          ) : (
            requests.map((req) => (
              <div key={req.id} className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <span className="font-bold text-white text-base">{req.document_type}</span>
                    <p className="text-xs text-slate-400 mt-0.5">Purpose: {req.purpose}</p>
                  </div>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                    req.status === 'Ready for Download' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                    req.status === 'Approved' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                    req.status === 'Rejected' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
                    'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                  }`}>
                    {req.status}
                  </span>
                </div>

                {/* Pipeline Progress Indicator */}
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-700 text-xs text-slate-400">
                  <span>Requested: {new Date(req.created_at).toLocaleDateString()}</span>
                  {req.status === 'Ready for Download' && req.generated_file_path && (
                    <button
                      onClick={() => downloadFile(req.generated_file_path)}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg font-medium"
                    >
                      ↓ Download Certificate
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}