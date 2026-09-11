import * as React from "react";
import { cn } from "cn";
import { Switch as SwitchPrimitive } from "radix-ui";

function Switch({
	className,
	size = "default",
	...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
	size?: "sm" | "default";
}) {
	return (
		<SwitchPrimitive.Root
			data-slot="switch"
			data-size={size}
			className={cn(
				"peer group/switch relative inline-flex shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-[#1D68FE] focus-visible:ring-offset-2 focus-visible:ring-offset-[#121620] disabled:cursor-not-allowed disabled:opacity-50",
				size === "sm" ? "h-4 w-7" : "h-5 w-9",
				"data-[state=checked]:bg-[#1D68FE] data-[state=unchecked]:bg-[#262F40]",
				className,
			)}
			{...props}
		>
			<SwitchPrimitive.Thumb
				data-slot="switch-thumb"
				className={cn(
					"pointer-events-none block rounded-full bg-white shadow-sm ring-0 transition-transform duration-200",
					size === "sm"
						? "size-3 data-[state=checked]:translate-x-3.5 data-[state=unchecked]:translate-x-0.5"
						: "size-4 data-[state=checked]:translate-x-4.5 data-[state=unchecked]:translate-x-0.5",
				)}
			/>
		</SwitchPrimitive.Root>
	);
}

export { Switch };
