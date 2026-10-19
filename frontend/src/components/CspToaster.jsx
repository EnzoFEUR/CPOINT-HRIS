import { CheckCircle2, XCircle, LoaderCircle } from 'lucide-react';
import { useToaster, resolveValue } from 'react-hot-toast/headless';
import './CspToaster.css';

// Keep the existing toast store/lifecycle while rendering without runtime inline stylesheets.
export default function CspToaster({ toastOptions = {}, position = 'top-center', reverseOrder = false, gutter = 8, containerStyle, toasterId = 'default' }) {
    const { toasts, handlers } = useToaster(toastOptions, toasterId);
    return (
        <div className="cpoint-toast-region" style={containerStyle} onMouseEnter={handlers.startPause} onMouseLeave={handlers.endPause}>
            {toasts.map(item => {
                const placement = item.position || position;
                const top = placement.startsWith('top');
                const offset = handlers.calculateOffset(item, { reverseOrder, gutter, defaultPosition: position });
                const Icon = item.type === 'success' ? CheckCircle2 : item.type === 'error' ? XCircle : item.type === 'loading' ? LoaderCircle : null;
                return (
                    <div
                        key={item.id}
                        data-toast-id={item.id}
                        className="cpoint-toast-position"
                        ref={node => { if (node && item.height !== node.offsetHeight) handlers.updateHeight(item.id, node.offsetHeight); }}
                        style={{
                            top: top ? 0 : undefined,
                            bottom: top ? undefined : 0,
                            justifyContent: placement.endsWith('left') ? 'flex-start' : placement.endsWith('right') ? 'flex-end' : 'center',
                            transform: `translateY(${top ? offset : -offset}px)`,
                            opacity: item.visible ? 1 : 0,
                            pointerEvents: item.visible ? 'auto' : 'none',
                        }}
                        {...item.ariaProps}
                    >
                        {item.type === 'custom' ? resolveValue(item.message, item) : (
                            <div className={`cpoint-toast-content ${item.className || ''}`} style={item.style}>
                                {item.icon || (Icon && <Icon size={20} aria-hidden="true" className={item.type === 'loading' ? 'cpoint-toast-loading' : undefined} style={{ color: item.iconTheme?.primary }} />)}
                                <div>{resolveValue(item.message, item)}</div>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
