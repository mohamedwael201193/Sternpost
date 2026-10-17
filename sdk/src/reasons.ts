/** Human explanations for the governor's previewDraw() reason codes. */
export const reasonText: Record<string, string> = {
  "": "Safe. This draw keeps your collateral ratio above your floor.",
  FROZEN: "Draws are frozen. You revoked access; unfreeze to allow draws again.",
  ZERO_AMOUNT: "Enter an amount above zero.",
  APP_NOT_AUTHORIZED: "This app has no credit line from you.",
  APP_EXPIRED: "This app's access has expired.",
  OVER_PER_DRAW: "More than this app may draw at once.",
  OVER_BUDGET: "More than this app's remaining budget.",
  PAYEE_NOT_ALLOWED: "This app may only pay its approved address.",
  BELOW_FLOOR: "Unsafe. This would push your collateral ratio below your floor.",
};

export const explain = (code: string) => reasonText[code] ?? code;
