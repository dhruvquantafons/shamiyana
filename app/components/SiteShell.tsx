"use client";

import { createContext, useContext, useState } from "react";
import Navbar from "./Navbar";
import Footer from "./Footer";
import BookingWidget from "./BookingWidget";
import type { RoomType } from "../lib/types";

interface BookingContextValue {
  /** Opens the reservation panel, optionally pre-selecting a room by name. */
  openBooking: (roomName?: string) => void;
}

const BookingContext = createContext<BookingContextValue>({
  openBooking: () => {},
});

/**
 * Access to the reservation panel from anywhere inside the public site.
 *
 * Pages are Server Components and cannot hand a callback to a client section,
 * so the opener travels through context from the shell instead of as a prop.
 */
export function useBooking() {
  return useContext(BookingContext);
}

/** Shared chrome for every public page: header, footer, reservation panel. */
export default function SiteShell({
  rooms,
  bestRateMessage,
  languages,
  defaultLanguage,
  children,
}: {
  rooms: RoomType[];
  /** The hotel's own best-rate wording, from Settings (SOW Module 17). */
  bestRateMessage: string;
  /** Languages the property offers on the portal, and the one to open in. */
  languages: string[];
  defaultLanguage: string;
  children: React.ReactNode;
}) {
  const [bookingOpen, setBookingOpen] = useState(false);
  const [preselectedRoom, setPreselectedRoom] = useState("");

  const openBooking = (roomName?: string) => {
    setPreselectedRoom(typeof roomName === "string" ? roomName : "");
    setBookingOpen(true);
  };

  return (
    <BookingContext.Provider value={{ openBooking }}>
      <div className="min-h-screen flex flex-col bg-[#0b131b] text-slate-100 selection:bg-[#c5a059] selection:text-black">
        <Navbar />
        <main className="flex-1">{children}</main>
        <Footer rooms={rooms} />

        {/* Mounted only while open so its state resets on close */}
        {bookingOpen && (
          <BookingWidget
            isOpen
            onClose={() => setBookingOpen(false)}
            roomTypes={rooms}
            preselectedRoom={preselectedRoom}
            bestRateMessage={bestRateMessage}
            languages={languages}
            defaultLanguage={defaultLanguage}
          />
        )}
      </div>
    </BookingContext.Provider>
  );
}
