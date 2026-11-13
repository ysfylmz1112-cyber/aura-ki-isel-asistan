const fs = require("fs/promises");
const path = require("path");

function safeFolderName(value) {
  const cleaned = String(value || "LAVIN-Demo")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return cleaned || "LAVIN-Demo";
}

function makeSiteFiles() {
  const html = [
    "<!doctype html>",
    '<html lang="tr">',
    "<head>",
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    '  <meta name="theme-color" content="#171713">',
    '  <meta name="description" content="LAVİN restoran web sitesi tasarım demosu. İşletme bilgileri yayına alınmadan önce doğrulanmalıdır.">',
    "  <title>LAVİN | Mevsimden İlham Alan Mutfak</title>",
    '  <link rel="preconnect" href="https://fonts.googleapis.com">',
    '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@500;600;700&display=swap" rel="stylesheet">',
    '  <link rel="stylesheet" href="styles.css">',
    '  <script src="script.js" defer></script>',
    "</head>",
    "<body>",
    '  <div class="demo-bar"><span>PORTFÖY DEMOSU</span> Bu tasarım örnektir. Menü ve işletme bilgileri doğrulanmadan yayınlanmamalıdır.</div>',
    '  <header class="site-header" id="top">',
    '    <a class="brand" href="#top" aria-label="LAVİN ana sayfa"><span class="brand-mark">L</span><span>LAVİN<small>SEASONAL KITCHEN</small></span></a>',
    '    <button class="menu-toggle" type="button" aria-label="Menüyü aç" aria-expanded="false">☰</button>',
    '    <nav class="main-nav" aria-label="Ana menü"><a href="#hikaye">Hikâyemiz</a><a href="#menu">Menü</a><a href="#atmosfer">Atmosfer</a><a href="#rezervasyon">Rezervasyon</a></nav>',
    '    <a class="header-cta" href="#rezervasyon">Masa iste <span>↗</span></a>',
    "  </header>",
    '  <main>',
    '    <section class="hero">',
    '      <div class="hero-copy"><p class="eyebrow"><span></span> MEVSİMDEN İLHAM ALAN MUTFAK</p><h1>Her mevsimin<br><em>kendine has</em><br>bir hikâyesi var.</h1><p class="hero-text">Özenle hazırlanan tabaklar, sakin bir atmosfer ve paylaşmaya değer anlar. LAVİN, sofranın etrafında güzel hikâyeler biriktirmek için tasarlanmış bir restoran konseptidir.</p><div class="hero-actions"><a class="button button-dark" href="#menu">Menüyü keşfet <span>↗</span></a><a class="text-link" href="#hikaye">LAVİN hikâyesi <span>↓</span></a></div><div class="hero-note"><b>01 / 03</b><span>İyi yemek, iyi hissettirir.</span></div></div>',
    '      <div class="hero-art" aria-label="Dekoratif yemek ve bitki illüstrasyonu"><div class="art-orbit orbit-one"></div><div class="art-orbit orbit-two"></div><div class="sun-disc"></div><div class="plate"><div class="plate-inner"><div class="food food-one"></div><div class="food food-two"></div><div class="food food-three"></div><div class="herb herb-one"></div><div class="herb herb-two"></div></div></div><span class="art-label label-top">FRESH · SIMPLE · LOCAL</span><span class="art-label label-side">TASTE THE SEASON</span><span class="art-stamp">L<br><small>EST. DEMO</small></span></div>',
    '      <div class="hero-bottom"><span>İYİ MALZEME · ÖZENLİ DOKUNUŞ</span><span>SCROLL TO EXPLORE ↓</span></div>',
    "    </section>",
    '    <section class="intro section-wrap" id="hikaye"><div class="section-kicker">01 — LAVİN HİKÂYESİ</div><div class="intro-grid"><h2>Lezzetin en güzel hâli,<br><em>fazlalıklardan arınmış</em><br>olanıdır.</h2><div class="intro-copy"><p>LAVİN, mevsiminde bulunan malzemeleri sade dokunuşlarla öne çıkaran örnek bir restoran markasıdır. Her detay, misafirlerin kendilerine zaman ayırdığı sıcak ve samimi bir deneyim etrafında düşünülmüştür.</p><a class="under-link" href="#atmosfer">Yaklaşımımızı keşfet <span>↗</span></a></div></div></section>',
    '    <section class="menu-section" id="menu"><div class="section-wrap"><div class="menu-heading"><div><div class="section-kicker">02 — ÖRNEK MENÜ</div><h2>Mevsimin <em>masaya gelen</em><br>hâli.</h2></div><p class="menu-disclaimer">Bu bölüm tasarım demosu için hazırlanmıştır. Ürünler, içerikler ve fiyatlar işletme tarafından onaylanmalıdır.</p></div><div class="menu-tabs" role="group" aria-label="Menü kategorisi"><button class="menu-tab active" data-filter="all" type="button">Tümü</button><button class="menu-tab" data-filter="starter" type="button">Başlangıç</button><button class="menu-tab" data-filter="main" type="button">Ana tabak</button><button class="menu-tab" data-filter="dessert" type="button">Tatlı</button></div>',
    '      <div class="menu-grid">',
    '        <article class="menu-card" data-category="starter"><div class="dish-art dish-a"><span>01</span><i></i></div><div class="dish-meta"><div><small>BAŞLANGIÇ · DEMO</small><h3>Mevsim tabağı</h3></div><b>Fiyat eklenecek</b></div><p>İşletmenin gerçek reçete ve içerikleriyle güncellenecek örnek sunum.</p></article>',
    '        <article class="menu-card" data-category="main"><div class="dish-art dish-b"><span>02</span><i></i></div><div class="dish-meta"><div><small>ANA TABAK · DEMO</small><h3>Günün tabağı</h3></div><b>Fiyat eklenecek</b></div><p>Mevsimsel ürünlere göre değişebilen örnek ana yemek alanı.</p></article>',
    '        <article class="menu-card" data-category="dessert"><div class="dish-art dish-c"><span>03</span><i></i></div><div class="dish-meta"><div><small>TATLI · DEMO</small><h3>Günün tatlısı</h3></div><b>Fiyat eklenecek</b></div><p>Gerçek tatlı adı, alerjen bilgisi ve fiyatı işletme tarafından eklenir.</p></article>',
    "      </div></div></section>",
    '    <section class="experience section-wrap" id="atmosfer"><div class="experience-art"><div class="window-shape"></div><div class="table-shape"></div><div class="vase-shape"></div><span>AN INVITATION TO SLOW DOWN</span></div><div class="experience-copy"><div class="section-kicker">03 — ATMOSFER</div><h2>Biraz yavaşla.<br><em>Sofranın tadını çıkar.</em></h2><p>Günün telaşına küçük bir ara. Sevdiklerinle buluşmak, yeni tatlar keşfetmek ve güzel bir akşam geçirmek için tasarlanmış örnek bir atmosfer anlatımı.</p><div class="experience-points"><span><b>01</b> Sade ve sıcak detaylar</span><span><b>02</b> Paylaşmaya açık sofralar</span><span><b>03</b> Mevsime göre yenilenen menü</span></div></div></section>',
    '    <section class="reservation" id="rezervasyon"><div class="reservation-inner"><div class="section-kicker">04 — BİZE ULAŞIN</div><h2>Güzel bir masa,<br><em>güzel bir başlangıç.</em></h2><p>Bu demo formu rezervasyon göndermez. Canlı kullanım öncesinde işletmenin tercih ettiği rezervasyon sistemiyle bağlantı kurulmalıdır.</p><form class="reservation-form" id="reservationForm"><label>Adınız<input name="name" type="text" placeholder="Adınız" required></label><label>E-posta<input name="email" type="email" placeholder="ornek@eposta.com" required></label><label>Notunuz<textarea name="note" rows="3" placeholder="Tercih ettiğiniz gün ve saat"></textarea></label><button class="button button-light" type="submit">Demo formunu dene <span>↗</span></button><output class="form-message" id="formMessage" aria-live="polite"></output></form><div class="contact-placeholder">Adres, telefon ve çalışma saatleri işletme tarafından doğrulanınca eklenecek.</div></div></section>',
    "  </main>",
    '  <footer class="site-footer"><a class="brand footer-brand" href="#top"><span class="brand-mark">L</span><span>LAVİN<small>SEASONAL KITCHEN</small></span></a><span>© <span id="year"></span> LAVİN — TASARIM DEMOSU</span><a href="#top">Başa dön ↑</a></footer>',
    "</body>",
    "</html>"
  ].join("\n");

  const css = [
    "@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,500;0,600;0,700;1,500;1,600&display=swap');",
    ":root{--ink:#202019;--paper:#f3f0e8;--cream:#e8e2d3;--olive:#777a54;--orange:#c26d43;--line:rgba(32,32,25,.18);--muted:#77766d;--serif:'Playfair Display',Georgia,serif;--sans:'DM Sans',Arial,sans-serif}",
    "*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:14px}a{color:inherit;text-decoration:none}button,input,textarea{font:inherit}.demo-bar{background:#24251e;color:#e9e4d8;text-align:center;padding:9px 16px;font-size:10px;letter-spacing:.04em}.demo-bar span{color:#e4a77d;font-weight:700;margin-right:8px;letter-spacing:.16em}.site-header{height:88px;padding:0 7vw;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);background:var(--paper);position:relative;z-index:20}.brand{display:flex;gap:11px;align-items:center;font-family:var(--serif);font-size:21px;letter-spacing:.08em;font-weight:700}.brand small{display:block;font:600 8px var(--sans);letter-spacing:.22em;color:var(--muted);margin-top:3px}.brand-mark{width:38px;height:38px;border:1px solid var(--olive);border-radius:50%;display:grid;place-items:center;color:var(--olive);font:italic 24px var(--serif)}.main-nav{display:flex;gap:34px}.main-nav a,.header-cta{font-size:11px;font-weight:600;letter-spacing:.04em}.main-nav a{color:#66665c}.main-nav a:hover,.text-link:hover,.under-link:hover{color:var(--orange)}.header-cta{border-bottom:1px solid var(--ink);padding:9px 0}.header-cta span{margin-left:18px}.menu-toggle{display:none;border:0;background:none;font-size:23px;color:var(--ink)}.hero{min-height:650px;padding:78px 10vw 52px;position:relative;display:grid;grid-template-columns:1fr 1fr;gap:5vw;align-items:center;overflow:hidden}.hero-copy{position:relative;z-index:2;max-width:550px}.eyebrow,.section-kicker{font-size:9px;letter-spacing:.2em;font-weight:700;color:var(--olive)}.eyebrow{display:flex;align-items:center;gap:10px}.eyebrow span{width:28px;height:1px;background:var(--orange)}h1,h2,h3,p{margin-top:0}h1,h2{font-family:var(--serif);font-weight:500;letter-spacing:-.04em}h1{font-size:clamp(46px,6vw,82px);line-height:1.04;margin:30px 0 24px}h1 em,h2 em{color:var(--olive);font-weight:500}.hero-text,.intro-copy p,.experience-copy p{max-width:430px;color:#77766d;line-height:1.9;font-size:13px}.hero-actions{display:flex;align-items:center;gap:28px;margin-top:33px}.button{display:inline-flex;align-items:center;justify-content:space-between;gap:28px;padding:15px 20px;border:0;font-weight:700;font-size:10px;letter-spacing:.04em;cursor:pointer;transition:transform .2s,background .2s}.button:hover{transform:translateY(-2px)}.button-dark{background:var(--ink);color:var(--paper)}.button-dark:hover{background:var(--olive)}.text-link,.under-link{font-size:10px;font-weight:700;border-bottom:1px solid var(--line);padding-bottom:7px}.text-link span,.under-link span{margin-left:12px}.hero-note{display:flex;gap:16px;align-items:center;margin-top:72px;color:#929084;font-size:9px;letter-spacing:.08em}.hero-note b{color:var(--orange)}.hero-art{height:490px;position:relative;display:grid;place-items:center}.sun-disc{position:absolute;width:300px;height:300px;border-radius:50%;background:#d9c8a9;right:8%;top:5%;opacity:.7}.plate{position:absolute;width:min(34vw,390px);height:min(34vw,390px);min-width:280px;min-height:280px;border-radius:50%;background:linear-gradient(145deg,#fffdf7,#d9d2c4);box-shadow:22px 26px 45px #6c63422b,inset 0 0 0 13px #fff9,inset 0 0 0 17px #c8c0ae;display:grid;place-items:center;transform:rotate(-13deg)}.plate-inner{width:76%;height:76%;border-radius:50%;border:1px solid #c9bda7;position:relative;background:radial-gradient(circle at 52% 48%,#d6c98d 0 20%,#777f4c 21% 27%,#e5d6aa 28% 47%,#9c6644 48% 52%,#e8d8b2 53% 100%);overflow:hidden}.food{position:absolute;border-radius:50%;filter:drop-shadow(2px 4px 2px #29271944)}.food-one{width:35%;height:24%;background:#bd7148;left:19%;top:23%;transform:rotate(35deg)}.food-two{width:28%;height:38%;background:#e4b75f;right:18%;top:35%;transform:rotate(-24deg)}.food-three{width:22%;height:20%;background:#74814c;left:42%;bottom:15%}.herb{position:absolute;width:30%;height:3px;background:#394b2c;transform:rotate(44deg);left:36%;top:32%;border-radius:50%}.herb-two{transform:rotate(-38deg);top:63%;left:30%}.art-orbit{position:absolute;border:1px solid #9a966e55;border-radius:50%;transform:rotate(-27deg)}.orbit-one{width:470px;height:200px}.orbit-two{width:520px;height:260px;transform:rotate(45deg)}.art-label{position:absolute;font-size:8px;letter-spacing:.2em;color:var(--olive)}.label-top{top:34px;right:7%}.label-side{bottom:68px;left:3%;writing-mode:vertical-rl}.art-stamp{position:absolute;right:3%;bottom:14%;width:70px;height:70px;border:1px solid var(--orange);border-radius:50%;display:grid;place-items:center;text-align:center;color:var(--orange);font:italic 28px var(--serif);transform:rotate(12deg)}.art-stamp small{font:700 6px var(--sans);letter-spacing:.15em}.hero-bottom{position:absolute;bottom:20px;left:10vw;right:10vw;display:flex;justify-content:space-between;color:#99968a;font-size:8px;letter-spacing:.16em}.section-wrap{padding:100px 10vw}.intro-grid{display:grid;grid-template-columns:1.2fr .8fr;gap:7vw;margin-top:35px;align-items:end}.intro h2,.menu-heading h2,.experience h2,.reservation h2{font-size:clamp(36px,4.2vw,58px);line-height:1.15;margin-bottom:0}.intro-copy{padding-bottom:8px}.under-link{display:inline-block;margin-top:18px}.menu-section{background:#e6e1d5;padding:100px 0}.menu-heading{display:flex;justify-content:space-between;align-items:end;gap:30px}.menu-disclaimer{max-width:275px;font-size:10px;line-height:1.8;color:#77766d}.menu-tabs{display:flex;gap:9px;margin:42px 0 25px;flex-wrap:wrap}.menu-tab{border:1px solid #c7c1b3;background:transparent;color:#6e6c61;padding:9px 16px;border-radius:30px;font-size:9px;cursor:pointer}.menu-tab.active,.menu-tab:hover{background:var(--ink);color:var(--paper);border-color:var(--ink)}.menu-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}.menu-card{background:#f4f1e9;padding:12px 12px 20px;transition:transform .25s}.menu-card:hover{transform:translateY(-5px)}.menu-card[hidden]{display:none}.dish-art{height:220px;position:relative;display:grid;place-items:center;overflow:hidden}.dish-art span{position:absolute;top:13px;left:14px;font:italic 16px var(--serif);color:#fff}.dish-art i{width:138px;height:138px;border-radius:50%;background:radial-gradient(circle,#d8c993 0 20%,#7c8352 21% 28%,#f0e7cb 29% 52%,#b76f4a 53% 59%,#eee4ca 60%);box-shadow:0 15px 25px #25221735;border:8px solid #fff9}.dish-a{background:#858866}.dish-b{background:#b47856}.dish-c{background:#98907c}.dish-a i{transform:rotate(17deg)}.dish-b i{transform:rotate(-12deg);background:radial-gradient(circle,#c5a46e 0 20%,#72784f 21% 28%,#ead8b3 29% 52%,#b56d4f 53% 59%,#f1e5c9 60%)}.dish-c i{width:125px;height:125px;background:radial-gradient(circle,#f1d9a7 0 26%,#a36b50 27% 34%,#f1e6cf 35% 59%,#fff 60%)}.dish-meta{display:flex;justify-content:space-between;gap:10px;align-items:end;margin-top:18px}.dish-meta small{font-size:7px;letter-spacing:.16em;color:var(--olive)}.dish-meta h3{font:500 23px var(--serif);margin:6px 0 0}.dish-meta b{font-size:8px;color:var(--orange);white-space:nowrap}.menu-card p{font-size:9px;color:#827f73;line-height:1.7;margin:12px 0 0}.experience{display:grid;grid-template-columns:1fr 1fr;gap:8vw;align-items:center}.experience-art{height:470px;background:#777b5b;position:relative;overflow:hidden}.experience-art:before{content:'';position:absolute;left:12%;top:9%;width:76%;height:62%;border:13px solid #ddd4bd;background:linear-gradient(130deg,#e2c99f,#b1a27b 48%,#7b8060);box-shadow:0 20px 35px #1c201c55}.window-shape{position:absolute;left:45%;top:10%;height:60%;width:8px;background:#e9dfca;z-index:1}.table-shape{position:absolute;bottom:12%;left:9%;width:84%;height:22%;background:#4b4031;border-radius:50% 50% 4px 4px;transform:perspective(200px) rotateX(8deg)}.vase-shape{position:absolute;bottom:28%;left:45%;width:45px;height:82px;background:#d1b98c;border-radius:10px 10px 22px 22px;z-index:2}.experience-art>span{position:absolute;bottom:18px;left:20px;color:#f4eedf;font-size:8px;letter-spacing:.18em}.experience-copy h2{margin:28px 0}.experience-points{display:grid;gap:15px;margin-top:33px}.experience-points span{border-bottom:1px solid var(--line);padding-bottom:12px;font-size:10px;color:#6d6b60}.experience-points b{color:var(--orange);margin-right:17px}.reservation{background:#26271f;color:var(--paper);padding:100px 20px;text-align:center}.reservation .section-kicker{color:#c7a17d}.reservation h2{margin:25px 0 17px}.reservation h2 em{color:#c8b48a}.reservation-inner>p{max-width:460px;margin:0 auto;color:#aaa99d;font-size:10px;line-height:1.8}.reservation-form{max-width:510px;margin:35px auto 0;text-align:left;display:grid;gap:13px}.reservation-form label{display:grid;gap:7px;color:#c9c6b8;font-size:9px;letter-spacing:.08em}.reservation-form input,.reservation-form textarea{width:100%;border:1px solid #505044;background:#303127;color:#fff;padding:12px;outline:none;border-radius:0;font-size:11px}.reservation-form input:focus,.reservation-form textarea:focus{border-color:#c7a17d}.reservation-form input::placeholder,.reservation-form textarea::placeholder{color:#89897e}.button-light{background:#e4d5b8;color:#28271f;justify-self:center;margin-top:8px}.form-message{min-height:18px;text-align:center;font-size:10px;color:#e8c79e}.contact-placeholder{margin-top:35px;font-size:9px;color:#858579}.site-footer{min-height:100px;padding:24px 8vw;display:flex;justify-content:space-between;align-items:center;gap:20px}.footer-brand{font-size:16px}.footer-brand .brand-mark{width:30px;height:30px;font-size:19px}.site-footer>span,.site-footer>a:last-child{font-size:8px;color:#858276;letter-spacing:.1em}.site-footer>a:last-child{border-bottom:1px solid var(--line);padding-bottom:6px}",
    "@media(max-width:900px){.site-header{padding:0 5vw}.hero{padding:65px 7vw 60px;gap:2vw}.hero-art{height:390px}.sun-disc{width:235px;height:235px}.plate{width:290px;height:290px}.orbit-one{width:370px}.orbit-two{width:400px}.section-wrap{padding:78px 7vw}.menu-section{padding:78px 0}.experience-art{height:390px}}",
    "@media(max-width:650px){.demo-bar{font-size:8px;line-height:1.5}.site-header{height:70px}.brand{font-size:18px}.brand-mark{width:33px;height:33px}.menu-toggle{display:block;margin-left:auto;margin-right:14px}.header-cta{font-size:9px}.main-nav{display:none;position:absolute;top:69px;left:0;right:0;padding:20px 7vw;background:var(--paper);border-bottom:1px solid var(--line);flex-direction:column;gap:18px}.main-nav.open{display:flex}.hero{display:flex;flex-direction:column;align-items:stretch;padding:60px 7vw 60px;gap:10px}.hero-copy{max-width:none}.hero h1{font-size:54px}.hero-note{margin-top:38px}.hero-art{height:340px;margin-top:6px}.plate{width:270px;height:270px;min-width:0;min-height:0}.sun-disc{width:220px;height:220px;right:9%;top:0}.orbit-one{width:340px;height:170px}.orbit-two{width:350px;height:210px}.label-top{right:0}.hero-bottom{left:7vw;right:7vw;font-size:7px}.section-wrap{padding:68px 7vw}.intro-grid,.experience{grid-template-columns:1fr;gap:25px}.intro h2,.menu-heading h2,.experience h2,.reservation h2{font-size:40px}.menu-section{padding:68px 0}.menu-heading{display:block}.menu-disclaimer{margin-top:20px}.menu-grid{grid-template-columns:1fr;gap:15px}.dish-art{height:200px}.experience-art{height:320px;order:2}.experience-copy{order:1}.reservation{padding:72px 7vw}.site-footer{padding:25px 7vw;flex-wrap:wrap}.site-footer>span{order:3;width:100%}}",
    "@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*,*::before,*::after{transition:none!important;animation:none!important}}"
  ].join("\n");

  const script = [
    "const menuToggle = document.querySelector(\".menu-toggle\");",
    "const mainNav = document.querySelector(\".main-nav\");",
    "if (menuToggle && mainNav) {",
    "  menuToggle.addEventListener(\"click\", () => {",
    "    const open = mainNav.classList.toggle(\"open\");",
    "    menuToggle.setAttribute(\"aria-expanded\", String(open));",
    "    menuToggle.setAttribute(\"aria-label\", open ? \"Menüyü kapat\" : \"Menüyü aç\");",
    "  });",
    "  mainNav.querySelectorAll(\"a\").forEach((link) => link.addEventListener(\"click\", () => {",
    "    mainNav.classList.remove(\"open\");",
    "    menuToggle.setAttribute(\"aria-expanded\", \"false\");",
    "  }));",
    "}",
    "document.querySelectorAll(\".menu-tab\").forEach((button) => {",
    "  button.addEventListener(\"click\", () => {",
    "    document.querySelectorAll(\".menu-tab\").forEach((item) => item.classList.remove(\"active\"));",
    "    button.classList.add(\"active\");",
    "    const filter = button.dataset.filter;",
    "    document.querySelectorAll(\".menu-card\").forEach((card) => {",
    "      card.hidden = filter !== \"all\" && card.dataset.category !== filter;",
    "    });",
    "  });",
    "});",
    "const form = document.querySelector(\"#reservationForm\");",
    "const message = document.querySelector(\"#formMessage\");",
    "if (form && message) {",
    "  form.addEventListener(\"submit\", (event) => {",
    "    event.preventDefault();",
    "    message.textContent = \"Bu bir demo formudur; rezervasyon gönderilmedi. Canlı sistem işletme tarafından bağlanmalıdır.\";",
    "  });",
    "}",
    "const year = document.querySelector(\"#year\");",
    "if (year) year.textContent = String(new Date().getFullYear());"
  ].join("\n");

  const readme = [
    "LAVİN — WEB SİTESİ TASARIM DEMOSU",
    "",
    "Bu klasör örnek portföy çalışmasıdır; gerçek bir işletmenin onaylanmış web sitesi değildir.",
    "",
    "DOSYALAR",
    "- index.html: Sayfa yapısı",
    "- styles.css: Görsel tasarım ve mobil uyum",
    "- script.js: Menü filtreleri, mobil gezinme ve demo form etkileşimi",
    "- TEKLIF-TASLAGI.txt: İşletme bilgileri doğrulandıktan sonra düzenlenecek teklif",
    "",
    "KULLANIM",
    "index.html dosyasını tarayıcıda açın.",
    "",
    "YAYIN ÖNCESİ",
    "- İşletme adı ve marka kullanım izni doğrulanmalı.",
    "- Menü, ürün açıklamaları, fiyatlar ve alerjen bilgileri işletmeden alınmalı.",
    "- Adres, telefon, çalışma saatleri ve görseller işletme tarafından sağlanmalı.",
    "- Rezervasyon formu gerçek bir hizmete bağlanmalı veya kaldırılmalı.",
    "- Gizlilik, çerez ve iletişim metinleri gereken duruma göre eklenmeli.",
    "- Alan adı ve barındırma hesabı işletme sahibinin/velinin kontrolünde olmalı.",
    "",
    "Demo dış servislere veya ücretli API'lere bağlı değildir. Google Fonts bağlantısı internet bağlantısı varsa yazı tiplerini yükler; çevrimdışı durumda sistem yazı tipleri kullanılır."
  ].join("\n");

  const offer = [
    "LAVİN — WEB SİTESİ TEKLİF TASLAĞI",
    "",
    "Merhaba,",
    "",
    "İşletmeniz için mobil uyumlu, sade ve modern bir web sitesi tasarım demosu hazırladım. Demo; işletme hikâyesi, menü sunumu, atmosfer bölümü ve iletişim/rezervasyon alanı içerir.",
    "",
    "TESLİM KAPSAMI",
    "- Mobil ve masaüstü uyumlu tek sayfalık web sitesi",
    "- Menü kategorisi filtreleme ve mobil gezinme",
    "- İşletmenin doğrulayacağı metin ve görsel alanları",
    "- Rezervasyon/iletişim bağlantısının kurulmasına uygun tasarım",
    "",
    "İŞLETME TARAFINDAN GEREKENLER",
    "- Onaylı logo ve marka kullanımı",
    "- Gerçek menü, fiyatlar, alerjen bilgileri ve fotoğraflar",
    "- Adres, telefon, çalışma saatleri ve sosyal medya bağlantıları",
    "- Rezervasyon için tercih edilen yöntem",
    "",
    "ÜCRET VE TESLİM TARİHİ: İhtiyaçlar netleştirildikten sonra ayrıca belirlenir.",
    "",
    "Not: Bu dosya gönderilmeye hazır kesin bir teklif değildir. İşletme bilgileri, kapsam, ücret ve teslim tarihi doğrulanıp veli desteğiyle gözden geçirildikten sonra kullanılmalıdır."
  ].join("\n");

  return {
    "index.html": html,
    "styles.css": css,
    "script.js": script,
    "README.txt": readme,
    "TEKLIF-TASLAGI.txt": offer
  };
}

