import { prisma } from "@agenticgenie/db";

/** Not in the PDF's minimum contract, but necessary for any organiser-side
 * UI to function at all: without it, a logged-in admin/staff user has no
 * way to discover which organiser(s) they belong to, and every
 * organiser-scoped endpoint requires that id in the URL. A small, obvious
 * extension (per the PDF's "you may extend the API"), not a new concept. */
export async function getMyMemberships(userId: string) {
  const memberships = await prisma.organiserMembership.findMany({
    where: { userId },
    include: { organiser: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });

  return memberships.map((m) => ({
    organiserId: m.organiserId,
    organiserName: m.organiser.name,
    role: m.role,
  }));
}
