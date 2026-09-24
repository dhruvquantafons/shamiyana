import type { Metadata } from "next";
import GallerySection from "../../components/GallerySection";
import PageHeader from "../../components/PageHeader";

export const metadata: Metadata = {
  title: "Gallery",
  description:
    "Photographs of Hotel Shamiyana — rooms and suites, en-suite bathrooms, the reception lobby, and conference spaces in Srinagar.",
  alternates: { canonical: "/gallery" },
};

export default function GalleryPage() {
  return (
    <>
      <PageHeader
        eyebrow="Gallery"
        title="A Look Inside"
        lead="Rooms, bathrooms, the lobby and our conference spaces."
        image="/gallery/8.jpg"
      />
      <GallerySection />
    </>
  );
}
