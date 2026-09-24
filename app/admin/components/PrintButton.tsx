"use client";

import { Printer } from "lucide-react";
import { buttonClass } from "./ui";

export default function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={buttonClass}>
      <span className="flex items-center gap-1.5">
        <Printer className="w-3.5 h-3.5" /> {label}
      </span>
    </button>
  );
}
