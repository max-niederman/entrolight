export {};

declare global {
  class Highlight extends Set<AbstractRange> {
    constructor(...init: AbstractRange[]);
  }

  interface HighlightRegistry {
    set(name: string, highlight: Highlight): HighlightRegistry;
    get(name: string): Highlight | undefined;
    delete(name: string): boolean;
    clear(): void;
  }

  interface CSS {
    highlights?: HighlightRegistry;
  }
}
