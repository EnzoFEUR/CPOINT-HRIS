// Category Icon, Color & Route Mapping Helper
export const getNotificationVisuals = (type) => {
  switch ((type || '').toLowerCase()) {
    case 'payroll':
      return {
        icon: 'ti-cash-banknote',
        bg: 'bg-emerald-50 text-emerald-600 border-emerald-200/80',
        badge: 'bg-emerald-500',
        label: 'Payroll',
        path: '/admin/payroll'
      };
    case 'leave':
      return {
        icon: 'ti-plane-departure',
        bg: 'bg-blue-50 text-blue-600 border-blue-200/80',
        badge: 'bg-blue-500',
        label: 'Leave',
        path: '/admin/leaves'
      };
    case 'shift':
      return {
        icon: 'ti-calendar-time',
        bg: 'bg-purple-50 text-purple-600 border-purple-200/80',
        badge: 'bg-purple-500',
        label: 'Schedule',
        path: '/employee/dashboard'
      };
    case 'disciplinary':
    case 'warning':
      return {
        icon: 'ti-alert-triangle',
        bg: 'bg-amber-50 text-amber-600 border-amber-200/80',
        badge: 'bg-amber-500',
        label: 'Notice',
        path: '/admin/disciplinary'
      };
    case 'attendance':
      return {
        icon: 'ti-clock-check',
        bg: 'bg-teal-50 text-teal-600 border-teal-200/80',
        badge: 'bg-teal-500',
        label: 'Attendance',
        path: '/admin/attendance'
      };
    default:
      return {
        icon: 'ti-bell',
        bg: 'bg-slate-100 text-slate-600 border-slate-200',
        badge: 'bg-blue-500',
        label: 'General',
        path: '/'
      };
  }
};

export const notifAvatarCache = new Map();

// Extract or generate employee profile picture / initials with rich employee database matching
export const getNotificationAvatar = (notif, employeeMap) => {
  let initials = '';
  let avatarSrc = notif.sender_avatar || null;
  let matchedEmp = null;

  if (employeeMap && employeeMap.size > 0) {
    if (notif.sender_id && employeeMap.has(notif.sender_id)) {
      matchedEmp = employeeMap.get(notif.sender_id);
    } else if (notif.target && employeeMap.has(notif.target)) {
      matchedEmp = employeeMap.get(notif.target);
    } else if (notif.company_id && employeeMap.has(notif.company_id)) {
      matchedEmp = employeeMap.get(notif.company_id);
    } else {
      // Match by full name in title or text
      const lowerTitle = (notif.title || '').toLowerCase();
      const lowerText = (notif.text || '').toLowerCase();
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
      if (matchedEmp.biometric_baseline_path) {
        avatarSrc = matchedEmp.biometric_baseline_path.startsWith('http')
          ? matchedEmp.biometric_baseline_path
          : `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${matchedEmp.biometric_baseline_path.replace(/^\/+/, '')}`;
      } else if (matchedEmp.company_id && matchedEmp.id) {
        avatarSrc = `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${matchedEmp.company_id}/${matchedEmp.id}.jpg`;
      }
    }

    if (matchedEmp.first_name) {
      const f = matchedEmp.first_name[0] || '';
      const l = (matchedEmp.last_name && matchedEmp.last_name[0]) || '';
      initials = (f + l).toUpperCase();
    }
  }

  // Fallback initials resolution from sender_name, title, or text
  if (!initials) {
    const rawName = notif.sender_name || notif.title?.split(':')[1]?.trim() || '';
    if (rawName) {
      const parts = rawName.trim().split(' ').filter(Boolean);
      initials = parts.length > 1 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : parts[0].slice(0, 2).toUpperCase();
    } else if (notif.text) {
      const match = notif.text.match(/^([A-Z][a-z]+ [A-Z][a-z]+)/);
      if (match) {
        const parts = match[1].split(' ');
        initials = (parts[0][0] + parts[1][0]).toUpperCase();
      }
    }
    if (!initials) initials = 'CP';
  }

  return {
    avatarSrc,
    initials,
    name: matchedEmp ? `${matchedEmp.first_name} ${matchedEmp.last_name}` : (notif.sender_name || null),
    employee: matchedEmp
  };
};
