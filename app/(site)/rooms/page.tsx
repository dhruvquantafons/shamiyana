import type { Metadata } from "next";
import { getPublicRates } from "../../lib/rates";
import SuitesSection from "../../components/SuitesSection";
import PageHeader from "../../components/PageHeader";

export const metadata: Metadata = {
  title: "Rooms & Rates",
  description:
    "Premier and Luxury rooms at Hotel Shamiyana, Srinagar. Rates quoted on the CPAI plan, inclusive of applicable taxes.",
  alternates: { canonical: "/rooms" },
};

export default async function RoomsPage() {
  const { rooms, charges } = await getPublicRates();

  return (
    <>
      <PageHeader
        eyebrow="Accommodation"
        title="Rooms & Rates"
        lead="Kashmiri woodwork, plush bedding, and valley views."
        image="/gallery/12.jpg"
      />
      <SuitesSection rooms={rooms} charges={charges} />
    </>
  );
}
