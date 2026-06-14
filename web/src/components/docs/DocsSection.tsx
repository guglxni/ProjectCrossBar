import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  id: string;
  title: string;
  children: ReactNode;
  className?: string;
}

export function DocsSection({ id, title, children, className }: Props) {
  return (
    <section
      id={id}
      className={cn("scroll-mt-28 border-b border-border pb-14 last:border-b-0", className)}
    >
      <h2 className="font-display text-2xl tracking-[-0.5px] text-foreground md:text-3xl">
        {title}
      </h2>
      <div className="mt-6 space-y-4 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

export function DocsDiagram({
  src,
  alt,
  caption,
}: {
  src: string;
  alt: string;
  caption?: string;
}) {
  return (
    <figure className="my-6 overflow-hidden rounded-xl border border-border bg-secondary/30">
      <img src={src} alt={alt} className="w-full" loading="lazy" />
      {caption && (
        <figcaption className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

export function DocsCodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-border bg-secondary/50 p-4 font-mono text-xs text-foreground">
      <code>{children}</code>
    </pre>
  );
}

export function DocsList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2 text-sm text-foreground">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
