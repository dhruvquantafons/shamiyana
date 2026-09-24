import type { Metadata } from "next";
import AboutSection from "../../components/AboutSection";
import PageHeader from "../../components/PageHeader";

export const metadata: Metadata = {
  title: "About Us",
  description:
    "Hotel Shamiyana is situated at a prime location in the valley of Kashmir — 1.5 km from Dal Lake and Lal Chowk, on the bank of the Jhelum, with 33 Deluxe Rooms, 03 Royal Suites and 02 Presidential Suites.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <>
      <PageHeader
        eyebrow="About Us"
        title="A Prime Location in the Valley"
        lead="On the bank of the Jhelum, 1.5 km from Dal Lake and Lal Chowk."
        image="/gallery/1.jpg"
      />
      <AboutSection />
    </>
  );
}
