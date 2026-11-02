"use client";

import { Button, EmptyState } from "../components/ui";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <EmptyState title="Something went wrong" description="That page hit an unexpected error. Nothing was charged." action={<Button onClick={reset}>Try again</Button>} />;
}
