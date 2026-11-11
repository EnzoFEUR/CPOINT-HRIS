/**
 * Enterprise Mobile Skeleton Component
 * Provides geometry-matched shimmer placeholders to eliminate layout shift (CLS < 0.1).
 * Fully respects prefers-reduced-motion and dark theme tokens.
 */
export const Skeleton = ({
  className = '',
  width,
  height,
  rounded = 'rounded-lg',
  style = {},
  ...props
}) => {
  const inlineStyle = {
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...style,
  };

  return (
    <div
      role="status"
      aria-label="Loading content"
      className={`relative overflow-hidden bg-slate-200/80 dark:bg-slate-800/80 ${rounded} ${className} motion-safe:after:absolute motion-safe:after:inset-0 motion-safe:after:translate-x-[-100%] motion-safe:after:animate-[shimmer_1.6s_infinite] motion-safe:after:bg-gradient-to-r motion-safe:after:from-transparent motion-safe:after:via-white/20 dark:motion-safe:after:via-white/10 motion-safe:after:to-transparent`}
      style={inlineStyle}
      {...props}
    >
      <span className="sr-only">Loading...</span>
    </div>
  );
};

export const SkeletonText = ({ lines = 1, className = '', lastLineWidth = '70%' }) => {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, idx) => (
        <Skeleton
          key={idx}
          height="0.875rem"
          width={idx === lines - 1 && lines > 1 ? lastLineWidth : '100%'}
          rounded="rounded-md"
        />
      ))}
    </div>
  );
};

export const SkeletonAvatar = ({ size = 'h-11 w-11', rounded = 'rounded-xl', className = '' }) => {
  return <Skeleton className={`${size} ${rounded} shrink-0 ${className}`} />;
};

export const SkeletonCard = ({ className = '', children }) => {
  return (
    <div className={`p-4 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 rounded-2xl shadow-2xs space-y-3 ${className}`}>
      {children || (
        <>
          <div className="flex items-center gap-3">
            <SkeletonAvatar />
            <div className="flex-1 space-y-1.5">
              <Skeleton height="1rem" width="60%" />
              <Skeleton height="0.75rem" width="40%" />
            </div>
          </div>
          <SkeletonText lines={2} />
        </>
      )}
    </div>
  );
};

export const SkeletonButton = ({ className = '', width = '100%', height = '2.75rem' }) => {
  return <Skeleton width={width} height={height} rounded="rounded-xl" className={className} />;
};

Skeleton.Text = SkeletonText;
Skeleton.Avatar = SkeletonAvatar;
Skeleton.Card = SkeletonCard;
Skeleton.Button = SkeletonButton;

export default Skeleton;
