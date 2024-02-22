import type { Context, ProviderProps } from "./types"

export function createContext<T>(initial: T | null): Context<T> {
  let context = initial as T

  return {
    Provider: ({ value, children = [] }: ProviderProps<T>) => {
      context = value
      return children as JSX.Element
    },
    value: () => context,
  }
}