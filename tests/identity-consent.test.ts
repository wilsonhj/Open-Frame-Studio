import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { IDENTITY_CONSENT_FIELD, assertIdentityConsent } from "../lib/identity/consent.ts";
import { InputError } from "../lib/inputs.ts";

describe("identity consent", () => {
  it("accepts explicit consent only (JSON true, or a ticked form checkbox)", () => {
    for (const value of [true, "true", "on"]) assertIdentityConsent(value);
  });

  it("refuses missing or anything-but-yes values, naming the consent field", () => {
    for (const value of [undefined, null, false, "false", "", "off", "yes", 1, {}]) {
      assert.throws(
        () => assertIdentityConsent(value),
        (error: unknown) => error instanceof InputError && error.field === IDENTITY_CONSENT_FIELD,
        `refused ${JSON.stringify(value)}`,
      );
    }
  });
});
