import type { Metadata } from "next";
import DiningSection from "../../components/DiningSection";
import PageHeader from "../../components/PageHeader";

export const metadata: Metadata = {
  title: "Dining",
  description:
    "Shamiyana Restaurant serves traditional Kashmiri Wazwan alongside international dishes, with breakfast, Kahwa and in-room dining around the clock.",
  alternates: { canonical: "/dining" },
};

export default function DiningPage() {
  return (
    <>
      <PageHeader
        eyebrow="Dining"
        title="Shamiyana Restaurant"
        lead="Kashmiri Wazwan and international favourites, served through the day."
        image="/gallery/10.jpg"
      />
      <DiningSection />
    </>
  );
}
