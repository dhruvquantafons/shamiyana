import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEMPLATES,
  TEMPLATE_LABELS,
  pickTemplate,
  renderTemplate,
  unknownPlaceholders,
} from "../app/lib/message-templates";
import { guestTags, TIMED_TEMPLATES } from "../app/lib/types";
import type { MessageTemplate } from "../app/lib/types";

describe("renderTemplate", () => {
  it("fills placeholders and leaves unknown ones visible", () => {
    expect(renderTemplate("Dear {FirstName}, see you on {CheckInDate}. {Oops}", { FirstName: "Asha", CheckInDate: "5 Oct" })).toBe(
      "Dear Asha, see you on 5 Oct. {Oops}",
    );
  });

  it("drops a line whose placeholder has no value", () => {
    const text = "Thank you for staying.\nWe would love to hear about your stay: {FeedbackLink}";
    expect(renderTemplate(text, { FeedbackLink: "" })).toBe("Thank you for staying.");
    expect(renderTemplate(text, { FeedbackLink: "https://x/f/abc" })).toContain("https://x/f/abc");
  });

  it("flags placeholders that do not exist", () => {
    expect(unknownPlaceholders("{GuestName} {CheckinDate} {Reference}")).toEqual(["CheckinDate"]);
  });
});

describe("pickTemplate", () => {
  const hi: MessageTemplate = { template: "confirmation", language: "hi", subject: "बुकिंग पक्की — {Reference}", body: "", footer: "", sms: "" };
  const en: MessageTemplate = { template: "confirmation", language: "en", subject: "Confirmed {Reference}", body: "", footer: "", sms: "" };

  it("prefers the guest's language, then the default, then English, then the built-in text", () => {
    expect(pickTemplate([hi, en], "confirmation", ["hi", "en"]).subject).toBe(hi.subject);
    expect(pickTemplate([hi, en], "confirmation", ["fr", "en"]).subject).toBe(en.subject);
    expect(pickTemplate([hi], "confirmation", ["fr", "de"]).subject).toBe(DEFAULT_TEMPLATES.confirmation.subject);
    expect(pickTemplate([], "cancellation", [null]).subject).toBe(DEFAULT_TEMPLATES.cancellation.subject);
  });
});

describe("guestTags", () => {
  it("derives Repeat Guest and Corporate and keeps a fixed order", () => {
    expect(guestTags({ tags: ["Blacklisted", "VIP", "odd"], company_id: "c" }, { stays: 3 })).toEqual([
      "VIP",
      "Blacklisted",
      "Repeat Guest",
      "Corporate",
    ]);
    expect(guestTags({ tags: [], company_id: null }, { stays: 1 })).toEqual([]);
  });
});

// ── Module 16: the full set of messages ─────────────────────────────────────

describe("the notification engine's templates", () => {
  const KEYS = [
    "request_received",
    "confirmation",
    "cancellation",
    "final_bill",
    "pre_arrival",
    "checkin_instructions",
    "post_stay",
    "payment_receipt",
    "booking_modified",
  ] as const;

  it("covers every message the SOW names", () => {
    for (const key of KEYS) {
      expect(DEFAULT_TEMPLATES[key], `missing default for ${key}`).toBeTruthy();
      expect(TEMPLATE_LABELS[key], `missing label for ${key}`).toBeTruthy();
    }
  });

  it("gives every message a subject and an SMS, so neither channel is blank", () => {
    for (const key of KEYS) {
      expect(DEFAULT_TEMPLATES[key].subject.trim(), `${key} subject`).not.toBe("");
      expect(DEFAULT_TEMPLATES[key].sms.trim(), `${key} sms`).not.toBe("");
    }
  });

  it("uses no placeholder the editor cannot explain", () => {
    // A placeholder missing from PLACEHOLDERS would render literally in a
    // guest's email, and the editor would warn about the hotel's own wording.
    for (const key of KEYS) {
      const t = DEFAULT_TEMPLATES[key];
      const all = [t.subject, t.body, t.footer, t.sms].join("\n");
      expect(unknownPlaceholders(all), `${key} has unknown placeholders`).toEqual([]);
    }
  });

  it("names the timed messages the nightly job sends", () => {
    expect([...TIMED_TEMPLATES]).toEqual(["pre_arrival", "checkin_instructions", "post_stay"]);
    for (const key of TIMED_TEMPLATES) {
      expect(DEFAULT_TEMPLATES[key]).toBeTruthy();
    }
  });

  it("puts the feedback link only in the messages that follow a stay", () => {
    const mentions = (key: (typeof KEYS)[number]) =>
      [DEFAULT_TEMPLATES[key].body, DEFAULT_TEMPLATES[key].footer, DEFAULT_TEMPLATES[key].sms]
        .join("\n")
        .includes("{FeedbackLink}");
    expect(mentions("post_stay")).toBe(true);
    expect(mentions("final_bill")).toBe(true);
    expect(mentions("pre_arrival")).toBe(false);
    expect(mentions("confirmation")).toBe(false);
  });

  it("drops the feedback line when a guest has already given feedback", () => {
    // feedbackLinkFor returns null once the form is submitted, so the
    // thank-you must not go out with a dangling "tell us how we did:".
    const t = DEFAULT_TEMPLATES.post_stay;
    const rendered = renderTemplate(t.footer, { FeedbackLink: "" });
    expect(rendered).toBe("");
  });

  it("asks a payment receipt for the amount and the balance", () => {
    const t = DEFAULT_TEMPLATES.payment_receipt;
    const all = [t.body, t.footer, t.sms].join("\n");
    expect(all).toContain("{Amount}");
    expect(all).toContain("{Balance}");
  });

  it("tells a guest the times in the check-in instructions", () => {
    const t = DEFAULT_TEMPLATES.checkin_instructions;
    expect(t.body).toContain("{CheckInTime}");
    expect(t.body).toContain("{CheckOutTime}");
  });
});
