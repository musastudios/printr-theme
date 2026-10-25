# Order confirmation email: "send your artwork" line

Shopify notification templates can't be edited through the theme or the Admin API, so this has to be pasted by hand.

1. Shopify admin → **Settings → Notifications → Customer notifications → Order confirmation**.
2. Click **Edit code**.
3. Find the `{% for line in subtotal_line_items %}` loop's closing (or just above `<table class="row subtotal-lines">`), and paste the snippet below **outside** the loop, e.g. right after the opening paragraph that thanks the customer.
4. Click **Preview** (use an order that has the property), then **Save**.
5. Repeat in Spanish if you use a translated template (Settings → Languages → Notifications) with the `es` text.

```liquid
{%- assign artwork_later = false -%}
{%- for line in line_items -%}
  {%- for p in line.properties -%}
    {%- if p.first == 'Artwork' and p.last == 'Will send after checkout' -%}
      {%- assign artwork_later = true -%}
    {%- endif -%}
  {%- endfor -%}
{%- endfor -%}
{%- if artwork_later -%}
  <table class="row" style="margin-top:16px;"><tr><td style="padding:16px;border:2px solid #e0102b;border-radius:8px;">
    <p style="margin:0 0 8px;font-weight:bold;">Send your artwork to shopprintr@gmail.com with subject Order {{ order.name }}</p>
    <p style="margin:0;">Production starts once we receive your files. <a href="{{ shop.url }}/pages/upload-artwork?order={{ order.name | url_encode }}">How to send your artwork</a></p>
  </td></tr></table>
{%- endif -%}
```

Spanish text: “Envía tu arte a shopprintr@gmail.com con el asunto Order {{ order.name }}” / “Cómo enviar tu arte”.

Also create the page: **Online Store → Pages → Add page**, title "Upload artwork", handle `upload-artwork`, template `page.upload-artwork`.
