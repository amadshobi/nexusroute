import { useId } from "react";

export function MiniSparkline({
	data,
	color = "#10B981",
}: {
	data: number[];
	color?: string;
}) {
	const reactId = useId();
	if (!data || data.length < 2) return null;

	const min = Math.min(...data);
	const max = Math.max(...data);
	const isFlat = min === max;
	const range = isFlat ? 1 : max - min;
	const width = 140;
	const height = 36;

	const points = data.map((val, idx) => {
		const x = (idx / (data.length - 1)) * width;
		const y = isFlat
			? height / 2
			: height - ((val - min) / range) * (height - 8) - 4;
		return `${x.toFixed(1)},${y.toFixed(1)}`;
	});

	const d =
		`M 0,${height} L ${points[0]} ` +
		points.map((p) => `L ${p}`).join(" ") +
		` L ${width},${height} Z`;
	const lineD = `M ${points[0]} ` + points.map((p) => `L ${p}`).join(" ");
	const gradId = `grad-${color.replace("#", "")}-${reactId.replace(/:/g, "")}`;

	return (
		<div className="w-full h-9 overflow-hidden">
			<svg
				viewBox={`0 0 ${width} ${height}`}
				preserveAspectRatio="none"
				className="w-full h-full"
			>
				<defs>
					<linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stopColor={color} stopOpacity="0.28" />
						<stop offset="100%" stopColor={color} stopOpacity="0.0" />
					</linearGradient>
				</defs>
				<path d={d} fill={`url(#${gradId})`} />
				<path
					d={lineD}
					fill="none"
					stroke={color}
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
		</div>
	);
}
