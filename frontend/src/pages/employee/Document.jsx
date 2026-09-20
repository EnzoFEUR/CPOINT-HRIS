import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';

const API_BASE_URL = 'http://localhost:5000';
const CATEGORIES = ['All', 'Contract', 'Government ID', 'Clearance', 'Certificate', 'Performance', 'Other'];
const STATUS_FILTERS = ['All', 'To Review', 'Pending', 'Approved', 'Rejected'];

// Documents uploaded straight from the employee side have no status set yet
// (employeeDocuments.js's POST route doesn't write one), so no status means
// "hasn't been looked at" - i.e. To Review - rather than "pending review".
const getDocStatus = (doc) => {
  const raw = (doc.status || '').toLowerCase();
  if (raw === 'approved') return 'Approved';
  if (raw === 'rejected') return 'Rejected';
  if (raw === 'pending') return 'Pending';
  return 'To Review';
};

const STATUS_BADGE_STYLES = {
  'To Review': 'bg-slate-100 text-slate-600',
  Pending: 'bg-amber-100 text-amber-700',
  Approved: 'bg-emerald-100 text-emerald-700',
  Rejected: 'bg-rose-100 text-rose-700'
};

const FILE_ICONS = {
  pdf: { icon: 'ti-file-type-pdf', bg: 'bg-rose-50', fg: 'text-rose-500' },
  doc: { icon: 'ti-file-type-doc', bg: 'bg-blue-50', fg: 'text-blue-600' },
  docx: { icon: 'ti-file-type-doc', bg: 'bg-blue-50', fg: 'text-blue-600' },
  jpg: { icon: 'ti-photo', bg: 'bg-violet-50', fg: 'text-violet-500' },
  jpeg: { icon: 'ti-photo', bg: 'bg-violet-50', fg: 'text-violet-500' },
  png: { icon: 'ti-photo', bg: 'bg-violet-50', fg: 'text-violet-500' },
  default: { icon: 'ti-file-text', bg: 'bg-blue-50', fg: 'text-blue-600' }
};

const getFileIconStyle = (filename = '') => {
  const ext = filename.split('.').pop()?.toLowerCase();
  return FILE_ICONS[ext] || FILE_ICONS.default;
};

const formatFileSize = (bytes) => {
  if (!bytes) return '';
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
};

// Documents expiring within this many days are flagged as "expiring soon"
// rather than waiting until they've already lapsed.
const EXPIRY_WARNING_DAYS = 30;

const getExpiryInfo = (doc) => {
  if (!doc.expiry_date) return null;
  const expiry = new Date(doc.expiry_date);
  if (Number.isNaN(expiry.getTime())) return null;

  const msPerDay = 1000 * 60 * 60 * 24;
  const diffDays = Math.ceil((expiry.setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / msPerDay);

  if (diffDays < 0) {
    return { type: 'expired', label: `Expired ${Math.abs(diffDays)}d ago`, days: diffDays };
  }
  if (diffDays === 0) {
    return { type: 'expired', label: 'Expires today', days: diffDays };
  }
  if (diffDays <= EXPIRY_WARNING_DAYS) {
    return { type: 'expiring', label: `Expires in ${diffDays}d`, days: diffDays };
  }
  return null;
};

const getToken = () => {
  const directToken = localStorage.getItem('token');
  if (directToken) return directToken;

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith('sb-') || key.includes('auth-token'))) {
      try {
        const parsed = JSON.parse(localStorage.getItem(key));
        if (parsed?.access_token) return parsed.access_token;
      } catch (_) {}
    }
  }
  return null;
};

