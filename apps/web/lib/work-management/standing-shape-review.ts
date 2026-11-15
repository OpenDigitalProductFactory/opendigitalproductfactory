// The review cadence every standing operations shape shares (BI-7E7B93DF).
// One home, so the two standing-shape modules cannot drift apart.

export const MONTHLY_REVIEW = {
  everyDays: 30,
  description:
    "Reviewed monthly whether or not it moved: an activity that has reported nothing for a "
    + "month is as likely to be broken as to be reassuring.",
} as const;
