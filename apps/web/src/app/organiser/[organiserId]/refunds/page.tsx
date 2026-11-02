import { redirect } from "next/navigation";

// Refunds moved onto the orders list, where staff can find an order without
// having to know its id.
export default async function OrganiserRefundsRedirect({ params }: { params: Promise<{ organiserId: string }> }) {
  const { organiserId } = await params;
  redirect(`/organiser/${organiserId}/orders`);
}
