// Vendored from Foundry Workspace: skills-foundry/src/lib/utils.ts (verbatim, 6 lines).
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
