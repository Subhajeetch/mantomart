export function UserStubPage({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="min-h-[calc(100svh-4rem)] bg-background">
      <div className="mx-auto max-w-4xl space-y-8 p-5 md:p-10">
        <header className="border-b border-border pb-6">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            {eyebrow}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        </header>
        <div className="border border-border p-8 text-center text-sm text-muted-foreground">
          This section is coming soon.
        </div>
      </div>
    </div>
  );
}
