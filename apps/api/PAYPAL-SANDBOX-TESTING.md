# PayPal checkout sandbox testing

Configure the API Worker with the Sandbox client ID and secret and set `PAYPAL_ENVIRONMENT=sandbox`. `PAYPAL_WEBHOOK_ID` is optional for checkout, but required to accept verified webhooks. For local Wrangler development, put values in `apps/api/.dev.vars`; configure deployed values with Wrangler secrets/variables. Do not commit `.dev.vars`.

| Variable | Requirement | Purpose |
| --- | --- | --- |
| `PAYPAL_CLIENT_ID` | Required | PayPal app client ID |
| `PAYPAL_CLIENT_SECRET` | Required | Server-side OAuth credential |
| `PAYPAL_ENVIRONMENT` | Optional | `sandbox` by default; set to `live` for production |
| `PAYPAL_WEBHOOK_ID` | Optional | Required only to verify/process webhooks; live mode warns if unset |
| `PAYPAL_ENABLE_NEGATIVE_TESTING` | Dev-only | Set to `true` only for explicit Sandbox decline tests; never active in live mode |

The webhook callback is `POST /api/store/paypal/webhook`. Without `PAYPAL_WEBHOOK_ID`, this endpoint returns `503 WEBHOOK_NOT_CONFIGURED` and never processes the event. To test locally, expose the API's local port (8002) with a temporary HTTPS tunnel, register the tunnel URL plus `/api/store/paypal/webhook` as a webhook on the Sandbox app, subscribe to `PAYMENT.CAPTURE.COMPLETED`, `PENDING`, `DENIED`, `REFUNDED`, and `REVERSED`, then set `PAYPAL_WEBHOOK_ID` to the ID PayPal assigns. Do not expose production credentials through a local tunnel.

| Scenario | Setup / action | Expected result |
| --- | --- | --- |
| Approved payment | Use a Sandbox personal buyer account, approve in Smart Buttons, and complete with a valid Sandbox funding source. | One order for the checkout session; payment status `paid`; capture and amount/currency are verified. |
| Declined instrument | In local `.dev.vars`, set `PAYPAL_ENABLE_NEGATIVE_TESTING=true` with `PAYPAL_ENVIRONMENT=sandbox`; the server sends `PayPal-Mock-Response: {"mock_application_codes":"INSTRUMENT_DECLINED"}` on capture. | API returns `402 PAYMENT_DECLINED` with `retryable: true`; the popup restarts on the same PayPal order. The test header is never sent when `PAYPAL_ENVIRONMENT=live`. Remove the flag and restart Wrangler before normal payment testing. |
| Pending capture | Use a Sandbox payment method that produces a pending/eCheck capture, if available. | An order is stored as `paymentStatus=pending`; the store shows that PayPal is reviewing the payment and does not report payment success. A later verified completion webhook changes it to `paid`. |
| Browser closes after payment | Approve/capture, then close the store page before the capture callback persists the order. | A verified `PAYMENT.CAPTURE.COMPLETED` webhook creates or finalizes the one order. |
| Duplicate delivery | Resend the same verified event from the PayPal developer dashboard. | The existing order is unchanged; no second order is created. |
| Invalid signature | Send a webhook-shaped request without valid PayPal transmission headers/signature. | The endpoint rejects it and does not query or mutate checkout/order records. |
| Refund / reversal | Refund or reverse a Sandbox capture, then wait for the subscribed webhook. | Existing order payment status becomes `refunded`; repeated or older status events do not undo it. |
| Network / DB recovery | Run the mocked API tests for capture timeout, already-captured reconciliation, and D1 write failure/retry. | An uncertain capture is reconciled by GET; a completed payment can be persisted on retry without a second order. |

The create-order idempotency key is derived from the checkout session, total, line items, and shipping selection. Retrying identical checkout data reuses the key/order. Changing the shipping selection changes the key; a PayPal order from the previous selection is no longer the active session order and cannot be captured through that checkout. Each Smart Buttons approval attempt gets its own deterministic capture key; retries within one attempt reuse it, while `actions.restart()` can use a new key for the same order after a decline.
