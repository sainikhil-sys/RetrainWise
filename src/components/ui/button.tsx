import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform] duration-150 select-none outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_1px_0_rgba(0,0,0,0.06)] hover:-translate-y-px hover:bg-neutral-800 hover:shadow-[0_4px_10px_-4px_rgba(0,0,0,0.35)] active:translate-y-0 active:shadow-none",
        destructive:
          "border border-bad/40 bg-white text-bad hover:bg-bad-soft focus-visible:ring-bad/20",
        "destructive-solid":
          "bg-bad text-white hover:-translate-y-px hover:bg-bad/90 active:translate-y-0",
        outline:
          "border border-foreground/85 bg-white text-foreground hover:bg-subtle active:bg-accent",
        secondary:
          "border border-border bg-white text-foreground hover:border-foreground/40 hover:bg-subtle",
        ghost:
          "text-ink-2 hover:bg-accent hover:text-foreground",
        link: "h-auto! px-0! text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground",
      },
      size: {
        default: "h-8 px-3.5 text-[13px] has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1.5 rounded-md px-2.5 text-[12.5px] has-[>svg]:px-2",
        lg: "h-10 rounded-md px-5 text-sm has-[>svg]:px-4",
        icon: "size-8",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
