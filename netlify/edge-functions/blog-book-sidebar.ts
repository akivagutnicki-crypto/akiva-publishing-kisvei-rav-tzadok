import type { Config, Context } from "@netlify/edge-functions";

/** Add the published-book shelf alongside the complete illustrated essay,
 * without modifying the source HTML or its original family photographs. */
export default async (_request: Request, context: Context) => {
  const response = await context.next();
  if (response.status !== 200 ||
      !(response.headers.get("content-type") || "").includes("text/html")) return response;

  let html = await response.text();
  if (html.includes('id="akiva-faith-sidebar"')) return new Response(html, response);

  const opening = html.match(/<main(?:\s[^>]*)?>/i);
  if (!opening || !/<\/main>/i.test(html)) return new Response(html, response);

  const sidebar = [
    '<aside id="akiva-faith-sidebar" class="akiva-faith-sidebar" aria-label="Explore Akiva Publishing sefarim">',
    '<div class="akiva-faith-eyebrow">Akiva Publishing · Library</div>',
    '<h2>Continue Your Learning</h2>',
    '<p class="akiva-faith-intro">Explore the published bilingual editions of Kisvei Rav Tzadok. Select a cover to visit the corresponding book collection.</p>',
    '<section class="akiva-faith-book-group" aria-label="Takanas HaShavin">',
    '<h3>Takanas HaShavin</h3>',
    '<div class="akiva-faith-book"><a href="/#takanas"><img loading="lazy" src="/volume-i-front.png" alt="Takanas HaShavin Volume I original book cover"></a><div><strong>Volume I</strong><small>Hakdamah · Simanim 1–9</small><a href="/#takanas">Explore the edition →</a><a href="https://www.amazon.com/s?k=Takanas+HaShavin+Volume+I+Akiva+Publishing" target="_blank" rel="noopener noreferrer">Find on Amazon ↗</a></div></div>',
    '<div class="akiva-faith-book"><a href="/#takanas"><img loading="lazy" src="/volume-ii-front.png" alt="Takanas HaShavin Volume II original book cover"></a><div><strong>Volume II</strong><small>Second volume</small><a href="/#takanas">Explore the edition →</a><a href="https://www.amazon.com/s?k=Takanas+HaShavin+Volume+II+Akiva+Publishing" target="_blank" rel="noopener noreferrer">Find on Amazon ↗</a></div></div>',
    '<a class="akiva-faith-secondary" href="https://www.amazon.com/dp/B0HF5SFWH7" target="_blank" rel="noopener noreferrer">Takanas HaShavin · known Amazon listing ↗</a>',
    '</section>',
    '<section class="akiva-faith-book-group" aria-label="The Livyasan and Shavuos">',
    '<h3>The Livyasan and Shavuos</h3>',
    '<div class="akiva-faith-book"><a href="/#livyasan"><img loading="lazy" src="/livyasan-cover.jpg" alt="The Livyasan and Shavuos original book cover"></a><div><strong>Annotated bilingual edition</strong><a href="/#livyasan">Explore the edition →</a><a href="https://www.amazon.com/dp/B0H1YF5N8M" target="_blank" rel="noopener noreferrer">Buy on Amazon ↗</a></div></div>',
    '</section>',
    '<section class="akiva-faith-book-group" aria-label="Resisei Layla">',
    '<h3>Resisei Layla · Both Volumes</h3>',
    '<div class="akiva-faith-book"><a href="/#resisei"><img loading="lazy" src="/resisei-volume-i-front-original.webp" alt="Resisei Layla Volume I original book cover"></a><div><strong>Volume I</strong><small>Simanim 1–42</small><a href="https://www.amazon.com/dp/B0HM7GT85X" target="_blank" rel="noopener noreferrer">Paperback ↗</a><a href="https://www.amazon.com/dp/B0HM6TX1S9" target="_blank" rel="noopener noreferrer">Hardcover ↗</a></div></div>',
    '<div class="akiva-faith-book"><a href="/#resisei"><img loading="lazy" src="/resisei-volume-ii-front-original.webp" alt="Resisei Layla Volume II original book cover"></a><div><strong>Volume II</strong><small>Simanim 43–58</small><a href="https://www.amazon.com/dp/B0HM795W5M" target="_blank" rel="noopener noreferrer">Paperback ↗</a><a href="https://www.amazon.com/dp/B0HMFJ9DJV" target="_blank" rel="noopener noreferrer">Hardcover ↗</a></div></div>',
    '</section>',
    '<div class="akiva-faith-collection"><a href="/library/">Open the free Rav Tzadok reading library →</a><a href="/library/blog/">More Weekly Torah essays →</a></div>',
    '</aside>'
  ].join("");

  const css = [
    '.akiva-faith-layout{width:min(1180px,calc(100% - 34px));margin:22px auto 70px;display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:38px;align-items:start}',
    '.akiva-faith-layout>main{min-width:0;max-width:none!important;width:100%;margin:0!important}',
    '.akiva-faith-layout>main img{max-width:100%;height:auto}',
    '.akiva-faith-sidebar{position:sticky;top:18px;max-height:calc(100vh - 36px);overflow-y:auto;overscroll-behavior:contain;background:#fffdf8;border:1px solid #dbd0be;border-top:4px solid #17372d;padding:19px 14px 22px;color:#222;font:13px/1.52 Arial,Helvetica,sans-serif;box-sizing:border-box}',
    '.akiva-faith-sidebar *{box-sizing:border-box}',
    '.akiva-faith-sidebar h2{font:normal 27px/1.17 Georgia,serif;margin:9px 0 13px;color:#17372d}',
    '.akiva-faith-sidebar .akiva-faith-eyebrow{font:700 10px/1.5 Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#6f2e2b}',
    '.akiva-faith-sidebar .akiva-faith-intro{font-size:13px;color:#655d52;margin:0 0 17px}',
    '.akiva-faith-book-group{border-top:1px solid #ddd4c3;margin:17px 0 0;padding:13px 0 0}',
    '.akiva-faith-book-group h3{font:700 15px/1.25 Georgia,serif;margin:0 0 12px;color:#17372d}',
    '.akiva-faith-book{display:grid;grid-template-columns:72px minmax(0,1fr);gap:11px;align-items:start;margin:0 0 15px}',
    '.akiva-faith-book img{display:block;width:72px;height:105px;object-fit:contain;background:#ede4d5;border:1px solid #ded4c5}',
    '.akiva-faith-book strong{display:block;font:700 12px/1.4 Arial,sans-serif;color:#20231d}',
    '.akiva-faith-book small{display:block;color:#625e57;font:11px/1.4 Arial,sans-serif;margin:3px 0 6px}',
    '.akiva-faith-sidebar a{color:#6f2e2b;text-decoration:none;overflow-wrap:anywhere}',
    '.akiva-faith-book div a{display:block;font:700 11px/1.55 Arial,sans-serif;margin-top:4px}',
    '.akiva-faith-sidebar a:hover{text-decoration:underline}',
    '.akiva-faith-secondary{font:700 11px/1.45 Arial,sans-serif}',
    '.akiva-faith-collection{padding:14px;background:#f2eadd;margin:18px 0 0}',
    '.akiva-faith-collection a{display:block;font-weight:700;margin:7px 0}',
    '@media(max-width:850px){.akiva-faith-layout{grid-template-columns:minmax(0,1fr) 240px;gap:20px}.akiva-faith-book{grid-template-columns:60px minmax(0,1fr)}.akiva-faith-book img{width:60px;height:88px}}',
    '@media(max-width:730px){.akiva-faith-layout{display:block}.akiva-faith-sidebar{position:static;max-height:none;overflow:visible;margin:34px auto 0;max-width:540px}.akiva-faith-book{grid-template-columns:72px minmax(0,1fr)}.akiva-faith-book img{width:72px;height:105px}}',
    '@media print{.akiva-faith-layout{display:block;width:100%;margin:0}.akiva-faith-sidebar{display:none!important}}'
  ].join("\n");

  html = html.replace(opening[0], '<div class="akiva-faith-layout">' + opening[0]);
  html = html.replace(/<\/main>/i, '</main>' + sidebar + '</div>');
  html = html.replace(/<\/head>/i, '<style id="akiva-faith-style">' + css + '</style></head>');
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
};

export const config: Config = {
  path: ["/library/blog/faith-in-the-night/", "/library/blog/faith-in-the-night/index.html"]
};