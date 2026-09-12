import antigravityUrl from "@/assets/antigravity.svg";
import googleUrl from "@/assets/google.svg";
import anthropicUrl from "@/assets/anthropic.svg";
import ompUrl from "@/assets/omp.svg";
import vansUrl from "@/assets/vans.svg";
import openrouterUrl from "@/assets/openrouter.svg";
import deepseekUrl from "@/assets/deepseek.svg";
import githubUrl from "@/assets/github.svg";
import xiaomiUrl from "@/assets/xiaomi.svg";
import ollamaUrl from "@/assets/ollama.svg";
import nvidiaUrl from "@/assets/nvidia.svg";
import opencodeUrl from "@/assets/opencode.svg";
import moarkUrl from "@/assets/moark.svg";
import commandcodeUrl from "@/assets/commandcode.svg";
import { Server, Boxes } from "lucide-react";

export function AntigravityIcon({
	className = "h-5 w-5",
}: {
	className?: string;
}) {
	return (
		<img
			src={antigravityUrl}
			alt="Antigravity"
			className={`${className} object-contain inline-block select-none shrink-0`}
		/>
	);
}

export function GoogleIcon({ className = "h-4 w-4" }: { className?: string }) {
	return (
		<img
			src={googleUrl}
			alt="Google Gemini"
			className={`${className} object-contain inline-block select-none shrink-0`}
		/>
	);
}

export function AnthropicIcon({
	className = "h-4 w-4",
}: {
	className?: string;
}) {
	return (
		<img
			src={anthropicUrl}
			alt="Anthropic Claude"
			className={`${className} object-contain inline-block select-none shrink-0`}
		/>
	);
}

export function OmpIcon({ className = "h-4 w-4" }: { className?: string }) {
	return (
		<img
			src={ompUrl}
			alt="OMP Gateway"
			className={`${className} object-contain inline-block select-none shrink-0`}
		/>
	);
}

export function VansIcon({ className = "h-4 w-4" }: { className?: string }) {
	return (
		<img
			src={vansUrl}
			alt="Vans Gateway"
			className={`${className} object-contain inline-block select-none shrink-0`}
		/>
	);
}

export function OpenRouterIcon({
	className = "h-4 w-4",
}: {
	className?: string;
}) {
	return (
		<img
			src={openrouterUrl}
			alt="OpenRouter"
			className={`${className} object-contain inline-block select-none shrink-0`}
		/>
	);
}

export function DeepSeekIcon({
	className = "h-4 w-4",
}: {
	className?: string;
}) {
	return (
		<img
			src={deepseekUrl}
			alt="DeepSeek"
			className={`${className} object-contain inline-block select-none shrink-0`}
		/>
	);
}

export function GitHubIcon({ className = "h-4 w-4" }: { className?: string }) {
	return (
		<img
			src={githubUrl}
			alt="GitHub"
			className={`${className} object-contain inline-block select-none shrink-0`}
		/>
	);
}

export function XiaomiIcon({ className = "h-4 w-4" }: { className?: string }) {
	return (
		<img
			src={xiaomiUrl}
			alt="Xiaomi"
			className={`${className} object-contain inline-block select-none shrink-0`}
		/>
	);
}

export function OllamaIcon({ className = "h-4 w-4" }: { className?: string }) {
	return (
		<img
			src={ollamaUrl}
			alt="Ollama"
			className={`${className} object-contain inline-block select-none shrink-0`}
		/>
	);
}

