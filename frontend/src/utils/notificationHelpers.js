import { isCreditUuid } from '../../../shared/leaveCredits.mjs';

const notificationText = (value, limit) => typeof value === 'string' ? value.slice(0, limit).replace(/[\uD800-\uDBFF]$/u, '') : '';

export const getEmploymentExitNotificationPath = (notification, role) => {
  if (String(notification?.type || '').toLowerCase() !== 'employment_exit') return null;
  const path = ['admin', 'hr', 'hr_manager'].includes(String(role || '').toLowerCase()) ? '/admin/employment-exit' : '/employee/employment-exit';
  return isCreditUuid(notification.exit_request_id) ? path + '?id=' + encodeURIComponent(notification.exit_request_id) : path;
};

export const mergeNotificationRows = (existing, incoming) => {
  const rows = new Map();
  for (const item of [...existing, ...incoming]) {
    const notification = normalizeNotification(item);
    if (notification) rows.set(notification.id, notification);
  }
  return [...rows.values()].sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0)).slice(0, 40);
};

// Normalize display copies only; stored notification content remains unchanged.
export const normalizeNotification = notification => {
  if (!notification || typeof notification !== 'object' || Array.isArray(notification)) return null;
  const { id } = notification;
  if (!(typeof id === 'string' && id.trim() && id.length <= 128)
      && !(typeof id === 'number' && Number.isSafeInteger(id) && id >= 0)) return null;
  return {
    ...notification,
    title: notificationText(notification.title, 200).trim() || 'System Notification',
    text: notificationText(notification.text, 2000),
    type: notificationText(notification.type, 80).trim() || 'system',
    sender_name: notificationText(notification.sender_name, 201).trim() || null,
    sender_avatar: notificationText(notification.sender_avatar, 2048).trim() || null,
    read: notification.read === true,
  };
};

// Category Icon, Color & Route Mapping Helper
export const getNotificationVisuals = (type) => {
  switch (notificationText(type, 80).toLowerCase()) {
    case 'employment_exit':
      return {
        icon: 'ti-door-exit',
        bg: 'bg-accent-subtle text-accent border-accent/20',
        badge: 'bg-accent',
        label: 'Employment Exit',
        path: '/admin/employment-exit'
      };
    case 'payroll':
      return {
        icon: 'ti-cash-banknote',
        bg: 'bg-accent-subtle text-accent border-accent/20',
        badge: 'bg-accent',
        label: 'Payroll',
        path: '/admin/payroll'
      };
    case 'leave':
      return {
        icon: 'ti-plane-departure',
        bg: 'bg-accent-subtle text-accent border-accent/80',
        badge: 'bg-accent',
        label: 'Leave',
        path: '/admin/leaves'
      };
    case 'cash_out':
    case 'sil_cash_out':
    case 'cashout':
      return {
        icon: 'ti-cash',
        bg: 'bg-success-subtle text-success-ink border-success/20',
        badge: 'bg-success',
        label: 'SIL Cash-Out',
        path: '/admin/leaves?tab=cashouts'
      };
    case 'shift':
      return {
        icon: 'ti-calendar-time',
        bg: 'bg-accent-subtle text-accent border-accent/80',
        badge: 'bg-accent',
        label: 'Schedule',
        path: '/employee/dashboard'
      };
    case 'disciplinary':
    case 'warning':
      return {
        icon: 'ti-alert-triangle',
        bg: 'bg-warning-subtle text-warning-ink border-warning/80',
        badge: 'bg-warning',
        label: 'Notice',
        path: '/admin/disciplinary'
      };
    case 'attendance':
      return {
        icon: 'ti-clock-check',
        bg: 'bg-accent-subtle text-accent border-accent/20',
        badge: 'bg-accent',
        label: 'Attendance',
        path: '/admin/attendance'
      };
    case 'document_submission':
      return {
        icon: 'ti-file-upload',
        bg: 'bg-accent-subtle text-accent border-accent/20',
        badge: 'bg-accent',
        label: 'Document Review',
        path: '/admin/employees'
      };
    case 'document_submission_receipt':
      return {
        icon: 'ti-file-check',
        bg: 'bg-success-subtle text-success-ink border-success/20',
        badge: 'bg-success',
        label: 'Document Sent',
        path: '/employee/documents'
      };
    case 'document_request':
    case 'document_reminder':
      return {
        icon: 'ti-file-alert',
        bg: 'bg-warning-subtle text-warning-ink border-warning/20',
        badge: 'bg-warning',
        label: 'Document Needed',
        path: '/employee/documents'
      };
    case 'document_approved':
      return {
        icon: 'ti-file-check',
        bg: 'bg-success-subtle text-success-ink border-success/20',
        badge: 'bg-success',
        label: 'Document Approved',
        path: '/employee/documents'
      };
    case 'document_rejected':
      return {
        icon: 'ti-file-x',
        bg: 'bg-danger-subtle text-danger-ink border-danger/20',
        badge: 'bg-danger',
        label: 'Document Rejected',
        path: '/employee/documents'
      };
    default:
      return {
        icon: 'ti-bell',
        bg: 'bg-slate-100 text-slate-600 border-slate-200',
        badge: 'bg-accent',
        label: 'General',
        path: '/'
      };
  }
};

