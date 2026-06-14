import { cn } from "@/lib/utils";
import type { DocsSectionId } from "@/lib/docs-content";
import { DOCS_SECTIONS } from "@/lib/docs-content";

interface Props {
  active: DocsSectionId;
  onSelect: (id: DocsSectionId) => void;
}

export function DocsSidebar({ active, onSelect }: Props) {
  return (
    <nav
      aria-label="Documentation sections"
      className="hidden lg:block"
    >
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        On this page
      </p>
      <ul className="mt-4 space-y-1 border-l border-border pl-4">
        {DOCS_SECTIONS.map((section) => (
          <li key={section.id}>
            <button
              type="button"
              onClick={() => onSelect(section.id)}
              className={cn(
                "block w-full py-1.5 text-left text-sm transition-colors",
                active === section.id
                  ? "font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {section.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function DocsMobileNav({ active, onSelect }: Props) {
  return (
    <div className="lg:hidden">
      <div className="flex gap-2 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {DOCS_SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            onClick={() => onSelect(section.id)}
            className={cn(
              "shrink-0 rounded-full px-4 py-2 text-xs font-medium transition-colors",
              active === section.id
                ? "bg-foreground text-background"
                : "bg-secondary text-muted-foreground",
            )}
          >
            {section.label}
          </button>
        ))}
      </div>
    </div>
  );
}
