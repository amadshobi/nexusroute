import { useRef, useState, useLayoutEffect } from "react";

interface TimeFilterBarProps {
	timeRange: string;
	setTimeRange: (range: string) => void;
}

export function TimeFilterBar({ timeRange, setTimeRange }: TimeFilterBarProps) {
	const ranges = ["all", "1h", "today", "yesterday", "24h", "7d", "30d"];

	const getLabel = (r: string) => {
		switch (r) {
			case "all":
				return "All Time";
			case "1h":
				return "1h";
			case "today":
				return "Today";
			case "yesterday":
				return "Yesterday";
			case "24h":
				return "24h";
			case "7d":
				return "7d";
			case "30d":
				return "30d";
			default:
				return r;
		}
	};

	const containerRef = useRef<HTMLDivElement>(null);
	const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
	const [pillStyle, setPillStyle] = useState<{
		left: number;
		width: number;
		opacity: number;
	}>({
		left: 0,
		width: 0,
		opacity: 0,
	});
	const [hasMounted, setHasMounted] = useState(false);

	useLayoutEffect(() => {
		let rafId: number;

		const updatePill = () => {
			const activeBtn = btnRefs.current[timeRange];
			const container = containerRef.current;
			if (activeBtn && container) {
				const width = activeBtn.offsetWidth;
				const left = activeBtn.offsetLeft;
				if (width > 0) {
					setPillStyle({
						left,
						width,
						opacity: 1,
					});
					setHasMounted(true);
				}
			}
		};

		// Immediate layout update
		updatePill();
		// RAF update once font metrics & DOM stabilize
		rafId = requestAnimationFrame(updatePill);

		// ResizeObserver to track container & active button size changes
		let ro: ResizeObserver | null = null;
		if (typeof ResizeObserver !== "undefined" && containerRef.current) {
			ro = new ResizeObserver(() => {
				updatePill();
			});
			ro.observe(containerRef.current);
			const activeBtn = btnRefs.current[timeRange];
			if (activeBtn) ro.observe(activeBtn);
		}

		window.addEventListener("resize", updatePill);
		return () => {
			cancelAnimationFrame(rafId);
			window.removeEventListener("resize", updatePill);
			if (ro) ro.disconnect();
		};
	}, [timeRange]);

	return (
		<div
			ref={containerRef}
			className="relative flex items-center bg-[#161B26] border border-[#1E2433] rounded-lg p-0.5 text-xs font-medium overflow-x-auto max-w-full scrollbar-none"
		>
			{/* Smooth Sliding Pill Indicator */}
			<div
				className={`absolute top-0.5 bottom-0.5 rounded-md bg-[#1E2538] border border-[#00EA88]/20 shadow-sm pointer-events-none ${
					hasMounted
						? "transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
						: "transition-none"
				}`}
				style={{
					transform: `translateX(${pillStyle.left}px)`,
					width: `${pillStyle.width}px`,
					opacity: pillStyle.width > 0 && pillStyle.opacity > 0 ? 1 : 0,
				}}
			/>

			{ranges.map((r) => {
				const isActive = timeRange === r;
				return (
					<button
						key={r}
						ref={(el) => {
							btnRefs.current[r] = el;
						}}
						onClick={() => setTimeRange(r)}
						className={`relative z-10 px-2.5 py-1 rounded-md whitespace-nowrap cursor-pointer transition-colors duration-200 select-none ${
							isActive
								? "text-[#00EA88] font-semibold"
								: "text-[#8A94A6] hover:text-white"
						}`}
					>
						{getLabel(r)}
					</button>
				);
			})}
		</div>
	);
}
