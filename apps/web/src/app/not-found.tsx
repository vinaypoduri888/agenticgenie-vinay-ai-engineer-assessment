import { EmptyState, LinkButton } from "../components/ui";

export default function NotFound() {
  return (
    <EmptyState
      title="We couldn't find that page"
      description="It may have moved, or you may not have access to it."
      action={<LinkButton href="/events">Discover events</LinkButton>}
    />
  );
}
