import { useEffect, useState } from 'react';

export function useCurrentTime() {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        const update = () => setNow(Date.now());
        const timer = setInterval(update, 60000);
        window.addEventListener('focus', update);
        return () => { clearInterval(timer); window.removeEventListener('focus', update); };
    }, []);
    return now;
}
