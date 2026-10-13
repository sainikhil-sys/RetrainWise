"use client";

import { CheckCircle, CircleNotch, Info, Warning, XCircle } from "@phosphor-icons/react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/** Toasts: crisp white panels, monochrome, with operational color only in the icon. */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      icons={{
        success: <CheckCircle weight="fill" className="size-4 text-ok" />,
        info: <Info weight="fill" className="size-4 text-foreground" />,
        warning: <Warning weight="fill" className="size-4 text-warn" />,
        error: <XCircle weight="fill" className="size-4 text-bad" />,
        loading: <CircleNotch className="size-4 animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          toast: "!rounded-lg !border !border-border !bg-white !text-foreground !shadow-[0_8px_24px_-12px_rgba(0,0,0,0.25)] !font-sans",
          title: "!text-[13px] !font-medium",
          description: "!text-[12.5px] !text-muted-foreground",
          actionButton: "!bg-primary !text-primary-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
