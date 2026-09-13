import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";

export interface ToastMessage {
	id: number;
	message: string;
	tone: "success" | "error";
}

interface ToastProps {
	toast: ToastMessage | null;
	onDismiss: () => void;
}

const VISIBLE_MS = 3000;
const EXIT_MS = 300;

/**
 * Viewport-fixed notification pill.
 *
 * Rendered via `createPortal` into `document.body` so no ancestor `transform`
 * (e.g. the `.animate-page-enter` wrapper) or `overflow` can trap it. This is
 * what makes it truly stick to the top-center of the viewport while scrolling.
 */
export function Toast({ toast, onDismiss }: ToastProps) {
	const [leaving, setLeaving] = useState(false);
	const toastId = toast?.id;

	useEffect(() => {
		if (toastId === undefined) return;
		const exitTimer = setTimeout(() => setLeaving(true), VISIBLE_MS);
		const dismissTimer = setTimeout(() => onDismiss(), VISIBLE_MS + EXIT_MS);
		return () => {
			clearTimeout(exitTimer);
			clearTimeout(dismissTimer);
		};
	}, [toastId, onDismiss]);

	if (!toast || typeof document === "undefined") return null;

	const isError = toast.tone === "error";
	return createPortal(
		<div
			role="status"
			className={`fixed top-3 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-2 max-w-[calc(100vw-1.5rem)] px-3 py-1.5 rounded-full bg-[#131722]/95 backdrop-blur-md border shadow-2xl text-xs font-mono overflow-x-auto scrollbar-none pointer-events-auto ${
				isError ? "border-rose-500/50 shadow-rose-500/10" : "border-[#00EA88]/50 shadow-[#00EA88]/10"
			} ${
				leaving
					? "animate-out fade-out slide-out-to-top-4 duration-300"
					: "animate-in fade-in slide-in-from-top-4 duration-200"
			}`}
		>
			<span className={isError ? "text-rose-400" : "text-[#00EA88]"}>
				{isError ? (
					<X className="h-3.5 w-3.5" />
				) : (
					<Check className="h-3.5 w-3.5" />
				)}
			</span>
			<span className="text-white whitespace-nowrap">{toast.message}</span>
			<button
				type="button"
				onClick={onDismiss}
				className="ml-1 p-0.5 text-[#8A94A6] hover:text-white rounded-full hover:bg-[#1E2433] transition-colors cursor-pointer"
				title="Close"
			>
				<X className="h-3 w-3" />
			</button>
		</div>,
		document.body,
	);
}
