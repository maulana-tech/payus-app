"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";
import { linenFieldClass } from "./glass";

const Select = SelectPrimitive.Root;
const SelectValue = SelectPrimitive.Value;

function SelectTrigger({
  className,
  children,
  ...props
}: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        linenFieldClass,
        "group flex min-h-11 w-full items-center gap-3 border pr-3 pl-3 text-left text-base transition-colors outline-none hover:border-foreground/30 focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60 data-popup-open:border-foreground/40 md:text-sm",
        className,
      )}
      {...props}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2.5">
        {children}
      </span>
      <SelectPrimitive.Icon className="flex size-6 shrink-0 items-center justify-center text-foreground/55">
        <ChevronDownIcon className="size-4 transition-transform group-data-popup-open:rotate-180" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  ...props
}: SelectPrimitive.Popup.Props) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        className="isolate z-50 outline-none"
        sideOffset={6}
        alignItemWithTrigger={false}
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            "max-h-(--available-height) w-(--anchor-width) origin-(--transform-origin) overflow-y-auto rounded-xl bg-popover p-1.5 text-popover-foreground shadow-lg ring-1 ring-border/80 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        >
          {children}
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props & { children: React.ReactNode }) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "flex min-h-11 cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-foreground/8",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex min-w-0 flex-1 items-center gap-2.5">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="shrink-0">
        <CheckIcon className="size-4" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

export type SelectOption<V extends string> = {
  value: V;
  label: string;
  /** Second line in the list only; the trigger shows just the label. */
  hint?: string;
};

/**
 * A select over a fixed list of string values: the replacement for a native
 * <select>, styled like the fields around it. Name it with `aria-labelledby`
 * (a visible label) or `aria-label`.
 */
function OptionSelect<V extends string>({
  value,
  onValueChange,
  options,
  id,
  disabled,
  title,
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: {
  value: V;
  onValueChange: (value: V) => void;
  options: readonly SelectOption<V>[];
  id?: string;
  disabled?: boolean;
  title?: string;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next as V);
      }}
      items={options.map(({ value, label }) => ({ value, label }))}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        title={title}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={className}
      >
        <SelectValue className="truncate" />
      </SelectTrigger>
      <SelectContent className="min-w-48">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            <span className="grid min-w-0 gap-0.5">
              <span className="truncate">{o.label}</span>
              {o.hint ? (
                <span className="text-xs leading-4 text-muted-foreground">
                  {o.hint}
                </span>
              ) : null}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export {
  OptionSelect,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
};
