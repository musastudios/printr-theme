# Design Service: tagging, brief request and reminders

Store: printr-theme.myshopify.com, **Basic** plan. Business email is on Zoho; customer contact address is
currently `shopprintr@gmail.com`. **Nothing here has been created**: every workflow, form, page and tag needs Juan's approval.
Legend: **V** = verified on the cited page this session, **I** = inferred / not verified.

## Goal
1. Order with a Design Service line → order tags `design-service`, `design-tier-<touchup|refresh|fresh>`, `brief-pending`; customer tag `design-client`.
2. Ask the customer for the brief right away; remind at [24h] and [72h]; stop reminders once the brief arrives.
3. Brief arrives → order tag `brief-received` (remove `brief-pending`) + notify the team.

## Platform facts

| Claim | V/I | Source |
|---|---|---|
| Flow is free on Basic, Grow, Advanced, Plus | V | https://help.shopify.com/en/manual/shopify-flow |
| Flow **Send HTTP request** needs Grow or higher (not Basic) | V | https://help.shopify.com/en/manual/shopify-flow |
| Flow can add/remove order and customer tags | V | https://help.shopify.com/en/manual/shopify-flow/getting-started/understanding-actions |
| Flow **Wait** can delay up to 90 days | V | https://help.shopify.com/en/manual/shopify-flow/reference/actions/wait |
| Flow **Send internal email** only goes to fixed staff addresses, not a variable customer email | V | https://help.shopify.com/en/manual/shopify-flow/reference/actions/send-email |
| Flow has no transactional "email the customer" action; customer emails from automation are marketing emails (subscribers only) | V (action list) / I (consent rule) | https://help.shopify.com/en/manual/shopify-flow/reference/actions |
| Shopify Forms: inline form on a page needs the Forms app embed; can add a customer tag on submit; can email staff per submission; max 25 forms; no conditional logic / multi-step | V | https://help.shopify.com/en/manual/promoting-marketing/create-marketing/forms-app/create |
| Shopify Forms **File upload** field: one file ≤ 20 MB; GIF, HEIC, JPEG, PDF, SVG, WebP, XML (PNG/AI/EPS not listed) | V | https://help.shopify.com/en/manual/promoting-marketing/create-marketing/forms-app/settings/all-forms |
| Uploaded form files appear in Content → Files | I (community) | community.shopify.com |
| Form submissions trigger Flow via **Metaobject entry created** (one trigger per form per workflow) | V | https://help.shopify.com/en/manual/promoting-marketing/create-marketing/forms-app/flow |
| Shopify Forms can't prefill fields from URL parameters | I | — |
| Order notification templates can loop `line_items` and `line.properties` | V | https://help.shopify.com/en/manual/fulfillment/setup/notifications/email-variables |
| Klaviyo free: 250 profiles, 500 emails/mo; paid from $20/mo | V | https://www.klaviyo.com/pricing |
| Klaviyo flow emails can be approved as **transactional** and then reach unsubscribed customers | V | https://help.klaviyo.com/hc/en-us/articles/360003165732 |
| Klaviyo can filter flows on synced Shopify customer tags | I | — |
| Zoho Forms free: 3 forms, 500 submissions/mo, file fields up to 5 files × 20 MB, webhooks | I (Zoho pricing page via search summary) | https://www.zoho.com/forms/pricing.html |
| Zoho Forms → Shopify tagging needs Zoho Flow or a webhook receiver; Shopify Flow can't receive webhooks | I | https://www.zohoflow.com/apps/shopify/integrations/zoho-forms/ |

## Options compared

| Need | Flow (Basic) + Shopify Forms | + Klaviyo | Zoho (Mail/Forms/Campaigns) | Cloudflare R2 + Worker page |
|---|---|---|---|---|
| Order/customer tags | ✅ native | (uses Flow) | ❌ needs API creds | ✅ via Admin API token |
| First brief request to customer | ✅ Order confirmation snippet (transactional) | ✅ | manual | n/a |
| Automatic customer reminders | ❌ (marketing only) → internal reminder to team | ✅ transactional flow (after approval) | manual send from Zoho Mail | custom code |
| Upload page | ✅ Forms inline on `/pages/design-brief`, 1 file × 20 MB | — | ✅ 5 files, own branding | ✅ any size/type |
| Set `brief-received` | ✅ Flow on form submit | — | ❌ without middleware | ✅ |
| Cost / upkeep | $0, no code | $0 up to 250 profiles | $0–low, extra system | code + secrets to maintain |

## Recommendation (simplest reliable stack)

**Shopify Flow + Shopify Forms + the Order confirmation snippet; reminders as internal alerts to the team.
Add Klaviyo only if manual reminders become a chore.**

### Workflow A: "Design Service – tag order" (Trigger: Order created)
1. Condition: any `order.lineItems` where `sku` starts with `DS-`.
2. Add order tags: `design-service`, `brief-pending`, plus one branch per tier
   (`sku == DS-TOUCHUP` → `design-tier-touchup`, `DS-REFRESH` → `design-tier-refresh`, `DS-FRESH` → `design-tier-fresh`).
3. Add customer tags: `design-client`.
4. Send internal email to the team [Zoho address TBD]: "New Design Service order {{order.name}} – {{tier}}".
5. **Wait [24h]** → Get order data (query `id:{{order.legacyResourceId}}`) → if tags do **not** contain `brief-received`
   → Send internal email "Remind {{order.email}} for {{order.name}}" with a ready-to-paste reminder text.
6. **Wait to [72h]** → same check → second internal reminder.
   (Re-fetching the order before each step is what makes reminders stop once the brief arrives.)

The first customer-facing request is the snippet in `docs/design-service.md` §4 (transactional, reaches everyone).
Reminders are sent by staff from the Zoho mailbox (or `shopprintr@gmail.com`).

### Workflow B: "Design brief received" (Trigger: Metaobject entry created → the brief form)
1. Get order data, query `name:{{metaobject.order_number}}` (form field "Order number") [I: query syntax to be tested].
2. If found: Add order tags `brief-received`; Remove order tags `brief-pending`.
3. Send internal email to the team with the order, email, notes and file link.
4. Fallback if the number doesn't match: the internal email says "no match", staff tag the order by hand.

### Brief form (Apps → Forms → Create form → Inline form "Design brief")
Fields: Email (required), Order number (single-line, required), What should we design? (multi-line),
Colors / references (multi-line), Deadline (date), File (file upload, optional). Customer tag on submit: `brief-submitted`.
Email notification for each submission: on. Place the inline form on page `/pages/design-brief` [confirm URL] via the Forms
app block. Note PNG isn't in the documented accepted types; customers should send PDF/JPEG/SVG or email bigger files.

### Upgrade path
- **Klaviyo** (free tier fits): flow "Placed Order where Items contains DS-" → wait [24h] → email (apply for transactional) →
  wait to [72h] → email, with a flow filter "Shopify tags does not contain brief-submitted" [I]. Turn off the Flow internal reminders after.
- **Zoho Forms** if customers need several files or bigger ones; `brief-received` would then be set by staff by hand (or Zoho Flow, paid).
- **R2 + Worker** only if large or raw files (AI/EPS/PSD) become common.

### Marketing-consent caveat
Don't use Shopify Email / marketing automations for brief reminders: they only reach subscribed customers, and a
brief reminder is transactional. That's why the stack above uses the order confirmation + staff reminders (or Klaviyo transactional).
