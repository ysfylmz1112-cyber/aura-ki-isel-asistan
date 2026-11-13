'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

function clean(value, fallback, max = 180) {
  const text = String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  return (text || fallback).slice(0, max);
}

function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function slugify(value) {
  return String(value || 'kampanya')
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'kampanya';
}

function wrapWords(value, maxChars, maxLines = 4) {
  const words = String(value || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? line + ' ' + word : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

function svgLines(value, x, y, maxChars, fontSize, lineHeight, fill, weight, maxLines = 4) {
  return wrapWords(value, maxChars, maxLines).map((line, index) =>
    '<text x="' + x + '" y="' + (y + index * lineHeight) + '" fill="' + fill +
    '" font-family="Arial, sans-serif" font-size="' + fontSize +
    '" font-weight="' + weight + '">' + escapeXml(line) + '</text>'
  ).join('');
}

function makeSocialSvg(item, width, height, isStory) {
  const top = isStory ? 250 : 180;
  const headlineSize = isStory ? 76 : 68;
  const bodySize = isStory ? 32 : 28;
  const title = svgLines(item.headline, 86, top + 150, isStory ? 19 : 22, headlineSize, headlineSize * 1.18, '#F5FAFF', 800, 4);
  const support = svgLines(item.supportingText, 88, top + 150 + headlineSize * 1.18 * 4 + 42, isStory ? 36 : 42, bodySize, bodySize * 1.45, '#B9C9D8', 400, 4);
  const ctaY = isStory ? 1450 : 1110;
  const ctaLines = svgLines(item.callToAction, 125, ctaY + 57, isStory ? 25 : 28, 31, 40, '#06111A', 800, 2);
  const brand = escapeXml(item.businessName.toUpperCase());
  const category = escapeXml(item.businessType.toUpperCase());
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">',
    '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#07101D"/><stop offset=".55" stop-color="#102B42"/><stop offset="1" stop-color="#07111B"/></linearGradient><radialGradient id="glow"><stop stop-color="#42D9F5" stop-opacity=".36"/><stop offset="1" stop-color="#42D9F5" stop-opacity="0"/></radialGradient></defs>',
    '<rect width="100%" height="100%" fill="url(#bg)"/>',
    '<circle cx="' + (isStory ? 850 : 890) + '" cy="' + (isStory ? 390 : 300) + '" r="430" fill="url(#glow)"/>',
    '<circle cx="' + (isStory ? 870 : 870) + '" cy="' + (isStory ? 540 : 420) + '" r="230" fill="none" stroke="#42D9F5" stroke-opacity=".22" stroke-width="2"/>',
    '<circle cx="' + (isStory ? 870 : 870) + '" cy="' + (isStory ? 540 : 420) + '" r="175" fill="none" stroke="#8B9DFF" stroke-opacity=".2" stroke-width="2"/>',
    '<path d="M0 ' + (height - 300) + ' Q ' + (width / 2) + ' ' + (height - 100) + ' ' + width + ' ' + (height - 340) + ' L ' + width + ' ' + height + ' L0 ' + height + 'Z" fill="#06101A" opacity=".72"/>',
    '<text x="86" y="105" fill="#42D9F5" font-family="Arial,sans-serif" font-size="26" font-weight="700" letter-spacing="7">' + brand + '</text>',
    '<text x="88" y="148" fill="#91A8BA" font-family="Arial,sans-serif" font-size="17" letter-spacing="4">' + category + '</text>',
    '<rect x="86" y="' + (top + 70) + '" width="82" height="5" rx="3" fill="#42D9F5"/>',
    title,
    support,
    '<rect x="86" y="' + ctaY + '" width="' + (isStory ? 620 : 650) + '" height="112" rx="20" fill="#42D9F5"/>',
    ctaLines,
    '<text x="86" y="' + (height - 92) + '" fill="#6F8497" font-family="Arial,sans-serif" font-size="17" letter-spacing="3">AURA STUDIO  •  TASARIM ÖRNEĞİ</text>',
    '<text x="86" y="' + (height - 58) + '" fill="#506579" font-family="Arial,sans-serif" font-size="14">Yayın öncesi işletme bilgilerini doğrulayın.</text>',
    '</svg>'
  ].join('\n');
}

function makeVideoHtml(item, durationSeconds) {
  const payload = JSON.stringify({ ...item, durationSeconds }).replace(/</g, '\\u003c');
  const runtime = [
    'const data = ' + payload + ';',
    'const canvas = document.getElementById("screen");',
    'const ctx = canvas.getContext("2d");',
    'const W = canvas.width, H = canvas.height;',
    'function lines(text, maxChars, maxLines) { const words=String(text||"").split(/\\s+/); const out=[]; let line=""; for(const word of words){const next=line?line+" "+word:word;if(next.length>maxChars&&line){out.push(line);line=word;}else{line=next;}if(out.length>=maxLines)break;}if(line&&out.length<maxLines)out.push(line);return out;}',
    'function rounded(x,y,w,h,r,color){ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();}',
    'function draw(ms){',
    ' const t=ms/1000, p=Math.min(1,t/data.durationSeconds);',
    ' const g=ctx.createLinearGradient(0,0,W,H);g.addColorStop(0,"#07101D");g.addColorStop(.55,"#102B42");g.addColorStop(1,"#06101A");ctx.fillStyle=g;ctx.fillRect(0,0,W,H);',
    ' const glow=ctx.createRadialGradient(W*.78,H*(.25+Math.sin(t*.6)*.025),4,W*.78,H*.28,400);glow.addColorStop(0,"rgba(66,217,245,.28)");glow.addColorStop(1,"rgba(66,217,245,0)");ctx.fillStyle=glow;ctx.fillRect(0,0,W,H);',
    ' ctx.save();ctx.translate(W*.79,H*.29);ctx.rotate(t*.12);ctx.strokeStyle="rgba(66,217,245,.24)";ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,150+Math.sin(t*1.5)*8,0,Math.PI*2);ctx.stroke();ctx.rotate(-t*.25);ctx.strokeStyle="rgba(139,157,255,.22)";ctx.beginPath();ctx.arc(0,0,108,0,Math.PI*2);ctx.stroke();ctx.restore();',
    ' for(let i=0;i<28;i++){const x=(i*83+Math.sin(t*.4+i)*16)%W;const y=(i*137+t*18)%H;ctx.fillStyle="rgba(115,220,245,.35)";ctx.fillRect(x,y,2,2);}',
    ' ctx.globalAlpha=Math.min(1,t*1.5);ctx.fillStyle="#42D9F5";ctx.font="700 17px Arial";ctx.fillText(data.businessName.toLocaleUpperCase("tr-TR"),48,74);',
    ' ctx.fillStyle="#91A8BA";ctx.font="12px Arial";ctx.fillText(data.businessType.toLocaleUpperCase("tr-TR"),50,98);',
    ' rounded(48,136,54,4,2,"#42D9F5");',
    ' const headline=lines(data.headline,19,4);ctx.fillStyle="#F5FAFF";ctx.font="800 43px Arial";headline.forEach((line,i)=>ctx.fillText(line,48,250+i*55));',
    ' const body=lines(data.supportingText, thirtyFour(), 4);ctx.fillStyle="#B9C9D8";ctx.font="22px Arial";body.forEach((line,i)=>ctx.fillText(line,50,520+i*34));',
    ' const cta=lines(data.callToAction,25,2);rounded(48,700,444,cta.length>1?100:76,15,"#42D9F5");ctx.fillStyle="#06111A";ctx.font="800 24px Arial";cta.forEach((line,i)=>ctx.fillText(line,72,748+i*30));',
    ' ctx.fillStyle="#6F8497";ctx.font="12px Arial";ctx.fillText("AURA STUDIO  •  DİJİTAL TASARIM",48,900);',
    ' ctx.fillStyle="rgba(255,255,255,.15)";rounded(48,925,444,4,2,"rgba(255,255,255,.15)");rounded(48,925,444*p,4,2,"#42D9F5");',
    '}',
    'function thirtyFour(){return 34;}',
    'window.__auraRender = () => new Promise((resolve,reject)=>{',
    ' try {',
    '  if(!canvas.captureStream||!window.MediaRecorder) throw new Error("Bu Electron sürümünde video kaydı desteklenmiyor.");',
    '  const mime=["video/webm;codecs=vp9","video/webm;codecs=vp8","video/webm"].find(x=>MediaRecorder.isTypeSupported(x));',
    '  if(!mime) throw new Error("WebM video kodlayıcısı bulunamadı.");',
    '  const stream=canvas.captureStream(24);const chunks=[];',
    '  const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:2200000});',
    '  let start=0;let raf=0;let finished=false;',
    '  const finish=async()=>{if(finished)return;finished=true;cancelAnimationFrame(raf);stream.getTracks().forEach(track=>track.stop());const blob=new Blob(chunks,{type:mime});const buffer=await blob.arrayBuffer();const bytes=new Uint8Array(buffer);let binary="";for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));resolve({base64:btoa(binary),mimeType:mime,size:blob.size});};',
    '  recorder.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data);};recorder.onerror=e=>reject(new Error(e.error?.message||"Video kaydı başarısız."));recorder.onstop=finish;',
    '  const tick=now=>{if(!start)start=now;const elapsed=(now-start)/1000;draw(Math.min(now-start,data.durationSeconds*1000));if(elapsed<data.durationSeconds)raf=requestAnimationFrame(tick);};',
    '  recorder.start(250);raf=requestAnimationFrame(tick);setTimeout(()=>{if(recorder.state!=="inactive")recorder.stop();},data.durationSeconds*1000+350);',
    ' } catch(error){reject(error);}',
    '});'
  ].join('\n');
  return '<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;background:#06101a;overflow:hidden}canvas{display:block;width:540px;height:960px}</style></head><body><canvas id="screen" width="540" height="960"></canvas><script>' + runtime + '</script></body></html>';
}

module.exports = async function createMarketingKit(options = {}) {
  const desktopRoot = path.resolve(String(options.desktopRoot || ''));
  const isAllowedPath = options.isAllowedPath;
  const confirmAction = options.confirmAction;
  const renderVideo = options.renderVideo;
  if (!desktopRoot || typeof isAllowedPath !== 'function' || typeof confirmAction !== 'function' || typeof renderVideo !== 'function') {
    throw new Error('AURA Studio için masaüstü, klasör izni ve video oluşturma altyapısı hazır değil.');
  }

  const item = {
    businessName: clean(options.businessName, 'AURA Studio', 70),
    businessType: clean(options.businessType, 'Dijital tasarım stüdyosu', 90),
    campaignGoal: clean(options.campaignGoal, 'İşletmelere web sitesi ve dijital tanıtım hizmetini anlatmak', 220),
    audience: clean(options.audience, 'Küçük işletmeler', 100),
    headline: clean(options.headline, 'İşletmen dijitalde öne çıksın', 100),
    supportingText: clean(options.supportingText, 'Modern web sitesi ve dikkat çeken dijital tasarımlar.', 180),
    callToAction: clean(options.callToAction, 'Çalışmaları incele', 70),
    voiceover: clean(options.voiceover, 'İşletmen için modern bir dijital vitrin hazırlayalım.', 500)
  };
  const durationSeconds = Math.max(6, Math.min(20, Math.round(Number(options.durationSeconds) || 12)));
  const campaignSlug = slugify(item.businessName + '-' + item.headline);
  const baseDir = path.join(desktopRoot, 'AURA-Gelir', 'AURA-Studio', 'Kampanyalar');
  let targetDir = path.join(baseDir, campaignSlug);
  let suffix = 2;
  while (true) {
    try {
      await fs.access(targetDir);
      targetDir = path.join(baseDir, campaignSlug + '-' + suffix++);
    } catch {
      break;
    }
    if (suffix > 50) throw new Error('Kampanya klasörü için uygun bir ad bulunamadı.');
  }
  if (!isAllowedPath(targetDir)) throw new Error('Kampanya klasörü AURA çalışma alanının dışında.');
  const approved = await confirmAction(
    'AURA Studio — Reklam paketi oluşturma',
    'AURA şu klasöre sosyal medya tasarımları, reklam metinleri ve yaklaşık ' + durationSeconds + ' saniyelik animasyonlu WebM video oluşturacak:\n\n' + targetDir + '\n\nHiçbir içerik sosyal medyada paylaşılmayacak. Devam edilsin mi?'
  );
  if (!approved) throw new Error('Reklam paketi oluşturma işlemi iptal edildi.');

  await fs.mkdir(targetDir, { recursive: true });
  const files = [
    ['instagram-gonderi.svg', makeSocialSvg(item, 1080, 1350, false)],
    ['instagram-hikaye.svg', makeSocialSvg(item, 1080, 1920, true)],
    ['reklam-metni.txt', [
      'AURA STUDIO — REKLAM METNİ',
      '',
      'İşletme: ' + item.businessName,
      'Kategori: ' + item.businessType,
      'Hedef: ' + item.campaignGoal,
      'Hedef kitle: ' + item.audience,
      '',
      'BAŞLIK',
      item.headline,
      '',
      'AÇIKLAMA',
      item.supportingText,
      '',
      'ÇAĞRI',
      item.callToAction,
      '',
      'Not: Yayınlamadan önce işletme bilgilerini, marka kullanım iznini ve iddiaları doğrulayın.'
    ].join('\n')],
    ['paylasim-aciklamasi.txt', [
      item.headline,
      '',
      item.supportingText,
      '',
      item.callToAction,
      '',
      '#AURAStudio #WebTasarim #DijitalTasarim #KucukIsletme #SosyalMedya'
    ].join('\n')],
    ['video-seslendirme-metni.txt', item.voiceover],
    ['reels-akis-plani.txt', [
      'AURA STUDIO — DİKEY VİDEO AKIŞI',
      '',
      '0–3 sn: İşletme adı ve dikkat çekici başlık.',
      '3–7 sn: Hizmetin / teklifin kısa açıklaması.',
      '7–10 sn: Ana faydayı ve görsel kimliği vurgula.',
      'Son bölüm: Çağrı metni ve marka adı.',
      '',
      'Seslendirme metni:',
      item.voiceover,
      '',
      'Video dosyası animasyonlu yazı ve grafiklerden oluşur; ses parçası içermez.'
    ].join('\n')],
    ['kampanya-notlari.txt', [
      'AURA STUDIO — KAMPANYA NOTLARI',
      '',
      'Kampanya hedefi: ' + item.campaignGoal,
      'Hedef kitle: ' + item.audience,
      'Süre: ' + durationSeconds + ' saniye',
      'Video: Dikey 9:16, WebM, animasyonlu grafik ve metin',
      'Görseller: Düzenlenebilir SVG vektör tasarımları',
      '',
      'Bu paket taslak üretir; reklam hesabına yükleme, gönderi paylaşma, müşteri mesajı gönderme veya ödeme yapma işlemi yapmaz.',
      'Gerçek işletme bilgileri, fiyatlar, indirimler, sonuç iddiaları ve iletişim verileri doğrulanmadan kullanılmamalıdır.'
    ].join('\n')]
  ];
  const written = [];
  for (const [name, content] of files) {
    const filePath = path.join(targetDir, name);
    await fs.writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' });
    const stat = await fs.stat(filePath);
    written.push({ name, bytes: stat.size });
  }

  let video = { ok: false, error: null };
  try {
    const rendered = await renderVideo(makeVideoHtml(item, durationSeconds), { width: 540, height: 960, durationSeconds });
    const videoBytes = Buffer.isBuffer(rendered) ? rendered : Buffer.from(rendered?.base64 || '', 'base64');
    if (videoBytes.length < 1000 || videoBytes.subarray(0, 4).toString('hex') !== '1a45dfa3') {
      throw new Error('Oluşturulan video dosyası geçerli WebM olarak doğrulanamadı.');
    }
    const videoPath = path.join(targetDir, 'tanitim-videosu.webm');
    await fs.writeFile(videoPath, videoBytes, { flag: 'wx' });
    written.push({ name: 'tanitim-videosu.webm', bytes: videoBytes.length });
    video = { ok: true, path: videoPath, bytes: videoBytes.length, format: 'WebM', durationSeconds, hasAudio: false };
  } catch (error) {
    video = { ok: false, error: String(error?.message || error) };
    await fs.writeFile(path.join(targetDir, 'VIDEO-OLUSTURMA-HATASI.txt'), video.error, { flag: 'wx' });
  }

  const post = await fs.readFile(path.join(targetDir, 'instagram-gonderi.svg'), 'utf8');
  const story = await fs.readFile(path.join(targetDir, 'instagram-hikaye.svg'), 'utf8');
  return {
    ok: true,
    folder: targetDir,
    files: written,
    checks: {
      postSvg: post.includes('<svg') && post.includes('</svg>'),
      storySvg: story.includes('<svg') && story.includes('</svg>'),
      copyFiles: files.filter(([name]) => name.endsWith('.txt')).every(([name]) => written.some(file => file.name === name)),
      videoCreated: video.ok
    },
    video,
    message: video.ok
      ? 'Reklam paketi ve animasyonlu video oluşturuldu. İçerikler yerel dosyalarda; hiçbir yere paylaşılmadı.'
      : 'Reklam görselleri ve metinleri oluşturuldu; video üretilemedi. Hata dosyasına bakın.'
  };
};
