import fs from 'node:fs';

const path = 'dist/index.html';
let html = fs.readFileSync(path, 'utf8');

const livyasanReplacement = `
    <div class="livy-showcase" aria-label="The Livyasan and Shavuos published cover and actual sample page">
      <button class="livy-cover-main zoom" data-img="livyasan-cover.jpg" data-label="The Livyasan and Shavuos · published front cover" aria-label="Enlarge The Livyasan and Shavuos front cover">
        <img src="livyasan-cover.jpg" alt="Published front cover of The Livyasan and Shavuos">
      </button>
      <button class="livy-page-mini zoom" data-img="livyasan-sample-interlinear.png" data-label="The Livyasan and Shavuos · actual sample page" aria-label="Enlarge Livyasan and Shavuos sample page">
        <img src="livyasan-sample-interlinear.png" alt="Actual sample page from The Livyasan and Shavuos">
        <span>Actual sample</span>
      </button>
    </div>`;

html = html.replace(/<button class="livy-card zoom"[\s\S]*?<\/button>/, livyasanReplacement);

const polish = `
<style id="akiva-pages-polish">
  .livy-showcase{position:relative;min-height:640px;width:min(560px,100%);justify-self:end;display:grid;place-items:center}
  .livy-cover-main,.livy-page-mini{border:0;padding:0;cursor:zoom-in;background:transparent}
  .livy-cover-main{width:min(390px,72%);position:relative;z-index:2;box-shadow:0 34px 72px rgba(0,0,0,.33);transform:rotate(-1.2deg);transition:transform .24s ease}
  .livy-cover-main:hover{transform:rotate(0) translateY(-6px) scale(1.025)}
  .livy-cover-main img{width:100%;height:auto;border:1px solid rgba(255,255,255,.25)}
  .livy-page-mini{position:absolute;right:0;bottom:22px;width:38%;z-index:3;padding:6px;background:#fff;box-shadow:0 22px 48px rgba(0,0,0,.29);transform:rotate(2.4deg);transition:transform .24s ease}
  .livy-page-mini:hover{transform:rotate(0) translateY(-7px) scale(1.035)}
  .livy-page-mini img{width:100%;height:auto}
  .livy-page-mini span{display:block;color:#605b52;background:#f6f1e8;padding:8px 9px;text-align:left;font:700 .66rem/1.2 var(--sans);letter-spacing:.08em;text-transform:uppercase}

  .fake-cover{width:min(400px,78%);aspect-ratio:7/10;color:#18382e;background:linear-gradient(rgba(249,244,234,.965),rgba(232,219,196,.965)),url('dover-volume-i-art.png') center/cover no-repeat;border:1px solid #6e5a39;box-shadow:0 34px 76px rgba(28,27,23,.3);padding:48px 38px 40px;text-shadow:none;isolation:isolate;overflow:hidden}
  .fake-cover:before{inset:14px;border:1px solid #b28b55;box-shadow:inset 0 0 0 5px rgba(178,139,85,.08)}
  .fake-cover:after{content:"";position:absolute;inset:27px;border:1px solid rgba(111,46,43,.28);pointer-events:none;z-index:-1}
  .fake-cover .pub{font-size:.67rem;letter-spacing:.18em;color:#6f2e2b;opacity:.9}
  .fake-cover .heb{font-size:3.05rem;line-height:1;color:#17372d;margin:0 0 18px}
  .fake-cover h3{position:relative;font-family:Georgia,"Times New Roman",serif;font-size:3.65rem;line-height:.84;font-weight:400;letter-spacing:-.055em;color:#17372d;margin:0 0 20px}
  .fake-cover h3:before,.fake-cover h3:after{content:"";display:block;width:58px;height:1px;background:#b28b55;margin:0 auto 18px}
  .fake-cover h3:after{margin:18px auto 0}
  .fake-cover .sub{max-width:240px;margin:0 auto;color:#665a48;font-size:.72rem;line-height:1.5;letter-spacing:.08em;text-transform:uppercase}
  .dover-stage .real-page{right:-4px;bottom:2px;width:39%;border-width:7px;box-shadow:0 24px 52px rgba(31,30,26,.24)}
  .dover-copy .coming{background:#6f2e2b}

  @media(max-width:850px){.livy-showcase{justify-self:center;min-height:590px}.livy-cover-main{width:min(390px,70%)}.livy-page-mini{right:5%}}
  @media(max-width:560px){.livy-showcase{min-height:500px}.livy-cover-main{width:72%}.livy-page-mini{width:42%;right:0}.fake-cover{width:82%;padding:40px 28px 34px}.fake-cover h3{font-size:3rem}.fake-cover .heb{font-size:2.55rem}}
</style>`;

if (!html.includes('id="akiva-pages-polish"')) {
  html = html.replace('</head>', `${polish}</head>`);
}

fs.writeFileSync(path, html);
console.log('Prepared static GitHub Pages build.');
