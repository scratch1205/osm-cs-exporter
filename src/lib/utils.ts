import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge TailwindCSS class names with conflict resolution (shadcn/ui helper). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
