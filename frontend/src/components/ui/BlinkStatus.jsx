import { Check } from 'lucide-react';

const feedback = {
  PENDING: 'Blink check: pending',
  PAUSED: 'Blink check: paused',
  CALIBRATING: 'Blink check: preparing',
  OPEN: 'Eyes open — preparing blink check',
  ARMED: 'Waiting for blink',
  CLOSING: 'Closing eyes — keep your head steady',
  CLOSED: 'Eyes closed detected — open both eyes',
  REOPEN: 'Eyes reopened — confirming blink',
  PASSED: 'Blink detected',
};

export default function BlinkStatus({ phase = 'PENDING' }) {
  return (
    <span role="status" aria-live="polite" aria-atomic="true" data-blink-phase={phase} className={`inline-flex max-w-full items-center justify-center gap-1.5 text-[11px] font-medium leading-snug ${phase === 'PASSED' ? 'text-emerald-300' : 'text-slate-300'}`}>
      {phase === 'PASSED' && <Check aria-hidden="true" className="w-3.5 h-3.5 shrink-0" />}
      <span>{feedback[phase] || feedback.PENDING}</span>
    </span>
  );
}
