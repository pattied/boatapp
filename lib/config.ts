// Server-side settings, read from environment variables.
export function getConfig() {
  return {
    businessName: (process.env.BUSINESS_NAME || "Boat Care").trim(),
    instagramHandle: (process.env.INSTAGRAM_HANDLE || "").trim().replace(/^@/, ""),
    passcodeRequired: Boolean(process.env.APP_PASSCODE),
  };
}

export type PublicConfig = ReturnType<typeof getConfig>;
