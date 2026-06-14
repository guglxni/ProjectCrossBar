import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <section className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-6 text-center">
      <p className="font-display text-7xl tracking-[-2px] text-foreground md:text-8xl">
        404
      </p>
      <h1 className="mt-4 text-xl font-medium text-foreground">
        This window never cleared.
      </h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
        The page you are looking for is not part of CrossBar. Head back and pick
        up a live batch on devnet.
      </p>
      <Button asChild className="mt-8 rounded-full">
        <Link to="/">
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to home
        </Link>
      </Button>
    </section>
  );
}