module.exports = async function createIncomeWebsiteDemo(options = {}) {
  const desktopRoot = path.resolve(String(options.desktopRoot || ""));
  const isAllowedPath = options.isAllowedPath;
  const confirmAction = options.confirmAction;
  if (!desktopRoot || typeof isAllowedPath !== "function" || typeof confirmAction !== "function") {
    throw new Error("Kazanç modu için masaüstü klasörü ve izin denetimi hazır değil.");
  }

  const folderName = safeFolderName(options.folderName || "LAVIN-Demo");
  const baseDir = path.join(desktopRoot, "AURA-Gelir");
  let targetDir = path.join(baseDir, folderName);
  let suffix = 2;
  while (true) {
    try {
      await fs.access(targetDir);
      targetDir = path.join(baseDir, folderName + "-" + suffix);
      suffix += 1;
    } catch {
      break;
    }
    if (suffix > 50) throw new Error("Yeni demo klasörü için uygun ad bulunamadı.");
  }

  if (!isAllowedPath(targetDir)) throw new Error("Demo klasörü AURA'nın izin verilen çalışma alanında değil.");

  const approved = await confirmAction(
    "AURA — Kazanç Modu",
    "LAVİN web sitesi demo dosyaları şu klasöre oluşturulacak:\n\n" + targetDir + "\n\nVar olan dosyalar silinmeyecek. Devam edilsin mi?"
  );
  if (!approved) throw new Error("Demo oluşturma işlemi iptal edildi.");

  const files = makeSiteFiles();
  await fs.mkdir(targetDir, { recursive: true });
  const written = [];
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(targetDir, name);
    await fs.writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
    const stat = await fs.stat(filePath);
    written.push({ name, bytes: stat.size });
  }

  const html = await fs.readFile(path.join(targetDir, "index.html"), "utf8");
  const css = await fs.readFile(path.join(targetDir, "styles.css"), "utf8");
  const js = await fs.readFile(path.join(targetDir, "script.js"), "utf8");
  new Function(js);

  return {
    ok: true,
    folder: targetDir,
    files: written,
    checks: {
      htmlExists: html.includes("<!doctype html>") && html.includes('lang="tr"'),
      cssLinked: html.includes('href="styles.css"') && css.length > 1000,
      jsLinked: html.includes('src="script.js"') && js.length > 100,
      javascriptSyntax: true,
      demoWarningsIncluded: html.includes("PORTFÖY DEMOSU") && html.includes("rezervasyon gönderilmedi")
    },
    message: "LAVİN web sitesi demo dosyaları oluşturuldu. Site yayınlanmadı ve hiçbir müşteriye mesaj gönderilmedi."
  };
};
