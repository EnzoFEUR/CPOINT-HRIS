import { shouldWarnEmailDomain } from '../../../shared/personnelInput.mjs';

export default function EmailDomainWarning({ email }) {
    if (!shouldWarnEmailDomain(email)) return null;

    return (
        <div role="status" className="mt-2 rounded-md border border-warning/20 bg-warning-subtle px-3 py-2 text-xs text-warning-ink">
            This is not a @gmail.com address. Check that it is correct and can receive login codes.
        </div>
    );
}
