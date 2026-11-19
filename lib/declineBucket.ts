// Why Stripe refused a card typed into our own form (CardCheckoutModal's
// "custom" arm), as one name from a fixed list.
//
// The same list the API counts refusals under (sharescreen-api's
// server/paymentStatsReasons.ts — keep the two in step). Raw codes used to be
// sent as `pro_checkout_card_error.<code>`, and every code not listed in the
// feature's "site events" was dropped: 10 of the first 16 errors were lost
// that way. A fixed list is one admin entry per name, registered once.

export const CARD_ERROR_BUCKETS = [
  "no_funds",
  "not_allowed",
  "blocked",
  "fraud",
  "bad_data",
  "expired",
  "3ds",
  "call_issuer",
  "do_not_honor",
  "generic",
  "issuer_error",
  "unknown",
  "other",
] as const;

export type CardErrorBucket = (typeof CARD_ERROR_BUCKETS)[number];

const CODES: Record<string, CardErrorBucket> = {
  insufficient_funds: "no_funds",
  withdrawal_count_limit_exceeded: "no_funds",
  card_velocity_exceeded: "no_funds",
  transaction_not_allowed: "not_allowed",
  card_not_supported: "not_allowed",
  currency_not_supported: "not_allowed",
  not_permitted: "not_allowed",
  restricted_card: "not_allowed",
  service_not_allowed: "not_allowed",
  invalid_account: "not_allowed",
  fraudulent: "fraud",
  stolen_card: "fraud",
  lost_card: "fraud",
  pickup_card: "fraud",
  merchant_blacklist: "fraud",
  security_violation: "fraud",
  incorrect_number: "bad_data",
  invalid_number: "bad_data",
  incomplete_number: "bad_data",
  incorrect_cvc: "bad_data",
  invalid_cvc: "bad_data",
  incomplete_cvc: "bad_data",
  invalid_expiry_month: "bad_data",
  invalid_expiry_year: "bad_data",
  incomplete_expiry: "bad_data",
  invalid_expiry_year_past: "bad_data",
  incorrect_zip: "bad_data",
  expired_card: "expired",
  authentication_required: "3ds",
  authentication_not_handled: "3ds",
  payment_intent_authentication_failure: "3ds",
  call_issuer: "call_issuer",
  do_not_honor: "do_not_honor",
  do_not_try_again: "do_not_honor",
  generic_decline: "generic",
  card_declined: "generic",
  processing_error: "issuer_error",
  issuer_not_available: "issuer_error",
  reenter_transaction: "issuer_error",
  try_again_later: "issuer_error",
  network: "issuer_error",
  api_connection_error: "issuer_error",
};

/** Most specific first: decline code, then error code, then error type. */
export function cardErrorBucket(error: { decline_code?: string; code?: string; type?: string }): CardErrorBucket {
  for (const raw of [error.decline_code, error.code, error.type]) {
    const bucket = raw ? CODES[raw.toLowerCase()] : undefined;
    if (bucket) return bucket;
  }
  return error.decline_code || error.code ? "other" : "unknown";
}
