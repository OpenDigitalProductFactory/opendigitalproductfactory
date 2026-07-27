import { describe, expect, it } from "vitest";
import {
  CONTACT_PHONE_TYPES,
  CustomerNotificationPreference,
  PREFERRED_NOTIFICATION_CHANNELS,
  contactPhoneTypeSchema,
  createContactSchema,
  preferredNotificationChannelSchema,
  updateContactSchema,
} from "./customer";

describe("CustomerNotificationPreference (BI-FS-003)", () => {
  it("accepts every allowed channel and phone type", () => {
    for (const preferredNotificationChannel of PREFERRED_NOTIFICATION_CHANNELS) {
      expect(preferredNotificationChannelSchema.parse(preferredNotificationChannel)).toBe(
        preferredNotificationChannel,
      );
    }
    for (const phoneType of CONTACT_PHONE_TYPES) {
      expect(contactPhoneTypeSchema.parse(phoneType)).toBe(phoneType);
    }
    expect(
      CustomerNotificationPreference.parse({
        preferredNotificationChannel: "sms",
        phoneType: "mobile",
      }),
    ).toEqual({ preferredNotificationChannel: "sms", phoneType: "mobile" });
  });

  it("rejects invalid channel and phone type values", () => {
    expect(() => preferredNotificationChannelSchema.parse("fax")).toThrow();
    expect(() => contactPhoneTypeSchema.parse("voip")).toThrow();
    expect(() =>
      CustomerNotificationPreference.parse({
        preferredNotificationChannel: "carrier-pigeon",
        phoneType: "mobile",
      }),
    ).toThrow();
  });

  it("allows null/omitted preference (operator has not set yet)", () => {
    expect(CustomerNotificationPreference.parse({})).toEqual({});
    expect(
      CustomerNotificationPreference.parse({
        preferredNotificationChannel: null,
        phoneType: null,
      }),
    ).toEqual({ preferredNotificationChannel: null, phoneType: null });
  });

  it("accepts preference fields on create and update contact schemas", () => {
    const created = createContactSchema.parse({
      email: "tech@example.com",
      accountId: "acct_1",
      preferredNotificationChannel: "sms",
      phoneType: "mobile",
    });
    expect(created.preferredNotificationChannel).toBe("sms");
    expect(created.phoneType).toBe("mobile");

    const updated = updateContactSchema.parse({
      preferredNotificationChannel: "none",
      phoneType: "landline",
    });
    expect(updated).toEqual({
      preferredNotificationChannel: "none",
      phoneType: "landline",
    });
  });

  it("rejects invalid preference values on contact update", () => {
    expect(() =>
      updateContactSchema.parse({ preferredNotificationChannel: "telegram" }),
    ).toThrow();
  });
});
