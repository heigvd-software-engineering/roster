import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names: `clsx` flattens conditional/array inputs, then `twMerge`
 * resolves conflicting Tailwind utilities (e.g. `px-2` + `px-4` → `px-4`). Lets
 * every component accept a `className` override without duplicate/warring classes.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
