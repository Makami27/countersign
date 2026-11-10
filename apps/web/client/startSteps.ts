export const START_STEPS = [
  { key: "signedIn", label: "Continue with Slush" },
  { key: "funded", label: "Fund your agent wallet (it pays your bills)" },
  { key: "payeeAdded", label: "Add a payee and send them the signing link" },
  { key: "linkSigned", label: "They sign once" },
  { key: "paid", label: "Pay or schedule" },
  { key: "scamTried", label: "Try pasting a scam" },
] as const;
