import { useMemo, useState } from "react";
import { Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import {
	formatBucketTime,
	formatCompact,
	formatCost,
	formatIdr,
} from "@/lib/formatters";
import type { ActivityBucket } from "@/types/dashboard";

export type ActivityChartMode =
	| "tokens"
	| "cost"
	| "requests"
	| "providers"
	| "models";

interface ActivityStackedBarChartProps {
	activity?: ActivityBucket[];
	modes?: ActivityChartMode[];
	defaultMode?: ActivityChartMode;
	currency?: "USD" | "IDR";
	usdIdrRate?: number;
	modelFilter?: string;
	className?: string;
	title?: string;
}

interface Segment {
	key: string;
	label: string;
	value: number;
	color: string;
}

const DEFAULT_MODES: ActivityChartMode[] = ["tokens", "cost", "requests"];

const MODE_LABELS: Record<ActivityChartMode, string> = {
	tokens: "Tokens",
	cost: "Cost",
	requests: "Requests",
	providers: "Providers",
	models: "Models",
};

const PROVIDER_COLORS: Record<string, string> = {
	antigravity: "#00EA88",
	commandcode: "#7AA2F7",
	openrouter: "#F59E0B",
	deepseek: "#38BDF8",
	ollama: "#EC4899",
	other: "#64748B",
};

const MODEL_PALETTE = [
	"#A855F7",
	"#7AA2F7",
	"#00EA88",
	"#F59E0B",
	"#38BDF8",
	"#EC4899",
	"#64748B",
];

const CHART_HEIGHT = 150;
const COLUMN_WIDTH = 20;
const BAR_WIDTH = 13;

function matchesModelFilter(model: string, filter?: string): boolean {
	if (!filter || filter === "all") return true;
	const name = model.toLowerCase();
	if (filter === "antigravity") return name.includes("antigravity");
	if (filter === "commandcode")
		return name.startsWith("cmc/") || name.includes("commandcode");
	if (filter === "openrouter") return name.startsWith("openrouter/");
	if (filter === "ollama") return name.startsWith("ollama/");
	if (filter === "deepseek") return name.includes("deepseek");
	return name.includes(filter.toLowerCase());
}

function bucketTotal(bucket: ActivityBucket, mode: ActivityChartMode): number {
	if (mode === "tokens") return bucket.tokensTotal;
	if (mode === "cost") return bucket.costUsd;
	return bucket.requests;
}

function topWithOther(entries: Segment[]): Segment[] {
	if (entries.length <= 5) return entries;
	const head = entries.slice(0, 5);
	const restValue = entries.slice(5).reduce((acc, e) => acc + e.value, 0);
	head.push({ key: "other", label: "Other", value: restValue, color: "#64748B" });
	return head;
}

function buildSegments(
	bucket: ActivityBucket,
	mode: ActivityChartMode,
	modelFilter: string | undefined,
	modelColors: Map<string, string>,
): Segment[] {
	if (mode === "tokens") {
		return [
			{
				key: "cacheRead",
				label: "Cache Read",
				value: bucket.tokensCacheRead,
				color: "#A855F7",
			},
			{
				key: "inputFresh",
				label: "Input Fresh",
				value: bucket.tokensInputFresh,
				color: "#7AA2F7",
			},
			{
				key: "output",
				label: "Output",
				value: bucket.tokensOutput,
				color: "#00EA88",
			},
		];
	}

	if (mode === "cost") {
		return [{ key: "cost", label: "Cost", value: bucket.costUsd, color: "#00EA88" }];
	}

	if (mode === "requests") {
		return [
			{
				key: "cacheHits",
				label: "Cache Hits",
				value: bucket.cacheHits,
				color: "#00EA88",
			},
			{
				key: "uncached",
				label: "Uncached",
				value: Math.max(0, bucket.requests - bucket.cacheHits),
				color: "#7AA2F7",
			},
		];
	}

	const source = mode === "providers" ? bucket.providers : bucket.models;
	const isProviders = mode === "providers";

	return topWithOther(
		Object.entries(source)
			.filter(([name]) => isProviders || matchesModelFilter(name, modelFilter))
			.map(([name, stat]) => ({
				key: name,
				label: isProviders ? name : name.split("/").pop() || name,
				value: stat.requests,
				color: isProviders
					? PROVIDER_COLORS[name.toLowerCase()] || "#64748B"
					: modelColors.get(name) || "#64748B",
			}))
			.filter((s) => s.value > 0)
			.sort((a, b) => b.value - a.value),
	);
}

export function ActivityStackedBarChart({
	activity,
	modes,
	defaultMode = "tokens",
	currency = "USD",
	usdIdrRate = 17000,
	modelFilter,
	className,
	title = "Activity Timeline",
}: ActivityStackedBarChartProps) {
	const buckets = useMemo(() => activity ?? [], [activity]);
	const activeModes = useMemo(
		() => (modes && modes.length > 0 ? modes : DEFAULT_MODES),
		[modes],
	);

	const [mode, setMode] = useState<ActivityChartMode>(defaultMode);
	const resolvedMode = activeModes.includes(mode) ? mode : activeModes[0];
	const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

	const modelColors = useMemo(() => {
		const totals = new Map<string, number>();
		for (const b of buckets) {
			for (const [name, stat] of Object.entries(b.models)) {
				totals.set(name, (totals.get(name) ?? 0) + stat.requests);
			}
		}
		const sorted = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
		const map = new Map<string, string>();
		sorted.forEach(([name], i) =>
			map.set(name, MODEL_PALETTE[i % MODEL_PALETTE.length]),
		);
		return map;
	}, [buckets]);

	const decorated = useMemo(
		() =>
			buckets.map((b) => ({
				bucket: b,
				segments: buildSegments(b, resolvedMode, modelFilter, modelColors),
			})),
		[buckets, resolvedMode, modelFilter, modelColors],
	);

	const maxTotal = useMemo(
		() =>
			Math.max(
				1,
				...decorated.map((d) =>
					d.segments.reduce((acc, s) => acc + s.value, 0),
				),
			),
		[decorated],
	);

	const grandTotal = useMemo(
		() => buckets.reduce((acc, b) => acc + bucketTotal(b, resolvedMode), 0),
		[buckets, resolvedMode],
	);

	const legend = useMemo(() => {
		const seen = new Map<string, { label: string; color: string }>();
		for (const d of decorated) {
			for (const s of d.segments) {
				if (s.value > 0 && !seen.has(s.key)) {
					seen.set(s.key, { label: s.label, color: s.color });
				}
			}
		}
		return Array.from(seen.values());
	}, [decorated]);

	const windowSpan = useMemo(() => {
		if (buckets.length <= 1) return 0;
		const first = buckets[0].timestamp;
		const last = buckets[buckets.length - 1].timestamp;
		// Add one step so the final bucket's full interval is included.
		const step = Math.abs(buckets[1].timestamp - first) || 0;
		return Math.abs(last - first) + step;
	}, [buckets]);

	const fmtValue = (value: number): string => {
		if (resolvedMode !== "cost") return formatCompact(value);
		return currency === "IDR"
			? formatIdr(value, usdIdrRate)
			: formatCost(value);
	};

	const unit =
		resolvedMode === "cost" ? "" : resolvedMode === "tokens" ? "tokens" : "requests";

	const isEmpty = decorated.every((d) =>
		d.segments.every((s) => s.value <= 0),
	);
	const chartWidth = buckets.length * COLUMN_WIDTH;
	const hovered = hoveredIndex !== null ? decorated[hoveredIndex] : undefined;

	return (
		<div
			className={cn(
				"rounded-xl border border-white/[0.08] bg-white/[0.06] bevel-inset p-4 sm:p-5 shadow-sm space-y-4",
				className,
			)}
		>
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/[0.08]">
				<div className="flex items-center gap-2">
					<Activity className="h-4 w-4 text-[#7AA2F7]" />
					<h3 className="text-sm font-semibold text-white tracking-tight">
						{title}
					</h3>
				</div>
				<div className="flex items-center gap-1 overflow-x-auto py-0.5 text-[11px] font-medium">
					{activeModes.map((m) => (
						<button
							key={m}
							type="button"
							onClick={() => setMode(m)}
							className={cn(
								"px-2.5 py-1 rounded-md transition-colors whitespace-nowrap cursor-pointer",
								resolvedMode === m
									? "bg-[#1E2538] text-[#00EA88] border border-[#00EA88]/30 font-semibold"
									: "text-[#64748B] hover:text-white border border-transparent",
							)}
						>
							{MODE_LABELS[m]}
						</button>
					))}
				</div>
			</div>

			{isEmpty ? (
				<div className="p-8 text-center text-xs text-[#64748B] font-mono border border-dashed border-white/[0.08] rounded-lg">
					No activity recorded in this time range.
				</div>
			) : (
				<>
					<div className="flex items-center justify-between text-[11px] font-mono text-[#8A94A6]">
						<span>
							Total:{" "}
							<span className="text-white font-semibold">
								{fmtValue(grandTotal)}
							</span>
							{unit ? ` ${unit}` : ""}
						</span>
						<span className="text-[#64748B]">{buckets.length} buckets</span>
					</div>

					<div className="overflow-x-auto">
						<div
							className="relative min-w-[320px]"
							onPointerLeave={() => setHoveredIndex(null)}
						>
							<svg
								viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT}`}
								preserveAspectRatio="none"
								className="w-full"
								style={{ height: CHART_HEIGHT }}
							>
								{decorated.map((d, i) => {
									const visible = d.segments.filter((s) => s.value > 0);
									let cursorY = CHART_HEIGHT;
									const bars = visible.map((s, si) => {
										const h = (s.value / maxTotal) * CHART_HEIGHT;
										const y = cursorY - h;
										cursorY = y;
										return { s, y, h, isTop: si === visible.length - 1 };
									});
									const x = i * COLUMN_WIDTH + (COLUMN_WIDTH - BAR_WIDTH) / 2;
									return (
										<g key={i}>
											{bars.map((bar) => (
												<rect
													key={bar.s.key}
													x={x}
													y={bar.y}
													width={BAR_WIDTH}
													height={bar.h}
													rx={bar.isTop ? 2 : 0}
													fill={bar.s.color}
												/>
											))}
											<rect
												x={i * COLUMN_WIDTH}
												y={0}
												width={COLUMN_WIDTH}
												height={CHART_HEIGHT}
												fill="transparent"
												style={{ cursor: "pointer" }}
												onPointerEnter={() => setHoveredIndex(i)}
												onPointerMove={() => setHoveredIndex(i)}
											/>
										</g>
									);
								})}
							</svg>

							{hovered && hoveredIndex !== null && (
								<div
									className="absolute z-20 pointer-events-none rounded-lg bg-[#0a0a0a]/95 border border-white/[0.12] bevel-inset p-2.5 shadow-2xl text-xs font-mono"
									style={{
										top: 4,
										left: `${((hoveredIndex + 0.5) / buckets.length) * 100}%`,
										transform:
											hoveredIndex > buckets.length / 2
												? "translateX(-105%)"
												: "translateX(5%)",
									}}
								>
									<div className="text-[#8A94A6] mb-1">
										{formatBucketTime(hovered.bucket.timestamp, windowSpan)}
									</div>
									<div className="text-white font-semibold mb-1.5">
										Total:{" "}
										{fmtValue(
											hovered.segments.reduce((acc, s) => acc + s.value, 0),
										)}
									</div>
									<div className="space-y-1">
										{hovered.segments
											.filter((s) => s.value > 0)
											.map((s) => {
												const total = hovered.segments.reduce(
													(acc, x) => acc + x.value,
													0,
												);
												const pct =
													total > 0 ? Math.round((s.value / total) * 100) : 0;
												return (
													<div key={s.key} className="flex items-center gap-1.5">
														<span
															className="h-2 w-2 rounded-full shrink-0"
															style={{ backgroundColor: s.color }}
														/>
														<span className="text-[#8A94A6]">{s.label}</span>
														<span className="text-white ml-auto pl-3">
															{fmtValue(s.value)}
														</span>
														<span className="text-[#64748B]">{pct}%</span>
													</div>
												);
											})}
									</div>
								</div>
							)}
						</div>
					</div>

					<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono">
						{legend.map((l) => (
							<div key={l.label} className="flex items-center gap-1.5 text-[#8A94A6]">
								<span
									className="h-2 w-2 rounded-full shrink-0"
									style={{ backgroundColor: l.color }}
								/>
								<span>{l.label}</span>
							</div>
						))}
					</div>
				</>
			)}
		</div>
	);
}
