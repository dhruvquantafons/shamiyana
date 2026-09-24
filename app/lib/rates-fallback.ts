import type { RoomType, ExtraCharge } from "./types";

/**
 * The hotel's published tariff, hardcoded.
 *
 * Used before Supabase is configured and as a safety net if the rates query
 * fails. Keep in step with supabase/migrations/0001_init.sql and 0006, which seed
 * the same values into the database.
 */
export const ROOMS_FALLBACK: RoomType[] = [
  {
    id: "premier-room",
    slug: "premier-room",
    name: "Premier Room",
    category: "premier",
    tagline: "Comfortable Kashmiri Elegance for the Discerning Traveller",
    description:
      "Our Premier Rooms offer warm, tastefully furnished spaces with modern amenities including LED TV, Mini Bar, Tea & Coffee Maker, Air Conditioning / Centralised Heating, and Electronic Locks — ideal for leisure and corporate travellers alike.",
    size: "300–350 sq. ft.",
    occupancy: "Up to 2 Guests",
    view: "River & City View",
    base_rate: 9499,
    weekend_rate: null,
    base_occupancy: 2,
    max_adults: 2,
    max_children: 1,
    amenities: [],
    gallery: [],
    image: "/gallery/11.jpg",
    highlights: [
      "Plush King-Size Bed",
      "LED TV & High-Speed Wi-Fi",
      "Tea & Coffee Maker",
      "Electronic Lock & Mini Bar",
    ],
    is_active: true,
    sort_order: 1,
    updated_at: "",
  },
  {
    id: "luxury-room",
    slug: "luxury-room",
    name: "Luxury Room",
    category: "luxury",
    tagline: "Elevated Comfort with Panoramic Jhelum River Views",
    description:
      "Wake up to sweeping views of the historic Jhelum River from our Luxury Rooms. Featuring generous living space, bespoke Kashmiri woodwork, premium toiletries, and all modern conveniences for an unforgettable valley stay.",
    size: "400–550 sq. ft.",
    occupancy: "Up to 3 Guests",
    view: "Panoramic River View",
    base_rate: 10799,
    weekend_rate: null,
    base_occupancy: 2,
    max_adults: 3,
    max_children: 1,
    amenities: [],
    gallery: [],
    image: "/gallery/12.jpg",
    highlights: [
      "River-Facing Windows",
      "Spacious Lounge Seating",
      "Premium Herbal Toiletries",
      "24/7 In-Room Dining",
    ],
    is_active: true,
    sort_order: 2,
    updated_at: "",
  },
];

export const EXTRA_CHARGES_FALLBACK: ExtraCharge[] = [
  { id: "extra-occupant", label: "Extra Occupant (Above 10 Years)", amount: 2200, kind: "extra_adult", sort_order: 1, is_active: true, updated_at: "" },
  { id: "child-no-bed", label: "Child Without Bed", amount: 1500, kind: "child_no_bed", sort_order: 2, is_active: true, updated_at: "" },
  { id: "buffet", label: "Buffet Lunch / Dinner (per person)", amount: 1470, kind: "meal", sort_order: 3, is_active: true, updated_at: "" },
  { id: "child-meal", label: "Meal – Child (Age 5–10 Years)", amount: 750, kind: "child_meal", sort_order: 4, is_active: true, updated_at: "" },
];
