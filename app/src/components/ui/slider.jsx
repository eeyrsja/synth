import * as React from "react";
import { cn } from "@/lib/utils";

const Slider = React.forwardRef(
  ({ className, value, onValueChange, min = 0, max = 100, step = 1, ...props }, ref) => {
    return (
      <input
        ref={ref}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value?.[0] ?? 0}
        onChange={(e) => onValueChange?.([parseFloat(e.target.value)])}
        className={cn("synth-slider w-full cursor-pointer", className)}
        {...props}
      />
    );
  }
);
Slider.displayName = "Slider";

export { Slider };
