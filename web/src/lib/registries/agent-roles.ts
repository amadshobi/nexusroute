import {
	Hammer,
	SearchCheck,
	Eye,
	Palette,
	Wrench,
	Bot,
	type LucideIcon,
} from "lucide-react";

export interface AgentRoleMeta {
	id: string;
	label: string;
	icon: LucideIcon;
	color: string;
	patterns: string[];
}

export const ROLE_TAXONOMY: AgentRoleMeta[] = [
	{
		id: "planner",
		label: "Planner",
		icon: Eye,
		color: "#38BDF8", // sky-400
		patterns: [
			"plan",
			"planner",
			"architect",
			"lead",
			"designer",
			"vision",
			"scout",
			"orchestrator",
			"strategy",
		],
	},
	{
		id: "reviewer",
		label: "Reviewer",
		icon: SearchCheck, // 🔎 Kaca pembesar audit/check
		color: "#C084FC", // purple-400
		patterns: [
			"review",
			"reviewer",
			"code-review",
			"audit",
			"auditor",
			"lint",
			"inspect",
			"inspector",
			"guard",
			"security",
			"qa",
			"checker",
		],
	},
	{
		id: "builder",
		label: "Builder",
		icon: Hammer,
		color: "#00EA88", // emerald-400
		patterns: [
			"build",
			"builder",
			"code",
			"coder",
			"code-writer",
			"implement",
			"implementer",
			"fix",
			"fixer",
			"dev",
			"developer",
			"worker",
		],
	},
	{
		id: "designer",
		label: "Designer",
		icon: Palette,
		color: "#EC4899", // pink-500
		patterns: ["design", "designer", "ui", "ux", "style", "css", "theme"],
	},
	{
		id: "ops",
		label: "DevOps",
		icon: Wrench,
		color: "#F59E0B", // amber-500
		patterns: [
			"ops",
			"devops",
			"infra",
			"docker",
			"deploy",
			"linux",
			"system",
			"admin",
		],
	},
];

/**
 * Resolves any arbitrary subagent name to a unified role taxonomy.
 * Zero-hardcoded: uses dynamic keyword regex matching.
 * Fallback to minimal Bot robot icon (HermesView standard).
 */
export function resolveAgentRole(rawName?: string): {
	role: string;
	label: string;
	icon: LucideIcon;
	color: string;
} {
	if (!rawName) {
		return {
			role: "assistant",
			label: "Assistant",
			icon: Bot,
			color: "#94A3B8",
		};
	}

	const normalized = rawName.trim().toLowerCase();

	for (const cat of ROLE_TAXONOMY) {
		for (const p of cat.patterns) {
			if (
				normalized === p ||
				normalized.includes(p) ||
				new RegExp(`(^|[-_ ])${p}([-_ ]|$)`).test(normalized)
			) {
				return {
					role: cat.id,
					label: cat.label,
					icon: cat.icon,
					color: cat.color,
				};
			}
		}
	}

	// Fallback to minimal Bot robot icon (HermesView standard)
	return {
		role: normalized,
		label: rawName,
		icon: Bot,
		color: "#94A3B8",
	};
}