export const notifAvatarCache = new Map();

// Extract or generate employee profile picture / initials with rich employee database matching
export const getNotificationAvatar = (notif, employeeMap) => {
  notif = notif && typeof notif === 'object' ? notif : {};
  if (String(notif.type || '').toLowerCase() === 'employment_exit') return { initials: 'EX', avatarSrc: null };
  const title = notificationText(notif.title, 200);
  const text = notificationText(notif.text, 2000);
  const senderName = notificationText(notif.sender_name, 201).trim();
  let initials = '';
  let avatarSrc = notificationText(notif.sender_avatar, 2048) || null;
  let matchedEmp = null;

  if (employeeMap instanceof Map && employeeMap.size > 0) {
    if (notif.sender_id && employeeMap.has(notif.sender_id)) {
      matchedEmp = employeeMap.get(notif.sender_id);
    } else if (notif.target && employeeMap.has(notif.target)) {
      matchedEmp = employeeMap.get(notif.target);
    } else if (notif.company_id && employeeMap.has(notif.company_id)) {
      matchedEmp = employeeMap.get(notif.company_id);
    } else {
      // Match by full name in title or text
      const lowerTitle = title.toLowerCase();
      const lowerText = text.toLowerCase();
      for (const [key, emp] of employeeMap.entries()) {
        if (typeof key === 'string' && key.includes(' ')) {
          if (lowerTitle.includes(key) || lowerText.includes(key)) {
            matchedEmp = emp;
            break;
          }
        }
      }
    }
  }

  if (matchedEmp) {
    if (!avatarSrc) {
      const baselinePath = notificationText(matchedEmp.biometric_baseline_path, 2048);
      if (baselinePath) {
        avatarSrc = baselinePath.startsWith('http')
          ? baselinePath
          : baselinePath.replace(/^\/+/, '');
      } else if (matchedEmp.company_id && matchedEmp.id) {
        avatarSrc = `face-baselines/${matchedEmp.company_id}/${matchedEmp.id}.jpg`;
      }
    }

    if (typeof matchedEmp.first_name === 'string') {
      const f = Array.from(notificationText(matchedEmp.first_name, 100).trim())[0] || '';
      const l = Array.from(notificationText(matchedEmp.last_name, 100).trim())[0] || '';
      initials = (f + l).toUpperCase();
    }
  }

  // Fallback initials resolution from sender_name, title, or text
  if (!initials) {
    const rawName = senderName || title.split(':')[1]?.trim() || '';
    if (rawName) {
      const parts = rawName.trim().split(/\s+/u).filter(Boolean);
      if (parts.length > 1) initials = (Array.from(parts[0])[0] + Array.from(parts.at(-1))[0]).toUpperCase();
      else if (parts.length === 1) initials = Array.from(parts[0]).slice(0, 2).join('').toUpperCase();
    } else if (text) {
      const match = text.match(/^([\p{L}\p{M}]+)\s+([\p{L}\p{M}]+)/u);
      if (match) {
        initials = (Array.from(match[1])[0] + Array.from(match[2])[0]).toUpperCase();
      }
    }
    if (!initials) initials = 'CP';
  }

  return {
    avatarSrc,
    initials,
    name: matchedEmp ? [notificationText(matchedEmp.first_name, 100), notificationText(matchedEmp.last_name, 100)].filter(Boolean).join(' ') : (senderName || null),
    employee: matchedEmp
  };
};
