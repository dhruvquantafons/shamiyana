import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { getPublicRates } from "../lib/rates";
import HeroSection from "../components/HeroSection";
import Reveal from "../components/Reveal";

const DESTINATIONS = [
  {
    href: "/rooms",
    image: "/gallery/11.jpg",
    eyebrow: "Accommodation",
    title: "Rooms & Rates",
    blurb: "Premier and Luxury rooms, on the CPAI plan.",
  },
  {
    href: "/dining",
    image: "/gallery/10.jpg",
    eyebrow: "Dining",
    title: "Shamiyana Restaurant",
    blurb: "Kashmiri Wazwan and international favourites.",
  },
  {
    href: "/gallery",
    image: "/gallery/5.jpg",
    eyebrow: "Gallery",
    title: "A Look Inside",
    blurb: "Rooms, bathrooms, lobby and conference spaces.",
  },
];

export default async function HomePage() {
  const { rooms } = await getPublicRates();

  return (
    <>
      <HeroSection rooms={rooms} />

      {/* Where to go next */}
      <section className="py-14 sm:py-24 bg-[#f9f8f5] text-[#1c1b1a]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal className="text-center max-w-2xl mx-auto mb-10">
            <p className="text-xs uppercase tracking-[0.3em] text-[#a88956] font-semibold mb-3">
              The Hotel
            </p>
            <h2 className="font-serif text-2xl sm:text-4xl lg:text-5xl font-light leading-tight">
              A prime address{" "}
              <span className="italic text-[#a88956] font-normal">in the valley</span>
            </h2>
            <p className="text-[#5a5854] text-sm font-light mt-4">
              1.5 km from Dal Lake and Lal Chowk, on the bank of the Jhelum.
            </p>
          </Reveal>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {DESTINATIONS.map((item, index) => (
              <Reveal key={item.href} delay={index * 90}>
                <Link
                  href={item.href}
                  className="hover-lift group block relative h-64 sm:h-80 rounded-xl overflow-hidden border border-[#e5e0d8] shadow-sm"
                >
                  <Image
                    src={item.image}
                    alt=""
                    aria-hidden="true"
                    fill
                    sizes="(max-width: 640px) 100vw, 33vw"
                    className="object-cover group-hover:scale-[1.08] transition-transform duration-[900ms] ease-out"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />

                  <div className="absolute inset-x-0 bottom-0 p-5 text-left">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-[#e6d7c3] font-semibold">
                      {item.eyebrow}
                    </p>
                    <h3 className="font-serif text-xl text-white font-medium mt-1">
                      {item.title}
                    </h3>
                    <p className="text-[11px] text-slate-300 font-light mt-1 leading-relaxed">
                      {item.blurb}
                    </p>
                    <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-[#e6d7c3] mt-3">
                      Explore
                      <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
                    </span>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>

          <Reveal className="text-center mt-10">
            <Link
              href="/about"
              className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-[#1c1b1a] hover:text-[#a88956] transition-colors font-semibold link-underline"
            >
              More about the hotel
              <ArrowRight className="w-3.5 h-3.5 text-[#a88956]" />
            </Link>
          </Reveal>
        </div>
      </section>
    </>
  );
}