export function NexusIcon({ className = "h-5 w-5" }: { className?: string }) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 48 46"
			fill="none"
			className={`${className} select-none shrink-0 inline-block`}
			aria-label="NexusRoute Logo"
		>
			<defs>
				<linearGradient id="nexusIconGrad" x1="0%" y1="0%" x2="100%" y2="100%">
					<stop offset="0%" stopColor="#00FFA3" />
					<stop offset="45%" stopColor="#00EA88" />
					<stop offset="100%" stopColor="#059669" />
				</linearGradient>
				<linearGradient id="nexusIconSheen" x1="0%" y1="0%" x2="0%" y2="100%">
					<stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.4" />
					<stop offset="100%" stopColor="#00EA88" stopOpacity="0" />
				</linearGradient>
			</defs>
			<path
				fill="url(#nexusIconGrad)"
				d="M25.946 44.938c-.664.845-2.021.375-2.021-.698V33.937a2.26 2.26 0 0 0-2.262-2.262H10.287c-.92 0-1.456-1.04-.92-1.788l7.48-10.471c1.07-1.497 0-3.578-1.842-3.578H1.237c-.92 0-1.456-1.04-.92-1.788L10.013.474c.214-.297.556-.474.92-.474h28.894c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.579 1.842 3.579h11.377c.943 0 1.473 1.088.89 1.83L25.947 44.94z"
			/>
			<path
				fill="url(#nexusIconSheen)"
				d="M10.013.474c.214-.297.556-.474.92-.474h28.894c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.579 1.842 3.579h11.377c.45 0 .81.248.86.58L10.013.474z"
			/>
		</svg>
	);
}

export function NvidiaIcon({ className = "h-4 w-4" }: { className?: string }) {
	return (
		<img
			src={nvidiaUrl}
			alt="NVIDIA"
			className={`${className} object-contain inline-block select-none shrink-0`}
		/>
	);
}

export function OpenCodeIcon({
	className = "h-4 w-4",
}: {
	className?: string;
}) {
	return (
		<img
			src={opencodeUrl}
			alt="OpenCode"
			className={`${className} object-contain inline-block select-none shrink-0`}
		/>
	);
}

export function BpmIcon({ className = "h-4 w-4" }: { className?: string }) {
	return (
		<img
			src={moarkUrl}
			alt="ByteDance ModelArk"
			className={`${className} object-contain inline-block select-none shrink-0`}
		/>
	);
}

export function CommandCodeIcon({
	className = "h-4 w-4",
}: {
	className?: string;
}) {
	return (
		<img
			src={commandcodeUrl}
			alt="Command Code"
			className={`${className} object-contain inline-block select-none shrink-0`}
		/>
	);
}

export function GatewayIcon({
	name,
	className = "h-4 w-4",
}: {
	name: string;
	className?: string;
}) {
	const lower = name.toLowerCase();
	if (lower.includes("omp")) {
		return <OmpIcon className={className} />;
	}
	if (lower.includes("vans") || lower.includes("9router")) {
		return <VansIcon className={className} />;
	}
	if (lower.includes("commandcode") || lower.includes("cmc")) {
		return <CommandCodeIcon className={className} />;
	}
	return <Server className={`${className} text-[#00EA88] shrink-0`} />;
}

export function ProviderIcon({
	name,
	className = "h-3.5 w-3.5",
}: {
	name: string;
	className?: string;
}) {
	const lower = name.toLowerCase();
	if (lower.includes("antigravity")) {
		return <AntigravityIcon className={className} />;
	}
	if (lower.includes("google") || lower.includes("gemini")) {
		return <GoogleIcon className={className} />;
	}
	if (lower.includes("anthropic") || lower.includes("claude")) {
		return <AnthropicIcon className={className} />;
	}
	if (lower.includes("commandcode") || lower.includes("cmc")) {
		return <CommandCodeIcon className={className} />;
	}
	if (lower.includes("openrouter")) {
		return <OpenRouterIcon className={className} />;
	}
	if (
		lower === "bpm" ||
		lower.includes("modelark") ||
		lower.includes("moark") ||
		lower.includes("byteplus") ||
		lower.includes("volcengine")
	) {
		return <BpmIcon className={className} />;
	}
	if (lower === "oc" || lower.includes("opencode")) {
		return <OpenCodeIcon className={className} />;
	}
	if (lower.includes("nvidia") || lower.includes("nim")) {
		return <NvidiaIcon className={className} />;
	}
	if (lower.includes("deepseek")) {
		return <DeepSeekIcon className={className} />;
	}
	if (lower.includes("github") || lower.includes("gh")) {
		return <GitHubIcon className={className} />;
	}
	if (lower.includes("xiaomi") || lower.includes("mimo")) {
		return <XiaomiIcon className={className} />;
	}
	if (lower.includes("ollama")) {
		return <OllamaIcon className={className} />;
	}
	return <Boxes className={`${className} text-sky-400 shrink-0`} />;
}