export const Document = ({ user }) => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const outletContext = useOutletContext();
  const storedUser = React.useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || '{}');
    } catch {
      return {};
    }
  }, []);

  const currentUser = user || outletContext?.user || outletContext || storedUser;
  const employeeId = currentUser?.id || currentUser?.employee_id;

  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [activeStatus, setActiveStatus] = useState('All');
  const [sortOrder, setSortOrder] = useState('newest');
  const [isDragging, setIsDragging] = useState(false);

  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalCategory, setModalCategory] = useState(CATEGORIES[1]);
  const [modalExpiry, setModalExpiry] = useState('');
  const [modalFile, setModalFile] = useState(null);
  const modalFileInputRef = useRef(null);

  const resetUploadModal = () => {
    setModalTitle('');
    setModalCategory(CATEGORIES[1]);
    setModalExpiry('');
    setModalFile(null);
  };

  const openUploadModal = () => {
    resetUploadModal();
    setShowUploadModal(true);
  };

  const closeUploadModal = () => {
    if (uploading) return;
    setShowUploadModal(false);
    resetUploadModal();
  };

  const handleModalFilePick = (file) => {
    if (!file) return;
    setModalFile(file);
    if (!modalTitle.trim()) {
      const withoutExt = file.name.replace(/\.[^/.]+$/, '');
      setModalTitle(withoutExt);
    }
  };

  const fetchDocuments = useCallback(async () => {
    if (!employeeId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const token = getToken();
      if (!token) {
        console.warn('No authentication token found.');
        setLoading(false);
        return;
      }

      const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-user-id': currentUser?.id || '',
        'x-user-role': currentUser?.role || 'employee'
      };

      // Query dedicated employee documents route first
      let res = await fetch(`${API_BASE_URL}/api/employee-documents?employee_id=${employeeId}`, { headers });

      // Fallback to employee profile endpoint if needed
      if (!res.ok && res.status !== 403 && res.status !== 401) {
        res = await fetch(`${API_BASE_URL}/api/employees/${employeeId}`, { headers });
      }

      if (res.status === 403 || res.status === 401) {
        throw new Error('Session expired or unauthorized. Please log out and sign in again.');
      }

      if (!res.ok) throw new Error('Failed to load documents');
      const data = await res.json();

      if (data.success) {
        setDocuments(data.documents || data.employee?.documents || []);
      }
    } catch (err) {
      console.error('Error fetching employee documents:', err);
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  }, [employeeId, currentUser?.id, currentUser?.role]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const uploadFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length || !employeeId) return;

    const token = getToken();
    if (!token) {
      alert('Authentication token missing. Please log in again.');
      return;
    }

    setUploading(true);

    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('employee_id', employeeId);
        formData.append('title', file.name);
        formData.append('category', activeCategory === 'All' ? 'Other' : activeCategory);

        const res = await fetch(`${API_BASE_URL}/api/employee-documents`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'x-user-id': currentUser?.id || '',
            'x-user-role': currentUser?.role || 'employee'
          },
          body: formData
        });

        const resData = await res.json();
        if (!res.ok || !resData.success) {
          throw new Error(resData.message || resData.error || 'Failed to upload document');
        }
      }

      await fetchDocuments();
    } catch (err) {
      console.error('Upload Error:', err);
      alert(err.message || 'Something went wrong while uploading.');
    } finally {
      setUploading(false);
    }
  };

  const handleModalUpload = async () => {
    if (!modalFile) {
      alert('Please choose a file to upload.');
      return;
    }
    if (!modalTitle.trim()) {
      alert('Please enter a document title.');
      return;
    }
    if (!employeeId) {
      alert('Could not identify your account. Please try logging in again.');
      return;
    }

    const token = getToken();
    if (!token) {
      alert('Authentication token missing. Please log in again.');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', modalFile);
      formData.append('employee_id', employeeId);
      formData.append('title', modalTitle.trim());
      formData.append('category', modalCategory);
      if (modalExpiry) formData.append('expiry_date', modalExpiry);

      const res = await fetch(`${API_BASE_URL}/api/employee-documents`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-user-id': currentUser?.id || '',
          'x-user-role': currentUser?.role || 'employee'
        },
        body: formData
      });

      const resData = await res.json();
      if (!res.ok || !resData.success) {
        throw new Error(resData.message || resData.error || 'Failed to upload document');
      }

      await fetchDocuments();
      setShowUploadModal(false);
      resetUploadModal();
    } catch (err) {
      console.error('Upload Error:', err);
      alert(err.message || 'Something went wrong while uploading.');
    } finally {
      setUploading(false);
    }
  };

  const handleOpenDocument = async (docId) => {
    try {
      const token = getToken();
      const res = await fetch(`${API_BASE_URL}/api/employee-documents/${docId}/url`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });
      const data = await res.json();
      if (data.success && data.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
      } else {
        alert(data.message || 'Unable to open file.');
      }
    } catch (err) {
      console.error('Error fetching file URL:', err);
    }
  };

  const filteredDocuments = documents
    .filter((doc) => (activeCategory === 'All' ? true : doc.category === activeCategory))
    .filter((doc) => (activeStatus === 'All' ? true : getDocStatus(doc) === activeStatus))
    .filter((doc) => {
      const docName = doc.title || doc.file_name || '';
      return docName.toLowerCase().includes(search.toLowerCase());
    })
    .sort((a, b) => {
      const dateA = new Date(a.created_at || a.uploaded_at || 0);
      const dateB = new Date(b.created_at || b.uploaded_at || 0);
      return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
    });

  const employeeLabel = [
    currentUser?.first_name
      ? `${currentUser.first_name} ${currentUser.last_name || ''}`.trim()
      : currentUser?.name,
    currentUser?.department
  ]
    .filter(Boolean)
    .join(' · ');

  const expiryAlerts = documents.reduce(
    (acc, doc) => {
      const info = getExpiryInfo(doc);
      if (info?.type === 'expired') acc.expired += 1;
      if (info?.type === 'expiring') acc.expiring += 1;
      return acc;
    },
    { expired: 0, expiring: 0 }
  );

  return (
    <div
      className="max-w-6xl mx-auto px-6 py-8"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        uploadFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          uploadFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {showUploadModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
          onClick={closeUploadModal}
        >
          <div
            className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
                  <i className="ti ti-file-plus text-xl"></i>
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Upload Document</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Attach PDF, images, or documents</p>
                </div>
              </div>
              <button
                onClick={closeUploadModal}
                className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
              >
                <i className="ti ti-x text-lg"></i>
              </button>
            </div>

            <div className="mb-4">
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                Document Title
              </label>
              <input
                type="text"
                value={modalTitle}
                onChange={(e) => setModalTitle(e.target.value)}
                placeholder="e.g. Employment Contract, NBI Clearance"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                  Category
                </label>
                <select
                  value={modalCategory}
                  onChange={(e) => setModalCategory(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                >
                  {CATEGORIES.filter((c) => c !== 'All').map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                  Expiry Date <span className="normal-case text-slate-400 font-medium">(optional)</span>
                </label>
                <input
                  type="date"
                  value={modalExpiry}
                  onChange={(e) => setModalExpiry(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                File
              </label>
              <input
                ref={modalFileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => handleModalFilePick(e.target.files?.[0] || null)}
              />
              <button
                type="button"
                onClick={() => modalFileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-slate-200 rounded-xl py-8 flex flex-col items-center justify-center gap-2 text-center hover:bg-slate-50/60 transition-colors"
              >
                {modalFile ? (
                  <>
                    <i className="ti ti-file-check text-2xl text-indigo-500"></i>
                    <p className="text-sm font-bold text-slate-700 truncate max-w-full px-4">{modalFile.name}</p>
                    <p className="text-xs text-slate-400">
                      {(modalFile.size / 1024 / 1024).toFixed(2)} MB · tap to change
                    </p>
                  </>
                ) : (
                  <>
                    <i className="ti ti-cloud-upload text-2xl text-slate-400"></i>
                    <p className="text-sm font-bold text-slate-700">Tap to take photo or choose file</p>
                    <p className="text-xs text-slate-400">PDF, PNG, JPG, or DOC up to 10MB</p>
                  </>
                )}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={closeUploadModal}
                disabled={uploading}
                className="py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                CANCEL
              </button>
              <button
                onClick={handleModalUpload}
                disabled={uploading}
                className="py-2.5 rounded-xl bg-indigo-500 text-white text-sm font-bold hover:bg-indigo-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {uploading && <i className="ti ti-loader animate-spin text-base"></i>}
                {uploading ? 'SAVING...' : 'SAVE FILE'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => navigate('/employee/profile')}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors"
        >
          <i className="ti ti-arrow-left text-base"></i>
          BACK TO PROFILE
        </button>

        <button
          onClick={openUploadModal}
          disabled={uploading}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold shadow-lg shadow-blue-500/20 hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          <i className={`ti ${uploading ? 'ti-loader animate-spin' : 'ti-upload'} text-base`}></i>
          {uploading ? 'UPLOADING...' : 'UPLOAD DOCUMENT'}
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6 mb-6 flex items-center gap-4">
        <div className="h-12 w-12 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
          <i className="ti ti-folder text-2xl"></i>
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-900">Documents</h2>
          <p className="text-sm text-slate-400 mt-0.5">{employeeLabel || 'Employee Documents'}</p>
        </div>
      </div>

      {(expiryAlerts.expired > 0 || expiryAlerts.expiring > 0) && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 mb-6">
          <i className="ti ti-alert-triangle text-amber-500 text-xl shrink-0 mt-0.5"></i>
          <p className="text-sm text-amber-800">
            {expiryAlerts.expired > 0 && (
              <span className="font-bold">
                {expiryAlerts.expired} document{expiryAlerts.expired === 1 ? '' : 's'} expired.{' '}
              </span>
            )}
            {expiryAlerts.expiring > 0 && (
              <span>
                {expiryAlerts.expiring} document{expiryAlerts.expiring === 1 ? '' : 's'} expiring within{' '}
                {EXPIRY_WARNING_DAYS} days.{' '}
              </span>
            )}
            Please renew and re-upload the affected file(s) as soon as possible.
          </p>
        </div>
      )}

      <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-6">
        <div className="relative flex-1 min-w-0">
          <i className="ti ti-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-base"></i>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <select
            value={activeCategory}
            onChange={(e) => setActiveCategory(e.target.value)}
            className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          >
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat === 'All' ? 'All Categories' : cat}
              </option>
            ))}
          </select>
          <select
            value={activeStatus}
            onChange={(e) => setActiveStatus(e.target.value)}
            className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          >
            {STATUS_FILTERS.map((status) => (
              <option key={status} value={status}>
                {status === 'All' ? 'All Statuses' : status}
              </option>
            ))}
          </select>
          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
          </select>
          <span className="text-sm font-semibold text-slate-400 whitespace-nowrap pl-1">
            {filteredDocuments.length} {filteredDocuments.length === 1 ? 'FILE' : 'FILES'}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="border-2 border-dashed border-slate-200 rounded-2xl py-24 text-center text-sm text-slate-400">
          Loading documents...
        </div>
      ) : filteredDocuments.length === 0 ? (
        <button
          onClick={openUploadModal}
          className={`w-full border-2 border-dashed rounded-2xl py-24 flex flex-col items-center justify-center gap-3 transition-colors ${
            isDragging ? 'border-blue-400 bg-blue-50/40' : 'border-slate-200 bg-white hover:bg-slate-50/60'
          }`}
        >
          <i className="ti ti-file-x text-4xl text-slate-300"></i>
          <p className="text-sm font-bold tracking-widest text-slate-500 uppercase">No Documents Yet</p>
          <p className="text-sm text-slate-400">Click here, or drag & drop a file anywhere on this page.</p>
        </button>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDocuments.map((doc) => {
            const fileStyle = getFileIconStyle(doc.file_name || doc.title || '');
            const docLabel = doc.title || doc.file_name || 'Untitled';
            const expiryInfo = getExpiryInfo(doc);
            const isExpired = expiryInfo?.type === 'expired';
            return (
              <div
                key={doc.id}
                onClick={() => handleOpenDocument(doc.id)}
                title={docLabel}
                className={`border rounded-2xl p-5 flex items-start gap-3 hover:shadow-md cursor-pointer transition-all ${
                  isExpired
                    ? 'border-rose-200 bg-rose-50/50 hover:border-rose-300'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${fileStyle.bg} ${fileStyle.fg}`}>
                  <i className={`ti ${fileStyle.icon} text-xl`}></i>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-bold text-slate-900 truncate pr-1">{docLabel}</p>
                    <span
                      className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${
                        STATUS_BADGE_STYLES[getDocStatus(doc)]
                      }`}
                    >
                      {getDocStatus(doc)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{doc.category || 'General'}</p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    {doc.created_at ? new Date(doc.created_at).toLocaleDateString() : ''}
                    {doc.file_size ? ` · ${formatFileSize(doc.file_size)}` : ''}
                  </p>
                  {expiryInfo && (
                    <p
                      className={`flex items-center gap-1 text-[11px] font-bold mt-1.5 ${
                        expiryInfo.type === 'expired' ? 'text-rose-600' : 'text-amber-600'
                      }`}
                    >
                      <i className="ti ti-alert-triangle text-xs"></i>
                      {expiryInfo.type === 'expired' ? `Expired document: ${expiryInfo.label}` : expiryInfo.label}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Document;