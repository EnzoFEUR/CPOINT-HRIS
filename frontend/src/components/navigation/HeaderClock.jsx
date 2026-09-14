import React, { useState, useEffect } from 'react';

const formatCurrentTime = () =>
  new Date().toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

/**
 * Isolated HeaderClock component.
 * Prevents whole-layout re-rendering on every 1-second tick.
 */
export const HeaderClock = () => {
  const [currentDate, setCurrentDate] = useState(formatCurrentTime);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentDate(formatCurrentTime());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <p className="text-[11px] text-slate-400 font-medium hidden sm:block mt-0.5 select-none">
      {currentDate}
    </p>
  );
};

export default React.memo(HeaderClock);
