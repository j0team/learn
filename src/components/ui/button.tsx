import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// The app's buttons. `quiet` and `primary` are text buttons (top bar, dialogs),
// `icon` a square icon button, `chip` the small pill-ish controls in the
// composer, pickers and settings.
const buttonVariants = cva("inline-flex shrink-0 items-center whitespace-nowrap border-0 font-ui transition-[background,border-color,color,opacity,filter] duration-150 ease-[ease]", {
	variants: {
		variant: {
			quiet: "h-8 gap-1.5 rounded-lg border border-transparent px-3 font-medium bg-transparent text-ink-2 hover:enabled:bg-sunken hover:enabled:text-ink disabled:opacity-45 [&_svg]:size-4",
			primary: "h-8 gap-1.5 rounded-lg border border-transparent px-3 font-medium bg-primary text-primary-ink hover:enabled:brightness-106 disabled:opacity-40 [&_svg]:size-4",
			icon: "grid size-8 place-items-center rounded-lg bg-transparent text-ink-2 hover:bg-sunken hover:text-ink",
			chip: "h-7 gap-[5px] rounded-[9px] px-[9px] text-[13px] leading-[normal] font-medium bg-transparent text-ink-2 hover:enabled:bg-ink/9 hover:enabled:text-ink [&_svg]:size-[15px]",
		},
	},
	defaultVariants: { variant: "quiet" },
});

function Button({ className, variant, type = "button", ...props }: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
	return <ButtonPrimitive data-slot="button" type={type} className={cn(buttonVariants({ variant }), className)} {...props} />;
}

export { Button, buttonVariants };
