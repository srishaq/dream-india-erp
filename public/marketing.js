// Marketing & social media (company-wide or by project): channels and their figures (straight from Instagram, Facebook,
// Meta Ads and YouTube each night), the 12-month report,
// the content calendar with Canva links, leads by source, campaigns and spend, the design library from Google Drive,
// the marketing team's tasks, and set-up. Mounted by app.js: window.Marketing.render(ctx, scope, tab).
(function () {
  const NET = {
    instagram: { n: 'Instagram', c: '#E1306C', g: 'linear-gradient(135deg,#FEDA75,#FA7E1E 30%,#D62976 60%,#962FBF 85%,#4F5BD5)', d: 'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4Zm5 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm5.5-1.5h.01' },
    facebook: { n: 'Facebook', c: '#1877F2', g: 'linear-gradient(135deg,#1877F2,#0A4FB3)', d: 'M15 3h-2.5A4.5 4.5 0 0 0 8 7.5V10H5.5v3.5H8V21h3.5v-7.5H14l.6-3.5h-3.1V7.8c0-.8.5-1.3 1.3-1.3H15Z' },
    youtube: { n: 'YouTube', c: '#FF0000', g: 'linear-gradient(135deg,#FF4E45,#C4000C)', d: 'M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8ZM10 15V9l5.2 3Z' },
    linkedin: { n: 'LinkedIn', c: '#0A66C2', g: 'linear-gradient(135deg,#0A66C2,#004182)', d: 'M4 9h3.5v11H4Zm1.8-6a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM10 9h3.3v1.6c.5-.9 1.7-1.9 3.5-1.9 3.7 0 4.2 2.3 4.2 5.3V20h-3.5v-5.3c0-1.3 0-2.9-1.8-2.9s-2.1 1.4-2.1 2.8V20H10Z' },
    website: { n: 'Website', c: '#0E8C9B', g: 'linear-gradient(135deg,#14B8A6,#0E7490)', d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-9 9h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z' },
    whatsapp: { n: 'WhatsApp', c: '#25D366', g: 'linear-gradient(135deg,#25D366,#128C7E)', d: 'M4 20l1.3-4A8 8 0 1 1 8 18.7Zm5-11c0 3.3 2.7 6 6 6l1-1.5-1.8-1-1 .8a4 4 0 0 1-2.5-2.5l.8-1-1-1.8Z' },
    google: { n: 'Google', c: '#EA4335', g: 'linear-gradient(135deg,#4285F4,#34A853 40%,#FBBC05 70%,#EA4335)', d: 'M21 12.2c0-.7-.1-1.3-.2-1.9H12v3.6h5a4.3 4.3 0 0 1-1.9 2.8v2.3h3A9 9 0 0 0 21 12.2ZM12 21c2.4 0 4.5-.8 6-2.2l-3-2.3c-.8.6-1.8.9-3 .9a5.3 5.3 0 0 1-5-3.6H4v2.4A9 9 0 0 0 12 21Z' },
  };
  const SRC = { ivr: 'IVR call', instagram: 'Instagram', facebook: 'Facebook', meta_ads: 'Meta ads', google_ads: 'Google ads', youtube: 'YouTube', website: 'Website', whatsapp: 'WhatsApp', '99acres': '99acres', magicbricks: 'MagicBricks', housing: 'Housing.com', walk_in: 'Walk-in', referral: 'Referral', channel_partner: 'Channel partner', telecalling: 'Telecalling', hoarding: 'Hoarding', event: 'Event / exhibition', other: 'Other' };
  const ST = { idea: ['Idea', '#98A2B3'], draft: ['Draft', '#667085'], review: ['Waiting for approval', '#DC6803'], approved: ['Approved', '#7A5AF8'], scheduled: ['Scheduled', '#2E90FA'], published: ['Published', '#12B76A'] };
  const LST = { new: ['New', '#2E90FA'], contacted: ['Contacted', '#7A5AF8'], visit: ['Site visit', '#DC6803'], booked: ['Booked', '#12B76A'], lost: ['Lost', '#98A2B3'] };
  const KIND = { post: 'Post', reel: 'Reel', story: 'Story', video: 'Video', carousel: 'Carousel', ad: 'Ad', brochure: 'Brochure', email: 'Email', other: 'Other' };
  const LIB = [['brochure', 'Brochures', /brochure|leaflet|flyer|e-?book|catalog/i], ['floor', 'Floor plans', /floor ?plan|unit ?plan|typical|layout|carpet/i], ['elev', 'Elevations', /elevation|facade|fa[cç]ade/i],
    ['render', '3D renders', /render|3d|view|perspective|aerial|walkthrough|cgi/i], ['amenity', 'Amenities', /amenit|club|pool|gym|garden|lobby|podium|terrace/i], ['drawing', '2D drawings', /2d|drawing|dwg|section|site ?plan|master ?plan|plan/i],
    ['video', 'Videos', /\.(mp4|mov|avi|mkv)$|video|reel/i], ['brand', 'Logos & brand', /logo|brand|font|guideline|letterhead/i], ['social', 'Social media', /insta|post|story|creative|social|facebook|youtube/i]];
  let C = null, D = null, S = { tab: 'overview', month: null, leadF: 'all', leadQ: '', libF: 'all', lib: null, libFor: null };

  const css = `
  .mk{--ink:#10114e;--mut:#667085;--line:#EAECF0;--card:#fff;--soft:#F7F7FB}
  .mk .mk-hero{background:radial-gradient(1200px 400px at 85% -60%,#7A5AF8 0,transparent 60%),radial-gradient(800px 300px at 0% 120%,#E1306C33 0,transparent 60%),linear-gradient(135deg,#140C59,#2A1E7A);color:#fff;border-radius:20px;padding:22px 24px 18px;margin:0 0 16px;position:relative;overflow:hidden}
  .mk .mk-hero h1{color:#fff;margin:2px 0 4px;font-size:26px;letter-spacing:-.01em}.mk .mk-hero p{margin:0;color:#D9D6FE;font-size:14px}
  .mk .mk-eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#BDB4FE;font-weight:700}
  .mk .mk-scope{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.mk .mk-scope button{background:#ffffff1f;color:#fff;border:1px solid #ffffff33;border-radius:999px;padding:7px 14px;font-weight:600;font-size:13px;cursor:pointer}
  .mk .mk-scope button[aria-pressed=true]{background:#fff;color:#140C59;border-color:#fff}
  .mk .mk-sync{position:absolute;right:20px;top:18px;font-size:12px;color:#D9D6FE;text-align:right}
  .mk .mk-tabs{display:flex;gap:4px;overflow-x:auto;margin:0 0 16px;padding:4px;background:var(--soft);border-radius:12px;scrollbar-width:none}
  .mk .mk-tabs button{border:0;background:none;padding:9px 14px;border-radius:9px;font-weight:600;color:var(--mut);white-space:nowrap;cursor:pointer;font-size:14px}.mk .mk-tabs button[aria-selected=true]{background:#fff;color:var(--ink);box-shadow:0 1px 3px #1018281a}
  .mk .mk-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:16px}
  .mk .mk-kpi{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px 16px}.mk .mk-kpi b{display:block;font-size:24px;color:var(--ink);letter-spacing:-.02em}.mk .mk-kpi span{font-size:13px;color:var(--mut)}
  .mk .mk-up,.mk .mk-kpi .mk-up,.mk .mk-chan .mk-up{color:#079455;font-weight:700;font-size:12px}.mk .mk-down,.mk .mk-kpi .mk-down,.mk .mk-chan .mk-down{color:#D92D20;font-weight:700;font-size:12px}
  .mk .mk-chans{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;margin-bottom:16px}
  .mk .mk-chan{background:var(--card);border:1px solid var(--line);border-radius:18px;overflow:hidden;display:flex;flex-direction:column}
  .mk .mk-chan .ctop{padding:14px 16px;color:#fff;display:flex;align-items:center;gap:10px}.mk .mk-chan .ctop svg{width:26px;height:26px}.mk .mk-chan .ctop b{font-size:16px}.mk .mk-chan .ctop small{display:block;opacity:.9;font-size:12px}
  .mk .mk-chan .fig{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;padding:14px 16px}.mk .mk-chan .fig div b{display:block;font-size:20px;color:var(--ink)}.mk .mk-chan .fig div span{font-size:12px;color:var(--mut)}
  .mk .mk-chan .spark{padding:0 12px 10px}.mk .mk-chan .foot{border-top:1px solid var(--line);padding:9px 16px;font-size:12px;color:var(--mut);display:flex;justify-content:space-between;gap:8px}
  .mk .mk-grid2{display:grid;grid-template-columns:1.3fr 1fr;gap:14px}@media(max-width:900px){.mk .mk-grid2{grid-template-columns:1fr}.mk .mk-sync{position:static;margin-top:8px;text-align:left}.mk .mk-hero{padding:16px 16px 14px}.mk .mk-hero h1{font-size:21px}.mk .mk-hero p{font-size:13px}.mk .mk-kpi b{font-size:20px}}
  .mk .mk-card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px;margin-bottom:14px}.mk .mk-card h3{margin:0 0 10px;font-size:15px;color:var(--ink)}
  .mk .mk-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--line)}.mk .mk-row:first-of-type{border-top:0}
  .mk .mk-pill{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;background:var(--soft);color:var(--ink);white-space:nowrap}
  .mk .mk-dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:none}
  .mk-ic{width:18px;height:18px;flex:none;vertical-align:middle}.mk .mk-bar{height:8px;background:var(--soft);border-radius:99px;overflow:hidden}.mk .mk-bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#7A5AF8,#E1306C)}
  .mk .mk-funnel{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.mk .mk-funnel div{background:var(--soft);border-radius:12px;padding:10px;text-align:center}.mk .mk-funnel b{display:block;font-size:20px;color:var(--ink)}.mk .mk-funnel span{font-size:12px;color:var(--mut)}
  .mk .mk-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}.mk .mk-cal .h{font-size:12px;font-weight:700;color:var(--mut);text-align:center;padding:4px}
  .mk .mk-cal .d{min-height:104px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:6px;display:flex;flex-direction:column;gap:4px;cursor:pointer}.mk .mk-cal .d.o{opacity:.45}.mk .mk-cal .d.t{border-color:#7A5AF8;box-shadow:0 0 0 2px #7A5AF833}
  .mk .mk-cal .d .n{font-size:12px;font-weight:700;color:var(--mut)}.mk .mk-cal .chip{font-size:11px;font-weight:600;border-radius:7px;padding:3px 6px;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  @media(max-width:700px){.mk .mk-cal{grid-template-columns:1fr}.mk .mk-cal .h{display:none}.mk .mk-cal .d{min-height:0}.mk .mk-cal .d.o{display:none}.mk .mk-cal .d.e{display:none}}
  .mk .mk-lib{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}.mk .mk-lib a{display:block;background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;text-decoration:none;color:var(--ink)}
  .mk .mk-lib .th{aspect-ratio:4/3;background:var(--soft) center/cover no-repeat;display:flex;align-items:center;justify-content:center;color:var(--mut);font-size:12px;font-weight:700}.mk .mk-lib .nm{padding:8px 10px;font-size:13px;font-weight:600;line-height:1.3;word-break:break-word}.mk .mk-lib .nm small{display:block;font-weight:400;color:var(--mut);font-size:11px;margin-top:2px}
  .mk .mk-chips{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px}.mk .mk-chips button{border:1px solid var(--line);background:#fff;border-radius:999px;padding:6px 12px;font-weight:600;font-size:13px;cursor:pointer;color:var(--ink)}.mk .mk-chips button[aria-pressed=true]{background:var(--ink);color:#fff;border-color:var(--ink)}
  .mk .mk-camp{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
  .mk .mk-empty{padding:26px;text-align:center;color:var(--mut);background:var(--soft);border-radius:14px}
  .mk table.mk-t{width:100%;border-collapse:collapse;font-size:14px}.mk table.mk-t th{text-align:left;font-size:12px;color:var(--mut);font-weight:700;padding:8px;border-bottom:1px solid var(--line)}.mk table.mk-t td{padding:9px 8px;border-bottom:1px solid var(--line);vertical-align:middle}
  .mk .mk-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 12px}
  .mk .mk-grid2h{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:700px){.mk .mk-grid2h{grid-template-columns:1fr}.mk .mk-posts{grid-template-columns:1fr 1fr!important}}
  .mk .mk-posts{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}.mk .mk-post{display:block;border:1px solid var(--line);border-radius:14px;overflow:hidden;text-decoration:none;color:var(--ink);background:#fff}
  .mk .mk-post .th{aspect-ratio:1;background:var(--soft);position:relative;overflow:hidden}.mk .mk-post .th img{width:100%;height:100%;object-fit:cover;display:block}
  .mk .mk-post .net{position:absolute;left:8px;top:8px;border-radius:8px;padding:4px;display:flex}.mk .mk-post .kd{position:absolute;right:8px;top:8px;background:#000a;color:#fff;border-radius:6px;font-size:11px;font-weight:700;padding:2px 6px;text-transform:capitalize}
  .mk .mk-post .cap{padding:8px 10px 2px;font-size:12px;line-height:1.35;height:34px;overflow:hidden}.mk .mk-post .st{display:flex;gap:10px;padding:4px 10px;font-size:12px;font-weight:700;color:var(--ink);flex-wrap:wrap}.mk .mk-post .dt{padding:0 10px 8px;font-size:11px;color:var(--mut)}
  .mk-pull{position:fixed;right:20px;bottom:96px;z-index:60;background:#fff;border:1px solid #EAECF0;border-radius:14px;box-shadow:0 12px 32px #10182833;padding:14px 16px;width:300px;display:flex;flex-direction:column;gap:6px;font-size:14px}.mk-pull span{color:#667085;font-size:13px}
  .mk-pull .mk-bar{height:8px;background:#F2F4F7;border-radius:99px;overflow:hidden}.mk-pull .mk-bar i{display:block;height:100%;background:linear-gradient(90deg,#7A5AF8,#E1306C)}
  .mk .mk-chart{width:100%;overflow:visible}.mk .mk-chart text{font-size:11px;fill:#667085}.mk .mk-chart .v{fill:#10114e;font-weight:700}
  .mk .mk-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--mut);margin:0 0 6px}.mk .mk-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
  .mk .mk-scroll{overflow-x:auto}.mk table.mk-t th[data-sort]{cursor:pointer;white-space:nowrap}.mk table.mk-t td.n,.mk table.mk-t th.n{text-align:right;white-space:nowrap}.mk .mk-tip{position:fixed;pointer-events:none;background:#10114e;color:#fff;font-size:12px;padding:6px 8px;border-radius:8px;z-index:70;white-space:nowrap}
  .mk .mk-appr{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}.mk .mk-ap{all:unset;cursor:pointer;display:block;background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden}.mk .mk-ap:hover{border-color:#DC6803}
  .mk .mk-ap .th{aspect-ratio:1;background:var(--soft);display:flex;align-items:center;justify-content:center;color:var(--mut);font-size:12px;font-weight:700}.mk .mk-ap .th img{width:100%;height:100%;object-fit:cover}.mk .mk-ap b{display:block;padding:8px 10px 0;font-size:13px;color:var(--ink)}.mk .mk-ap small{display:block;padding:2px 10px 10px;font-size:11px;color:var(--mut)}.mk .mk-ap small .mk-ic{width:14px;height:14px}
  .mk-dl .mk-files{display:flex;gap:10px;flex-wrap:wrap;margin:6px 0}.mk-dl .mk-file{width:150px;display:flex;flex-direction:column;gap:4px}.mk-dl .mk-file img,.mk-dl .mk-file video{width:150px;height:150px;object-fit:cover;border-radius:10px;border:1px solid #EAECF0;background:#F7F7FB}
  .mk-dl .mk-file .pdf{width:150px;height:150px;border-radius:10px;border:1px solid #EAECF0;background:#FEF3F2;color:#B42318;font-weight:800;display:flex;flex-direction:column;align-items:center;justify-content:center;text-decoration:none;font-size:20px}.mk-dl .mk-file .pdf small{font-size:11px;font-weight:400;padding:4px 8px;text-align:center;word-break:break-all}
  .mk-dl .mk-back{background:#FEF3F2;border:1px solid #FDA29B;border-radius:10px;padding:8px 10px;font-size:13px;color:#912018}.mk-dl .mk-design{margin-top:10px}
  .mk .mk-prow h3{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);margin:0 0 8px}.mk .mk-kpis.k7{grid-template-columns:repeat(auto-fit,minmax(140px,1fr))}.mk .mk-kpis.k7 .mk-kpi b{font-size:22px}
  .mk .mk-plan{display:grid;grid-template-columns:1.2fr 1.6fr .7fr .8fr;gap:16px;background:#fff;border:1px solid var(--line);border-radius:18px;padding:16px;margin:0 0 14px}@media(max-width:1000px){.mk .mk-plan{grid-template-columns:1fr}}
  .mk .mk-plan h3{margin:0;font-size:16px;color:var(--ink)}.mk .mk-plan h4{margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut)}.mk .mk-plan .brief{font-size:13px;line-height:1.5;margin:6px 0 10px;white-space:pre-wrap;color:#344054}
  .mk .mk-plan .c2,.mk .mk-plan .c3,.mk .mk-plan .c4{border-left:1px solid var(--line);padding-left:16px}@media(max-width:1000px){.mk .mk-plan .c2,.mk .mk-plan .c3,.mk .mk-plan .c4{border-left:0;padding-left:0;border-top:1px solid var(--line);padding-top:12px}}
  .mk .mk-dzs{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px}.mk .mk-dz{all:unset;cursor:pointer;position:relative;display:block;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--soft)}
  .mk .mk-dz img{width:100%;aspect-ratio:1;object-fit:cover;display:block}.mk .mk-dz>span{display:flex;align-items:center;justify-content:center;aspect-ratio:1;font-size:12px;font-weight:700;color:var(--mut)}.mk .mk-dz.add{border-style:dashed}.mk .mk-dz.add span{color:#7A5AF8}
  .mk .mk-dz em{position:absolute;left:6px;top:6px;color:#fff;font-style:normal;font-size:10px;font-weight:700;border-radius:6px;padding:2px 6px}.mk .mk-dz small{display:block;padding:4px 6px;font-size:11px;color:var(--mut);background:#fff}.mk .mk-dz small .mk-ic{width:12px;height:12px}
  .mk .mk-plan .bg{margin:0 0 8px}.mk .mk-plan .bg b{display:block;font-size:20px;color:var(--ink)}.mk .mk-plan .bg span{font-size:12px;color:var(--mut)}
  .mk .mk-okrow{display:flex;align-items:center;gap:8px;font-size:14px;margin:0 0 8px}.mk .mk-okrow small{color:var(--mut)}.mk .mk-ok{width:22px;height:22px;border-radius:50%;background:#F2F4F7;color:#98A2B3;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:12px}.mk .mk-ok.y{background:#12B76A;color:#fff}
  .mk .mk-plan .c4 button{margin:0 6px 6px 0}
  .mk-dl .mk-plog{background:#F7F7FB;border-radius:10px;padding:8px 10px;font-size:13px;margin:8px 0 0}.mk-dl .mk-plog div{margin:2px 0}
  .mk button.mk-fig{all:unset;cursor:pointer;display:block;border-radius:8px}.mk button.mk-fig:hover b{color:#7A5AF8}.mk .mk-chan .fig button.mk-fig b{display:block;font-size:20px;color:var(--ink)}.mk .mk-chan .fig button.mk-fig span{font-size:12px;color:var(--mut)}
  .mk button.mk-kpi{display:block;width:100%;text-align:left;font:inherit;font-weight:400;cursor:pointer;color:inherit;transition:border-color .15s,box-shadow .15s}.mk button.mk-kpi:hover{background:#fff;border-color:#7A5AF8;box-shadow:0 4px 14px #7A5AF822}
  .mk-dlg{position:fixed;inset:0;background:#10114e66;z-index:80;display:flex;align-items:flex-start;justify-content:center;padding:40px 16px}.mk-dlg .box{background:#fff;border-radius:18px;width:min(1200px,100%);max-height:calc(100vh - 80px);display:flex;flex-direction:column;box-shadow:0 20px 60px #10182855}
  .mk-dlg .hd{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:16px 18px;border-bottom:1px solid #EAECF0}.mk-dlg .hd h2{margin:0;font-size:17px;color:#10114e;flex:1;min-width:200px}.mk-dlg .hd input{max-width:220px;margin:0}.mk-dlg .bd{overflow:auto;padding:0 18px 14px}
  .mk-dlg table.mk-t{width:100%;border-collapse:collapse;font-size:13px}.mk-dlg table.mk-t th{position:sticky;top:0;background:#fff;text-align:left;font-size:12px;color:#667085;padding:8px;border-bottom:1px solid #EAECF0;white-space:nowrap}.mk-dlg table.mk-t td{padding:7px 8px;border-bottom:1px solid #F2F4F7;vertical-align:top}
  .mk-dl .mk-ch{display:flex;gap:8px;flex-wrap:wrap}.mk-dl .mk-ch label{display:flex;gap:6px;align-items:center;border:1px solid #EAECF0;border-radius:999px;padding:5px 10px;font-weight:500;margin:0}.mk-dl .mk-ch input{width:auto;margin:0}
  `;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (n) => (n == null ? '–' : Math.round(n) >= 1e7 ? (n / 1e7).toFixed(2) + ' Cr' : Math.round(n) >= 1e5 ? (n / 1e5).toFixed(1) + ' L' : Math.round(n).toLocaleString('en-IN'));
  const inr = (n) => (n == null || n === '' ? '–' : '₹' + nf(+n));
  const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);
  const delta = (a, b) => { const p = pct(a, b); return p == null ? '' : `<span class="${p >= 0 ? 'mk-up' : 'mk-down'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p)}%</span>`; };
  const ic = (net, cls = 'mk-ic', color) => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="${color || 'currentColor'}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${(NET[net] || NET.website).d}"/></svg>`;
  const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : '');
  const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : 'No date yet');
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const projName = (id) => (id ? (D.projects.find((p) => p.id === id) || {}).name || '' : 'Company');
  const spark = (vals, color) => {
    if (!vals || vals.length < 2) return '<div style="height:44px"></div>';
    const w = 240, h = 44, mx = Math.max(...vals, 1), mn = Math.min(...vals, 0), sx = w / (vals.length - 1), y = (v) => h - 4 - ((v - mn) / (mx - mn || 1)) * (h - 8);
    const pts = vals.map((v, i) => `${(i * sx).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none"><polyline points="0,${h} ${pts} ${w},${h}" fill="${color}22" stroke="none"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/></svg>`;
  };

  async function load() { D = await C.api('/api/marketing?scope=' + encodeURIComponent(S.scope)); S.rep = null; }
  async function render(ctx, scope, tab) {
    C = ctx;
    if (!$('#mk-css')) { const st = document.createElement('style'); st.id = 'mk-css'; st.textContent = css; document.head.appendChild(st); }
    if (scope != null) S.scope = scope; if (S.scope == null) S.scope = 'company'; if (tab) S.tab = tab;
    $('#page').innerHTML = '<div class="mk"><p class="muted">Loading…</p></div>';
    await load();
    paint();
    const msg = new URLSearchParams(location.search).get('social');
    if (msg) {
      history.replaceState(null, '', location.pathname + location.hash);
      if (/^(Connected|YouTube connected)/.test(msg)) { S.tab = 'setup'; paint(); await pullAll(/^YouTube/.test(msg) ? ['youtube'] : ['facebook', 'instagram', 'ads', 'leads'], true, msg); }
      else alert(msg);
    }
  }
  // Pull part by part (each part in its own call), showing how far it has got.
  const PART = { facebook: 'Facebook', instagram: 'Instagram', ads: 'Meta Ads campaigns', leads: 'Meta lead forms', youtube: 'YouTube' };
  async function pullAll(parts, full, intro) {
    const box = document.createElement('div'); box.className = 'mk-pull';
    document.body.appendChild(box);
    const errs = [];
    for (let i = 0; i < parts.length; i++) {
      box.innerHTML = `<b>${esc(intro || 'Pulling the figures')}</b><span>${PART[parts[i]]}… (${i + 1} of ${parts.length})</span><div class="mk-bar"><i style="width:${Math.round((i / parts.length) * 100)}%"></i></div>`;
      try { const r = await C.api('/api/marketing', { action: 'sync', data: { part: parts[i], full } }); if (r.errors && r.errors.length) errs.push(...r.errors); }
      catch (e) { errs.push(`${PART[parts[i]]}: ${e.message}`); }
    }
    box.remove();
    await load(); paint();
    if (errs.length) alert('Some figures could not be pulled:\n\n' + errs.join('\n')); else C.toast('All figures are in.');
  }
  function paint() {
    const SO = D.social, sync = SO.lastSync, on = [SO.meta.connected && SO.meta.pages.some((p) => p.instagram) && 'Instagram', SO.meta.connected && 'Facebook', SO.meta.connected && SO.meta.ads.length && 'Meta Ads', SO.youtube.connected && 'YouTube'].filter(Boolean);
    const tabs = [['overview', 'Overview'], ['active', 'Active campaigns'], ['report', '12-month report'], ['calendar', 'Content calendar'], ['leads', 'Leads'], ['campaigns', 'Campaigns & spend'], ['library', 'Design library'], ['tasks', 'Tasks'], ['setup', 'Set-up']];
    $('#page').innerHTML = `<div class="mk"><div class="mk-hero"><span class="mk-eyebrow">Company-wide · by project</span><h1>Marketing & Social Media</h1><p>Every channel, post, lead and campaign in one place.</p>
      <div class="mk-sync">${on.length ? `Live from ${on.join(', ')}${sync ? ' · ' + when(sync.at) : ''}` : 'Channels not connected yet (Set-up)'}${SO.meta.error || SO.youtube.error ? '<br><b style="color:#FECDCA">A channel needs connecting again (Set-up)</b>' : ''}</div>
      <div class="mk-scope">${[['company', 'Company'], ...D.projects.map((p) => [String(p.id), p.name])].map(([k, l]) => `<button data-scope="${k}" aria-pressed="${String(S.scope) === k}">${esc(l)}</button>`).join('')}</div></div>
      <nav class="ff-tabs no-print" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${S.tab === k}">${l}</button>`).join('')}</nav>
      <div id="mkBody"></div></div>`;
    $$('#page [data-scope]').forEach((b) => (b.onclick = async () => { S.scope = b.dataset.scope; S.lib = null; await load(); paint(); }));
    $$('#page [data-tab]').forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; paint(); }));
    ({ overview, active, report, calendar, leads, campaigns, library, tasks, setup }[S.tab] || overview)();
  }
  const body = (h) => ($('#mkBody').innerHTML = h);

  // ---------- overview ----------
  function overview() {
    const ch = D.channels, sum = (k) => ch.reduce((a, c) => a + (+c[k] || 0), 0);
    const d30 = Date.now() - 30 * 864e5, recent = D.leads.filter((l) => Date.parse(l.created_at) > d30), prevL = D.leads.filter((l) => Date.parse(l.created_at) <= d30 && Date.parse(l.created_at) > d30 - 30 * 864e5);
    const spent = D.campaigns.reduce((a, c) => a + (+c.spent || 0), 0), allLeads = D.leads.length, campLeads = D.campaigns.reduce((a, c) => a + Math.max(+c.ad_leads || 0, c.leads || 0), 0);
    const fol = sum('followers'), folB = ch.reduce((a, c) => a + (+c.followersBefore || +c.followers || 0), 0);
    const up = D.posts.filter((p) => p.publish_at && Date.parse(p.publish_at) > Date.now() - 864e5 && p.status !== 'published').slice(0, 6);
    const bySrc = {}; for (const l of D.leads) bySrc[l.source] = (bySrc[l.source] || 0) + 1;
    const srcs = Object.entries(bySrc).sort((a, b) => b[1] - a[1]); const mx = srcs.length ? srcs[0][1] : 1;
    const f = (s) => D.leads.filter((l) => (s === 'contacted' ? ['contacted', 'visit', 'booked'].includes(l.status) : s === 'visit' ? ['visit', 'booked'].includes(l.status) : l.status === s || (s === 'booked' && l.is_buyer))).length;
    const soc = ch.filter((c) => !c.wa && !c.ivr), bef = (k) => (soc.length && soc.every((c) => c[k + 'Before'] != null) ? sum(k + 'Before') : null); // compared only when the 30 days before were pulled
    const P = D.periods, fyLabel = `This financial year · since 1 Apr ${P.fy.slice(0, 4)}`;
    const row = (k, x, label) => `<div class="mk-prow"><h3>${esc(label)}</h3><div class="mk-kpis k7">
        <button type="button" class="mk-kpi" data-md="followers" data-per="${k}"><span>Followers, all channels</span><b>${nf(x.followers)}</b>${x.followersBefore ? `${delta(x.followersCmp, x.followersBefore)} <span>${k === 'ytd' ? 'this year' : 'in 30 days'}</span>` : ''}</button>
        <button type="button" class="mk-kpi" data-md="views" data-per="${k}"><span>Views</span><b>${nf(x.views)}</b></button>
        <button type="button" class="mk-kpi" data-md="reach" data-per="${k}"><span>Reach</span><b>${nf(x.reach)}</b></button>
        <button type="button" class="mk-kpi" data-md="posts" data-per="${k}"><span>Content published</span><b>${nf(x.posts)}</b></button>
        <button type="button" class="mk-kpi" data-md="leads" data-per="${k}"><span>Leads</span><b>${nf(x.leads)}</b>${x.adLeads ? `<span>Meta reports ${nf(x.adLeads)} form leads</span>` : ''}</button>
        <button type="button" class="mk-kpi" data-md="spend" data-per="${k}"><span>Amount spent</span><b>${inr(x.spend)}</b>${x.chats ? `<span>${nf(x.chats)} WhatsApp chats</span>` : ''}</button>
        <button type="button" class="mk-kpi" data-md="spend" data-per="${k}"><span>Cost per lead</span><b>${x.cpl != null ? inr(x.cpl) : '–'}</b></button></div></div>`;
    body(`${row('d30', P.d30, 'Last 30 days')}${row('ytd', P.ytd, fyLabel)}
      <div class="mk-chans">${ch.map(chanCard).join('') || `<div class="mk-empty">No channels yet. Add Instagram, Facebook, YouTube and the website under Set-up.</div>`}</div>
      ${D.can.approve && D.posts.some((p) => p.status === 'review') ? `<div class="mk-card" style="border-color:#FEC84B;background:#FFFCF5"><h3>Waiting for your approval (${D.posts.filter((p) => p.status === 'review').length})</h3>${apprGrid(D.posts.filter((p) => p.status === 'review'))}</div>` : ''}
      ${D.top.length ? `<div class="mk-card"><h3>Best posts, last 30 days</h3><div class="mk-posts">${D.top.map(postTile).join('')}</div></div>` : ''}
      <div class="mk-grid2"><div class="mk-card"><h3>Coming up</h3>${up.map(postRow).join('') || '<p class="muted small" style="margin:0">Nothing planned for the next days. Plan posts in the Content calendar.</p>'}</div>
        <div class="mk-card"><h3>Leads: from enquiry to booking</h3><div class="mk-funnel"><div><b>${allLeads}</b><span>Leads</span></div><div><b>${f('contacted')}</b><span>Contacted</span></div><div><b>${f('visit')}</b><span>Site visit</span></div><div><b>${f('booked')}</b><span>Booked</span></div></div>
          <h3 style="margin-top:16px">Where leads come from</h3>${srcs.map(([s, n]) => `<div style="margin:0 0 8px"><div style="display:flex;justify-content:space-between;font-size:13px"><span>${esc(SRC[s] || s)}</span><b>${n}</b></div><div class="mk-bar"><i style="width:${Math.round((n / mx) * 100)}%"></i></div></div>`).join('') || '<p class="muted small" style="margin:0">No leads yet.</p>'}</div></div>`);
    $$('#mkBody [data-post]').forEach((x) => (x.onclick = () => postForm(D.posts.find((p) => p.id === +x.dataset.post))));
    $$('#mkBody [data-md]').forEach((x) => (x.onclick = () => mdrill(x.dataset.md, x.dataset.per)));
  }
  // the rows behind a box
  async function mdrill(key, per) {
    const dl = document.createElement('div'); dl.className = 'mk-dlg';
    dl.innerHTML = `<div class="box" role="dialog" aria-modal="true"><div class="hd"><h2>Loading…</h2><input type="search" placeholder="Search"><button class="ghost small" data-csv>Download (CSV)</button><button class="ghost small" data-x>Close</button></div><div class="bd"></div></div>`;
    document.body.appendChild(dl);
    const close = () => { dl.remove(); document.removeEventListener('keydown', esc1); }, esc1 = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esc1); dl.onclick = (e) => { if (e.target === dl || e.target.closest('[data-x]')) close(); };
    let R;
    try { R = await C.api(`/api/marketing?mdrill=${encodeURIComponent(key)}&scope=${encodeURIComponent(S.scope)}&period=${per || 'd30'}`); } catch (e) { $('.bd', dl).innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
    const fmt = (v, t) => (v == null || v === '' ? '–' : t === 'n' ? nf(+v) : t === 'inr' ? '₹' + Math.round(+v).toLocaleString('en-IN') : t === 'date' ? day(v) : t === 'link' ? `<a href="${esc(v)}" target="_blank" rel="noopener">Open ↗</a>` : esc(v));
    const draw = (q) => { const rows = R.rows.filter((r) => !q || Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(q)));
      $('h2', dl).textContent = `${R.title} (${rows.length})`;
      $('.bd', dl).innerHTML = rows.length ? `<table class="mk-t"><tr>${R.columns.map(([, l, t]) => `<th style="${t && t !== 'date' && t !== 'link' ? 'text-align:right' : ''}">${esc(l)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${R.columns.map(([k, , t]) => `<td style="${t && t !== 'date' && t !== 'link' ? 'text-align:right;white-space:nowrap' : ''}">${fmt(r[k], t)}</td>`).join('')}</tr>`).join('')}</table>` : '<p class="muted" style="padding:16px 0">Nothing here yet.</p>'; };
    draw('');
    $('input', dl).oninput = (e) => draw(e.target.value.trim().toLowerCase());
    $('[data-csv]', dl).onclick = () => { const q = (v) => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + [R.columns.map((c) => c[1]), ...R.rows.map((r) => R.columns.map(([k]) => r[k]))].map((r) => r.map(q).join(',')).join('\n')], { type: 'text/csv' })); a.download = key + '.csv'; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 500); };
  }
  function chanCard(c) {
    const N = NET[c.network] || NET.website, has = c.followers != null || c.views;
    if (c.ivr) return `<div class="mk-chan"><div class="ctop" style="background:linear-gradient(135deg,#F79009,#B54708)"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg><div><b>IVR calls</b><small>calls to the IVR number</small></div></div>
      <div class="fig"><button type="button" class="mk-fig" data-md="ivrcalls"><b>${nf(c.ivr.calls30)}</b><span>calls, 30 days · ${nf(c.ivr.callers30)} callers</span></button><button type="button" class="mk-fig" data-md="ivrmissed"><b style="${c.ivr.missed30 ? 'color:#B42318' : ''}">${nf(c.ivr.missed30)}</b><span>missed: call back</span></button>
        <button type="button" class="mk-fig" data-md="ivrleads"><b>${nf(c.ivr.leads30)}</b><span>new leads, 30 days</span></button><button type="button" class="mk-fig" data-md="ivrcalls"><b>${nf(c.ivr.total)}</b><span>calls in all</span></button></div>
      <div class="foot"><span>${c.ivr.last ? 'Last call ' + when(c.ivr.last) : 'Not connected yet: link in Set-up'}</span></div></div>`;
    if (c.wa) return `<div class="mk-chan"><div class="ctop" style="background:${N.g}">${ic('whatsapp', '', '#fff')}<div><b>WhatsApp</b><small>${esc(c.handle || 'chats and leads')}</small></div></div>
      <div class="fig"><button type="button" class="mk-fig" data-md="wachats"><b>${nf(c.wa.this_month)}</b><span>chats from ads, this month${c.wa.last_month ? ' · ' + nf(c.wa.last_month) + ' last month' : ''}</span></button><button type="button" class="mk-fig" data-md="waleads"><b>${nf(c.wa.leads30)}</b><span>WhatsApp leads, 30 days</span></button>
        <button type="button" class="mk-fig" data-md="wachats"><b>${nf(c.wa.year)}</b><span>chats from ads, 12 months</span></button><button type="button" class="mk-fig" data-md="wachats"><b>${c.wa.year && c.wa.spend ? inr(c.wa.spend / c.wa.year) : '–'}</b><span>ad spend per chat</span></button></div>
      <div class="foot"><span>From Meta Ads (click-to-WhatsApp) and Leads</span></div></div>`;
    return `<div class="mk-chan"><div class="ctop" style="background:${N.g}">${ic(c.network, '', '#fff')}<div><b>${N.n}</b><small>${esc(c.handle ? '@' + c.handle.replace(/^@/, '') : c.url || '')}${c.projectId ? ' · ' + esc(projName(c.projectId)) : ''}</small></div></div>
      ${has ? `<div class="fig"><div><b>${nf(c.followers)}</b><span>${c.network === 'youtube' ? 'subscribers' : 'followers'} ${c.followersBefore != null ? delta(c.followers, c.followersBefore) : ''}</span></div><div><b>${nf(c.views || c.reach)}</b><span>${c.views ? 'views' : 'reach'}, 30 days ${delta(c.views || c.reach, c.viewsBefore || c.reachBefore)}</span></div>
        <div><b>${nf(c.posts)}</b><span>posts &amp; reels</span></div><div><b>${nf(c.interactions)}</b><span>interactions</span></div></div><div class="spark">${spark(c.spark, N.c)}</div>`
        : `<div class="fig"><div style="grid-column:1/-1"><span>${['instagram', 'facebook', 'youtube'].includes(c.network) ? 'Connect this channel under Set-up; its figures come in straight away.' : 'Type this channel\'s figures under Set-up.'}</span></div></div>`}
      <div class="foot"><span>${c.updated ? 'Updated ' + day(c.updated) : 'No figures yet'}</span>${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">Open ↗</a>` : ''}</div></div>`;
  }
  // posts waiting for approval, with their design, so Management can look and decide
  const apprGrid = (list) => `<div class="mk-appr">${list.map((p) => { const f = (p.files || []).find((x) => /^image\//.test(x.mime)) || (p.files || [])[0];
    return `<button type="button" class="mk-ap" data-post="${p.id}"><div class="th">${f && /^image\//.test(f.mime) ? `<img src="/api/marketing?pfile=${f.id}" alt="" loading="lazy">` : f ? `<span>${/video/.test(f.mime) ? 'Video' : 'PDF'}</span>` : '<span>No design attached</span>'}</div><b>${esc(p.title)}</b><small>${when(p.publish_at)} · ${chanDots(p)}${(p.files || []).length > 1 ? ` · ${p.files.length} files` : ''}</small></button>`; }).join('')}</div>`;
  function postTile(m) {
    const N = NET[m.network] || NET.website;
    return `<a class="mk-post" href="${esc(m.permalink || '#')}" target="_blank" rel="noopener"><div class="th">${m.has_thumb ? `<img loading="lazy" alt="" src="/api/marketing?img=${encodeURIComponent(m.network + ':' + m.ext_id)}" onerror="this.remove()">` : ''}<span class="net" style="background:${N.c}">${ic(m.network, 'mk-ic', '#fff')}</span>${m.kind && m.kind !== 'post' ? `<span class="kd">${esc(m.kind)}</span>` : ''}</div>
      <div class="cap">${esc(String(m.caption || '').slice(0, 90)) || '<span class="muted">No caption</span>'}</div>
      <div class="st">${m.views != null ? `<span title="Views">▶ ${nf(+m.views)}</span>` : ''}<span title="Likes">♥ ${nf(+m.likes || 0)}</span><span title="Comments">💬 ${nf(+m.comments || 0)}</span>${m.shares ? `<span title="Shares">↗ ${nf(+m.shares)}</span>` : ''}</div><div class="dt">${day(m.posted_at)}</div></a>`;
  }
  const chanDots = (p) => (p.channels || []).map((n) => `<span title="${esc((NET[n] || {}).n || n)}" style="color:${(NET[n] || NET.website).c}">${ic(n)}</span>`).join('');
  const postRow = (p) => `<div class="mk-row" data-post="${p.id}" style="cursor:pointer"><span class="mk-dot" style="background:${ST[p.status][1]}"></span><div style="flex:1;min-width:0"><b style="font-size:14px">${esc(p.title)}</b><div class="small muted">${when(p.publish_at)} · ${KIND[p.kind] || p.kind}${S.scope === 'company' && p.project_id ? ' · ' + esc(projName(p.project_id)) : ''}</div></div><div style="display:flex;gap:4px">${chanDots(p)}</div><span class="mk-pill" style="color:${ST[p.status][1]}">${ST[p.status][0]}</span></div>`;

  // ---------- charts ----------
  const MON = (m) => new Date(m + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short' });
  const MONY = (m) => new Date(m + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
  // bars: one series, or several side by side (series = [{ name, color, values }]); never two scales on one chart
  function bars(months, series, fmt = nf) {
    const W = 640, H = 190, L = 6, B = 22, T = 18, n = months.length, k = series.length;
    const mx = Math.max(1, ...series.flatMap((x) => x.values.map((v) => +v || 0)));
    const slot = (W - L) / n, gw = Math.min(slot - 8, k * 22), bw = (gw - (k - 1) * 2) / k, y = (v) => H - B - ((+v || 0) / mx) * (H - B - T);
    let g = `<line x1="0" x2="${W}" y1="${H - B}" y2="${H - B}" stroke="#EAECF0"/>`;
    months.forEach((m, i) => {
      const x0 = L + i * slot + (slot - gw) / 2;
      series.forEach((sr, j) => {
        const v = +sr.values[i] || 0, x = x0 + j * (bw + 2), top = y(v), h = H - B - top;
        if (h > 0) g += `<path d="M${x},${H - B}V${top + Math.min(4, h)}q0,-4 4,-4h${Math.max(0, bw - 8)}q4,0 4,4V${H - B}Z" fill="${sr.color}" data-tip="${esc(`${MONY(m)} · ${sr.name}: ${fmt(v)}`)}"/>`;
        g += `<rect x="${x}" y="${T}" width="${bw}" height="${H - B - T}" fill="transparent" data-tip="${esc(`${MONY(m)} · ${sr.name}: ${fmt(v)}`)}"/>`;
      });
      g += `<text x="${L + i * slot + slot / 2}" y="${H - 6}" text-anchor="middle">${MON(m)}</text>`;
    });
    if (k === 1) { const vals = series[0].values.map((v) => +v || 0), im = vals.indexOf(Math.max(...vals)); if (vals[im]) g += `<text class="v" x="${L + im * slot + slot / 2}" y="${y(vals[im]) - 5}" text-anchor="middle">${fmt(vals[im])}</text>`; }
    const leg = k > 1 ? `<div class="mk-legend">${series.map((x) => `<span><i style="background:${x.color}"></i>${esc(x.name)}</span>`).join('')}</div>` : '';
    return `${leg}<svg class="mk-chart" viewBox="0 0 ${W} ${H}" width="100%" role="img">${g}</svg>`;
  }
  function tips(root) {
    let tip = null;
    root.addEventListener('mousemove', (e) => { const t = e.target.closest && e.target.closest('[data-tip]'); if (!t) { if (tip) tip.style.display = 'none'; return; } if (!tip) { tip = document.createElement('div'); tip.className = 'mk-tip'; root.appendChild(tip); } tip.textContent = t.dataset.tip; tip.style.display = 'block'; tip.style.left = Math.min(innerWidth - 200, e.clientX + 12) + 'px'; tip.style.top = e.clientY - 34 + 'px'; });
    root.addEventListener('mouseleave', () => { if (tip) tip.style.display = 'none'; });
  }
  function csv(name, rows) {
    const q = (v) => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const blob = new Blob(['\ufeff' + rows.map((r) => r.map(q).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ---------- the 12-month report ----------
  const SER = { instagram: ['Instagram', '#E1306C'], facebook: ['Facebook', '#1877F2'], youtube: ['YouTube', '#E8A200'] };
  async function report() {
    body('<p class="muted">Putting the 12-month report together…</p>');
    if (!S.rep) S.rep = await C.api('/api/marketing?report=' + encodeURIComponent(S.scope));
    const R = S.rep, M = R.months, org = {};
    for (const r of R.organic) (org[r.network] = org[r.network] || {})[r.month] = r.metrics;
    const am = Object.fromEntries(R.adMonths.map((r) => [r.month, r]));
    const lm = {}; for (const r of R.leadMonths) { const x = (lm[r.month] = lm[r.month] || { n: 0, visits: 0, booked: 0 }); x.n += r.n; x.visits += r.visits; x.booked += r.booked; }
    const nets = Object.keys(SER).filter((n) => org[n]);
    const camps = R.campaigns, sum = (a, k) => a.reduce((t, x) => t + (+x[k] || 0), 0);
    const spend = sum(camps, 'spend'), adSpend = sum(camps.filter((c) => c.source === 'meta'), 'spend'), adLeads = sum(camps, 'ad_leads'), imp = sum(camps, 'impressions'), clk = sum(camps, 'clicks'), chats = sum(camps, 'messages');
    const orgViews = nets.reduce((t, n) => t + M.reduce((a, m) => a + (+(org[n][m] || {}).views || 0), 0), 0);
    const fNow = nets.reduce((t, n) => { const last = [...M].reverse().find((m) => org[n][m] && org[n][m].followers != null); return t + (last ? +org[n][last].followers : 0); }, 0);
    const fThen = nets.reduce((t, n) => { const f = M.find((m) => org[n][m] && org[n][m].followers != null); return t + (f ? +org[n][f].followers : 0); }, 0);
    const crm = R.leadMonths.reduce((t, r) => t + r.n, 0), visits = R.leadMonths.reduce((t, r) => t + r.visits, 0), booked = R.leadMonths.reduce((t, r) => t + r.booked, 0);
    const empty = !nets.length && !camps.length && !crm;
    const sortK = S.repSort || 'spend', dir = S.repDir || -1;
    const cs = [...camps].sort((a, b) => { const av = a[sortK], bv = b[sortK]; return (typeof av === 'string' || typeof bv === 'string' ? String(av || '').localeCompare(String(bv || '')) : (+av || 0) - (+bv || 0)) * dir; });
    const cpl = (c) => (+c.ad_leads ? +c.spend / +c.ad_leads : null), ctr = (c) => (+c.impressions ? (+c.clicks / +c.impressions) * 100 : null);
    const COLS = [['name', 'Campaign'], ['project_id', 'For'], ['ext_status', 'Status'], ['spend', 'Spend', 'n'], ['impressions', 'Seen', 'n'], ['reach', 'People reached', 'n'], ['clicks', 'Clicks', 'n'], ['ctr', 'CTR', 'n'], ['ad_leads', 'Leads', 'n'], ['cpl', 'Per lead', 'n'], ['messages', 'Chats', 'n'], ['crm_leads', 'In our Leads', 'n'], ['visits', 'Site visits', 'n'], ['booked', 'Booked', 'n']];
    const val = (c, k) => (k === 'cpl' ? cpl(c) : k === 'ctr' ? ctr(c) : c[k]);
    const show = (c, k) => { const v = val(c, k); if (k === 'name') return `<b>${esc(c.name)}</b>${c.account ? `<div class="small muted">${esc(c.account)}</div>` : c.source === 'manual' ? '<div class="small muted">Typed in</div>' : ''}`; if (k === 'project_id') return esc(projName(c.project_id)); if (k === 'ext_status') return esc(c.ext_status ? String(c.ext_status).replace(/_/g, ' ').toLowerCase() : c.status); if (k === 'spend' || k === 'cpl') return v == null ? '–' : inr(v); if (k === 'ctr') return v == null ? '–' : v.toFixed(2) + '%'; return nf(+v || 0); };
    const months = M.map((m) => ({ m, sp: +(am[m] || {}).spend || 0, ld: +(am[m] || {}).leads || 0, imp: +(am[m] || {}).impressions || 0, clk: +(am[m] || {}).clicks || 0, chats: +(am[m] || {}).messages || 0, crm: (lm[m] || {}).n || 0, visits: (lm[m] || {}).visits || 0, booked: (lm[m] || {}).booked || 0 }));
    const netCols = nets.flatMap((n) => [[n, 'views', `${SER[n][0]} views`], [n, 'followers', `${SER[n][0]} ${n === 'youtube' ? 'subscribers' : 'followers'}`], [n, 'posts', `${SER[n][0]} posts`]]);
    const srcT = {}; for (const r of R.leadMonths) { const x = (srcT[r.source] = srcT[r.source] || { n: 0, visits: 0, booked: 0 }); x.n += r.n; x.visits += r.visits; x.booked += r.booked; }
    body(`<div class="mk-actions"><b style="font-size:15px">${MONY(M[0])} – ${MONY(M[M.length - 1])}</b><span class="muted small">${S.scope === 'company' ? 'Company-wide' : esc(projName(+S.scope))} · social figures are company-wide</span><span style="flex:1"></span>
        <button class="ghost small" id="csvM">Download month by month (CSV)</button><button class="ghost small" id="csvC">Download campaigns (CSV)</button>${D.can.edit && (D.social.meta.connected || D.social.youtube.connected) ? '<button class="ghost small" id="repull">Pull 12 months again</button>' : ''}</div>
      ${empty ? `<div class="mk-empty">Nothing yet. Connect Instagram, Facebook, Meta Ads and YouTube under Set-up: the last 12 months come in at once.</div>` : `
      <div class="mk-kpis">
        <div class="mk-kpi"><span>Ad spend</span><b>${inr(spend)}</b><span>${camps.length} campaign${camps.length === 1 ? '' : 's'}</span></div>
        <div class="mk-kpi"><span>Leads from ads</span><b>${nf(adLeads)}</b><span>${adLeads && adSpend ? inr(adSpend / adLeads) + ' per lead' : ''}</span></div>
        <div class="mk-kpi"><span>WhatsApp / Messenger chats</span><b>${nf(chats)}</b><span>${chats && adSpend ? inr(adSpend / chats) + ' per chat' : 'from ads'}</span></div>
        <div class="mk-kpi"><span>Ads seen</span><b>${nf(imp)}</b><span>${nf(clk)} clicks${imp ? ' · ' + ((clk / imp) * 100).toFixed(2) + '% CTR' : ''}</span></div>
        <div class="mk-kpi"><span>Organic views, all channels</span><b>${nf(orgViews)}</b><span>posts, reels and videos</span></div>
        <div class="mk-kpi"><span>Followers, all channels</span><b>${nf(fNow)}</b>${delta(fNow, fThen)} <span>in 12 months</span></div>
        <div class="mk-kpi"><span>Leads in our list</span><b>${nf(crm)}</b><span>${nf(visits)} site visits · ${nf(booked)} booked</span></div></div>
      <div class="mk-grid2h"><div class="mk-card"><h3>Ad spend by month</h3>${bars(M, [{ name: 'Ad spend', color: '#7A5AF8', values: months.map((x) => x.sp) }], inr)}</div>
        <div class="mk-card"><h3>Leads from ads by month</h3>${bars(M, [{ name: 'Leads', color: '#E1306C', values: months.map((x) => x.ld) }])}</div></div>
      ${nets.length ? `<div class="mk-card"><h3>Organic views by month</h3>${bars(M, nets.map((n) => ({ name: SER[n][0], color: SER[n][1], values: M.map((m) => +(org[n][m] || {}).views || 0) })))}</div>` : ''}
      <div class="mk-card"><h3>Month by month</h3><div class="mk-scroll"><table class="mk-t"><thead><tr><th>Month</th><th class="n">Ad spend</th><th class="n">Ad leads</th><th class="n">Per lead</th><th class="n">Ads seen</th><th class="n">Clicks</th><th class="n">Chats</th>${netCols.map((c) => `<th class="n">${c[2]}</th>`).join('')}<th class="n">Leads in list</th><th class="n">Site visits</th><th class="n">Booked</th></tr></thead>
        <tbody>${months.map((x) => `<tr><td><b>${MONY(x.m)}</b></td><td class="n">${inr(x.sp)}</td><td class="n">${nf(x.ld)}</td><td class="n">${x.ld ? inr(x.sp / x.ld) : '–'}</td><td class="n">${nf(x.imp)}</td><td class="n">${nf(x.clk)}</td><td class="n">${nf(x.chats)}</td>${netCols.map(([n, k]) => `<td class="n">${(org[n][x.m] || {})[k] != null ? nf(+org[n][x.m][k]) : '–'}</td>`).join('')}<td class="n">${nf(x.crm)}</td><td class="n">${nf(x.visits)}</td><td class="n">${nf(x.booked)}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="mk-card"><h3>Every campaign</h3>${cs.length ? `<div class="mk-scroll"><table class="mk-t"><thead><tr>${COLS.map(([k, l, c]) => `<th data-sort="${k}" class="${c || ''}">${l}${sortK === k ? (dir < 0 ? ' ▾' : ' ▴') : ''}</th>`).join('')}</tr></thead><tbody>${cs.map((c) => `<tr>${COLS.map(([k, , cl]) => `<td class="${cl || ''}">${show(c, k)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="muted small" style="margin:0">No campaigns in these months.</p>'}</div>
      <div class="mk-grid2"><div class="mk-card"><h3>Best posts of the year</h3>${R.top.length ? `<div class="mk-posts">${R.top.map(postTile).join('')}</div>` : '<p class="muted small" style="margin:0">Posts come in when the channels are connected.</p>'}</div>
        <div class="mk-card"><h3>Leads by source</h3>${Object.keys(srcT).length ? `<table class="mk-t"><thead><tr><th>Source</th><th class="n">Leads</th><th class="n">Site visits</th><th class="n">Booked</th></tr></thead><tbody>${Object.entries(srcT).sort((a, b) => b[1].n - a[1].n).map(([k, x]) => `<tr><td>${esc(SRC[k] || k)}</td><td class="n">${x.n}</td><td class="n">${x.visits}</td><td class="n">${x.booked}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small" style="margin:0">No leads in these months.</p>'}</div></div>`}`);
    tips($('#mkBody'));
    $$('#mkBody [data-sort]').forEach((th) => (th.onclick = () => { if (S.repSort === th.dataset.sort) S.repDir = -(S.repDir || -1); else { S.repSort = th.dataset.sort; S.repDir = -1; } report(); }));
    if ($('#csvC')) $('#csvC').onclick = () => csv('campaigns-12-months.csv', [COLS.map((c) => c[1]), ...cs.map((c) => COLS.map(([k]) => (k === 'project_id' ? projName(c.project_id) : k === 'cpl' ? (cpl(c) == null ? '' : Math.round(cpl(c))) : k === 'ctr' ? (ctr(c) == null ? '' : ctr(c).toFixed(2)) : val(c, k))))]);
    if ($('#csvM')) $('#csvM').onclick = () => csv('marketing-month-by-month.csv', [['Month', 'Ad spend', 'Ad leads', 'Ads seen', 'Clicks', 'Chats', ...netCols.map((c) => c[2]), 'Leads in list', 'Site visits', 'Booked'], ...months.map((x) => [x.m.slice(0, 7), Math.round(x.sp), x.ld, x.imp, x.clk, x.chats, ...netCols.map(([n, k]) => (org[n][x.m] || {})[k] ?? ''), x.crm, x.visits, x.booked])]);
    if ($('#repull')) $('#repull').onclick = () => pullAll([...(D.social.meta.connected ? ['facebook', 'instagram', 'ads', 'leads'] : []), ...(D.social.youtube.connected ? ['youtube'] : [])], true, 'Pulling 12 months again');
  }

  // ---------- calendar ----------
  function calendar() {
    const now = new Date(); if (!S.month) S.month = new Date(now.getFullYear(), now.getMonth(), 1);
    const m = S.month, first = new Date(m), start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
    const days = []; for (let i = 0; i < 42; i++) { const d = new Date(start); d.setDate(start.getDate() + i); days.push(d); }
    const byDay = {}; for (const p of D.posts) if (p.publish_at) { const k = iso(new Date(p.publish_at)); (byDay[k] = byDay[k] || []).push(p); }
    const undated = D.posts.filter((p) => !p.publish_at);
    const review = D.posts.filter((p) => p.status === 'review');
    body(`<div class="mk-actions">${D.can.edit ? '<button id="newPost">+ Plan a post</button>' : ''}<button class="ghost" id="prevM">‹</button><b style="min-width:150px;text-align:center">${m.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</b><button class="ghost" id="nextM">›</button><button class="ghost" id="todayM">Today</button>
        <span class="muted small" style="margin-left:auto">${Object.entries(ST).map(([, [l, c]]) => `<span class="mk-pill"><span class="mk-dot" style="background:${c}"></span>${l}</span>`).join(' ')}</span></div>
      ${review.length ? `<div class="mk-card" style="border-color:#FEC84B;background:#FFFCF5"><h3>Waiting for approval (${review.length})</h3>${apprGrid(review)}</div>` : ''}
      <div class="mk-cal">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="h">${d}</div>`).join('')}
        ${days.map((d) => { const k = iso(d), ps = byDay[k] || []; return `<div class="d ${d.getMonth() !== m.getMonth() ? 'o' : ''} ${k === iso(now) ? 't' : ''} ${ps.length ? '' : 'e'}" data-day="${k}"><span class="n">${d.getDate()} <span class="muted" style="font-weight:400">${d.toLocaleDateString('en-IN', { weekday: 'short' })}</span></span>${ps.map((p) => `<span class="chip" data-post="${p.id}" style="background:${(NET[(p.channels || [])[0]] || { c: ST[p.status][1] }).c};${p.status === 'published' ? '' : 'opacity:.85;outline:2px dashed #fff8;outline-offset:-3px'}" title="${esc(p.title)} · ${ST[p.status][0]}">${esc(p.title)}</span>`).join('')}</div>`; }).join('')}</div>
      ${undated.length ? `<div class="mk-card" style="margin-top:14px"><h3>Ideas and drafts without a date</h3>${undated.map(postRow).join('')}</div>` : ''}`);
    $('#prevM').onclick = () => { S.month = new Date(m.getFullYear(), m.getMonth() - 1, 1); calendar(); };
    $('#nextM').onclick = () => { S.month = new Date(m.getFullYear(), m.getMonth() + 1, 1); calendar(); };
    $('#todayM').onclick = () => { S.month = null; calendar(); };
    if ($('#newPost')) $('#newPost').onclick = () => postForm(null);
    $$('#mkBody [data-post]').forEach((x) => (x.onclick = (e) => { e.stopPropagation(); postForm(D.posts.find((p) => p.id === +x.dataset.post)); }));
    if (D.can.edit) $$('#mkBody [data-day]').forEach((x) => (x.onclick = () => postForm(null, x.dataset.day)));
  }
  function postForm(p, dayIso) {
    const pr = p || { channels: ['instagram'], status: 'draft', kind: 'post', project_id: S.scope === 'company' ? (D.projects.find((x) => /signature/i.test(x.name)) || {}).id : +S.scope };
    const dt = p && p.publish_at ? new Date(p.publish_at) : dayIso ? new Date(dayIso + 'T11:00') : null;
    const local = dt ? new Date(dt.getTime() - dt.getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : '';
    const ro = !D.can.edit;
    const dl = C.dialog(`<div class="mk-dl"><h2>${p && p.id ? 'Post' : pr.campaign_id ? 'Add a design to the campaign' : 'Plan a post'}</h2>
      <label>Title<input name="title" value="${esc(pr.title)}" required placeholder="e.g. Dream Signature amenities reel" ${ro ? 'disabled' : ''}></label>
      <div class="row"><div><label>For</label><select name="projectId"><option value="company">Company (Dream India)</option>${D.projects.map((x) => `<option value="${x.id}" ${pr.project_id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
        <div><label>Type</label><select name="kind">${Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${pr.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <label>Channels</label><div class="mk-ch">${['instagram', 'facebook', 'youtube', 'linkedin', 'whatsapp', 'website', 'google'].map((n) => `<label><input type="checkbox" name="ch" value="${n}" ${(pr.channels || []).includes(n) ? 'checked' : ''}>${ic(n, 'mk-ic', NET[n].c)}${NET[n].n}</label>`).join('')}</div>
      <div class="row"><div><label>Goes out on</label><input type="datetime-local" name="publishAt" value="${local}"></div><div><label>Status</label><select name="status">${Object.entries(ST).map(([k, [l]]) => `<option value="${k}" ${pr.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <label>Caption</label><textarea name="caption" rows="4" placeholder="Caption and hashtags">${esc(pr.caption)}</textarea>
      <label>Canva design link</label><div style="display:flex;gap:8px"><input name="canvaUrl" value="${esc(pr.canva_url)}" placeholder="https://www.canva.com/design/…" style="flex:1">${pr.canva_url ? `<a class="button ghost" href="${esc(pr.canva_url)}" target="_blank" rel="noopener">Open in Canva ↗</a>` : '<a class="button ghost" href="https://www.canva.com/" target="_blank" rel="noopener">Canva ↗</a>'}</div>
      <div class="row"><div><label>File or video link (Drive)</label><input name="assetUrl" value="${esc(pr.asset_url)}" placeholder="https://drive.google.com/…"></div><div><label>Link to the published post</label><input name="postUrl" value="${esc(pr.post_url)}" placeholder="https://www.instagram.com/p/…"></div></div>
      <div class="row"><div><label>Campaign</label><select name="campaignId"><option value="">—</option>${D.campaigns.map((c) => `<option value="${c.id}" ${pr.campaign_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div><div><label>Note</label><input name="note" value="${esc(pr.note)}"></div></div>
      <div class="mk-design"><label>Design for approval <span class="muted small" style="font-weight:400">· from Canva: Share → Download (PNG, JPG, PDF or MP4, up to 3 MB each)</span></label>
        <div class="mk-files">${(pr.files || []).map((f) => `<div class="mk-file">${/^image\//.test(f.mime) ? `<a href="/api/marketing?pfile=${f.id}" target="_blank" rel="noopener"><img src="/api/marketing?pfile=${f.id}" alt=""></a>` : /^video\//.test(f.mime) ? `<video src="/api/marketing?pfile=${f.id}" controls preload="metadata"></video>` : `<a class="pdf" href="/api/marketing?pfile=${f.id}" target="_blank" rel="noopener">PDF<small>${esc(f.name)}</small></a>`}${D.can.edit ? `<button type="button" class="ghost small" data-rmf="${f.id}">Remove</button>` : ''}</div>`).join('') || (ro ? '<p class="small muted" style="margin:0">No design attached.</p>' : '')}</div>
        ${ro ? '' : '<input type="file" id="pfIn" multiple accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,video/mp4">'}</div>
      ${pr.review_note ? `<p class="mk-back"><b>Sent back:</b> ${esc(pr.review_note)}</p>` : ''}
      ${pr.publish_log && Object.keys(pr.publish_log).filter((k) => k !== '_done').length ? `<div class="mk-plog"><b>Posting</b>${Object.entries(pr.publish_log).filter(([k]) => k !== '_done').map(([n, x]) => `<div>${esc((NET[n] || {}).n || n)}: ${x.id ? `posted ✓ ${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">open ↗</a>` : ''}` : x.pending ? 'Instagram is preparing the video…' : x.manual ? 'post by hand (the design is above)' : `<span style="color:#B42318">not posted: ${esc(x.error)}${x.tries >= 3 ? ' (stopped after 3 tries)' : ' (will try again)'}</span>`}</div>`).join('')}</div>` : ''}
      <input type="hidden" name="send" value="">
      ${D.can.edit && !pr.campaign_id && (!p || !['review', 'published'].includes(p.status)) ? '<p style="margin:10px 0 0"><button type="button" id="sendPost">Save and send for approval</button> <span class="small muted">Management gets an email with the design.</span></p>' : ''}
      ${p && p.status === 'review' && D.can.approve ? '<p style="margin:10px 0 0"><button type="button" id="apprPost">Approve this post</button> <button type="button" class="ghost" id="backPost">Send back with a comment</button></p>' : ''}
      ${p && p.approved_name ? `<p class="small muted">Approved by ${esc(p.approved_name)}.</p>` : ''}${p && p.id ? `<p class="small muted">Planned by ${esc(p.created_name || '')}. ${D.can.edit ? '<a href="#" id="delPost" style="color:#B42318">Delete</a>' : ''}</p>` : ''}</div>`,
    async (x) => {
      if (ro) return;
      const send = x.send === '1'; delete x.send;
      const r = await C.api('/api/marketing', { action: 'post.save', data: { id: p && p.id, ...x, channels: $$('.mk-dl [name=ch]:checked').map((i) => i.value), publishAt: x.publishAt ? new Date(x.publishAt).toISOString() : null } });
      const files = $('#pfIn', dl) ? [...$('#pfIn', dl).files] : [];
      for (const f of files) {
        if (f.size > 3 * 1024 * 1024) { alert(`${f.name} is larger than 3 MB. Put a long video's Google Drive link in "File or video link" instead.`); continue; }
        const data = await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1] || ''); fr.onerror = () => no(new Error('Could not read ' + f.name)); fr.readAsDataURL(f); });
        await C.api('/api/marketing', { action: 'post.file', data: { postId: r.id, name: f.name, mime: f.type, data } });
      }
      if (send) { const s2 = await C.api('/api/marketing', { action: 'post.send', data: { id: r.id } }); C.toast(s2.mail && s2.mail.to ? 'Sent for approval. Management has been emailed.' : 'Sent for approval.'); }
      else if (r.status === 'review' && x.status !== 'review') C.toast('Saved. It goes out once Management approves it.'); else C.toast('Saved.');
      await load(); paint();
    });
    const sp = $('#sendPost', dl); if (sp) sp.onclick = () => { $('[name=send]', dl).value = '1'; $('form', dl).requestSubmit(); };
    const bp = $('#backPost', dl); if (bp) bp.onclick = async () => { const note = prompt('What should change?'); if (!note || !note.trim()) return; await C.api('/api/marketing', { action: 'post.sendback', data: { id: p.id, note } }); dl.close(); dl.remove(); C.toast('Sent back to the marketing team.'); await load(); paint(); };
    $$('[data-rmf]', dl).forEach((b) => (b.onclick = async () => { if (!confirm('Remove this file?')) return; await C.api('/api/marketing', { action: 'post.file.delete', data: { id: +b.dataset.rmf } }); b.closest('.mk-file').remove(); await load(); }));
    const ap = $('#apprPost', dl); if (ap) ap.onclick = async () => { await C.api('/api/marketing', { action: 'post.status', data: { id: p.id, status: 'approved' } }); dl.close(); dl.remove(); C.toast('Approved.'); await load(); paint(); };
    const dp = $('#delPost', dl); if (dp) dp.onclick = async (e) => { e.preventDefault(); if (!confirm('Delete this post from the calendar?')) return; await C.api('/api/marketing', { action: 'post.delete', data: { id: p.id } }); dl.close(); dl.remove(); await load(); paint(); };
  }

  // ---------- leads ----------
  function leads() {
    const q = S.leadQ.toLowerCase();
    const list = D.leads.filter((l) => (S.leadF === 'all' || l.status === S.leadF || (S.leadF === 'due' && l.next_date && l.next_date.slice(0, 10) <= iso(new Date()))) && (!q || [l.name, l.phone, l.email, l.note].some((v) => String(v || '').toLowerCase().includes(q))));
    const cnt = (s) => D.leads.filter((l) => l.status === s).length;
    body(`<div class="mk-actions"><button id="newLead">+ Add a lead</button><input id="lq" placeholder="Search name, phone, email" value="${esc(S.leadQ)}" style="max-width:260px"></div>
      <div class="mk-chips">${[['all', `All ${D.leads.length}`], ['due', 'Call today'], ...Object.entries(LST).map(([k, [l]]) => [k, `${l} ${cnt(k)}`])].map(([k, l]) => `<button data-lf="${k}" aria-pressed="${S.leadF === k}">${esc(l)}</button>`).join('')}</div>
      <div class="mk-card" style="padding:6px 10px;overflow-x:auto">${list.length ? `<table class="mk-t"><tr><th>Lead</th><th>Source</th><th>For</th><th>Status</th><th>Next call</th><th>With</th><th></th></tr>${list.slice(0, 400).map((l) => `<tr><td><b>${esc(l.name || '—')}</b><div class="small muted">${esc(l.phone || '')}${l.email ? ' · ' + esc(l.email) : ''}</div></td><td><span class="mk-pill">${esc(SRC[l.source] || l.source)}</span>${l.campaign_name ? `<div class="small muted">${esc(l.campaign_name)}</div>` : ''}</td><td class="small">${esc(projName(l.project_id))}</td>
        <td><span class="mk-pill" style="color:${LST[l.status][1]}"><span class="mk-dot" style="background:${LST[l.status][1]}"></span>${LST[l.status][0]}</span>${l.is_buyer ? ' <span class="mk-pill" style="background:#ECFDF3;color:#067647">Buyer in CRM ✓</span>' : ''}</td><td class="small">${l.next_date ? day(l.next_date) : ''}</td><td class="small">${esc(l.assigned_name || '')}</td>
        <td style="white-space:nowrap">${l.phone ? `<a href="tel:+91${esc(l.phone)}" title="Call">📞</a> <a href="https://wa.me/91${esc(l.phone)}" target="_blank" rel="noopener" title="WhatsApp">💬</a> ` : ''}<button class="ghost small" data-lead="${l.id}">Open</button></td></tr>`).join('')}</table>` : '<div class="mk-empty">No leads here yet. Add one, or connect the website form and ad forms under Set-up.</div>'}</div>`);
    $('#newLead').onclick = () => leadForm(null);
    $('#lq').oninput = (e) => { S.leadQ = e.target.value; clearTimeout(S.t); S.t = setTimeout(() => { leads(); const i = $('#lq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
    $$('#mkBody [data-lf]').forEach((b) => (b.onclick = () => { S.leadF = b.dataset.lf; leads(); }));
    $$('#mkBody [data-lead]').forEach((b) => (b.onclick = () => leadForm(D.leads.find((l) => l.id === +b.dataset.lead))));
  }
  function leadForm(l) {
    const x = l || { status: 'new', source: 'instagram', project_id: S.scope === 'company' ? (D.projects.find((p) => /signature/i.test(p.name)) || {}).id : +S.scope };
    const dl = C.dialog(`<div class="mk-dl"><h2>${l ? 'Lead' : 'Add a lead'}</h2>
      <div class="row"><div><label>Name</label><input name="name" value="${esc(x.name)}"></div><div><label>Mobile</label><input name="phone" value="${esc(x.phone)}" inputmode="tel"></div></div>
      <div class="row"><div><label>Email</label><input name="email" value="${esc(x.email)}"></div><div><label>For</label><select name="projectId"><option value="company">Company</option>${D.projects.map((p) => `<option value="${p.id}" ${x.project_id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div></div>
      <div class="row"><div><label>Came from</label><select name="source">${Object.entries(SRC).map(([k, v]) => `<option value="${k}" ${x.source === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div><div><label>Campaign</label><select name="campaignId"><option value="">—</option>${D.campaigns.map((c) => `<option value="${c.id}" ${x.campaign_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div></div>
      <div class="row"><div><label>Status</label><select name="status">${Object.entries(LST).map(([k, [v]]) => `<option value="${k}" ${x.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div><div><label>Next call</label><input type="date" name="nextDate" value="${esc((x.next_date || '').slice(0, 10))}"></div></div>
      <label>Handled by</label><select name="assignedTo"><option value="">—</option>${D.team.map((u) => `<option value="${u.id}" ${x.assigned_to === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>
      <label>Notes</label><textarea name="note" rows="3">${esc(x.note)}</textarea>
      ${l ? `<p class="small muted">Added ${day(l.created_at)}. ${D.can.edit ? '<a href="#" id="delLead" style="color:#B42318">Delete</a>' : ''}</p>` : ''}</div>`,
    async (v) => {
      try { await C.api('/api/marketing', { action: 'lead.save', data: { id: l && l.id, ...v } }); }
      catch (e) { if (e.data && e.data.duplicate && confirm(e.message + ' Add it again anyway?')) await C.api('/api/marketing', { action: 'lead.save', data: { ...v, force: true } }); else throw e; }
      C.toast('Saved.'); await load(); paint();
    });
    const dlb = $('#delLead', dl); if (dlb) dlb.onclick = async (e) => { e.preventDefault(); if (!confirm('Delete this lead?')) return; await C.api('/api/marketing', { action: 'lead.delete', data: { id: l.id } }); dl.close(); dl.remove(); await load(); paint(); };
  }

  // ---------- campaigns ----------
  // ---------- active campaigns: where the money is going now ----------
  async function active() {
    body('<p class="muted">Loading…</p>');
    const A = await C.api('/api/marketing?active=1&scope=' + encodeURIComponent(S.scope)), T = A.totals;
    const sk = S.actSort || 'spend30', dir = S.actDir || -1;
    const rows = [...A.rows].sort((a, b) => (typeof a[sk] === 'string' ? String(a[sk] || '').localeCompare(String(b[sk] || '')) : ((+a[sk] || 0) - (+b[sk] || 0))) * dir);
    const COLS = [['name', 'Campaign'], ['project', 'For'], ['src', 'Where'], ['daily_budget', 'Daily budget', 'inr'], ['yesterday', 'Yesterday', 'inr'], ['spend7', 'Last 7 days', 'inr'], ['spend30', 'Last 30 days', 'inr'], ['month', 'This month', 'inr'], ['pace', 'Of monthly budget', 'pct'], ['fy', 'This year', 'inr'], ['leads30', 'Leads, 30 days', 'n'], ['cpl30', 'Per lead', 'inr'], ['chats30', 'Chats, 30 days', 'n'], ['end_on', 'Ends', 'date']];
    const f = (v, t) => (v == null || v === '' ? '–' : t === 'inr' ? inr(+v) : t === 'n' ? nf(+v) : t === 'pct' ? Math.round(v * 100) + '%' : t === 'date' ? day(v) : esc(v));
    body(`<div class="mk-kpis">
        <div class="mk-kpi"><span>Active campaigns</span><b>${nf(T.campaigns)}</b><span>${T.daily ? inr(T.daily) + ' a day budgeted' : ''}</span></div>
        <div class="mk-kpi"><span>Spent yesterday</span><b>${inr(T.yesterday)}</b></div>
        <div class="mk-kpi"><span>Spent, last 30 days</span><b>${inr(T.spend30)}</b></div>
        <div class="mk-kpi"><span>Spent this month</span><b>${inr(T.month)}</b></div>
        <div class="mk-kpi"><span>Spent this financial year</span><b>${inr(T.fy)}</b></div>
        <div class="mk-kpi"><span>Leads, last 30 days</span><b>${nf(T.leads30)}</b><span>${T.leads30 && T.spend30 ? inr(T.spend30 / T.leads30) + ' per lead' : ''}${T.chats30 ? ' · ' + nf(T.chats30) + ' chats' : ''}</span></div></div>
      <div class="mk-card"><h3>Where the money is going</h3><p class="small muted" style="margin:0 0 8px">Every campaign running now. Meta Ads figures come in by themselves each morning; others are as typed in. Click a campaign for its spend day by day.</p>
        ${rows.length ? `<div style="overflow-x:auto"><table class="mk-t"><tr>${COLS.map(([k, l, t]) => `<th data-as="${k}" style="cursor:pointer;white-space:nowrap;${t && t !== 'date' ? 'text-align:right' : ''}">${l}${sk === k ? (dir < 0 ? ' ▾' : ' ▴') : ''}</th>`).join('')}</tr>
          ${rows.map((r) => `<tr data-ac="${r.id}" data-meta="${r.source === 'meta' ? 1 : ''}" style="cursor:pointer">${COLS.map(([k, , t]) => `<td style="${t && t !== 'date' ? 'text-align:right;white-space:nowrap' : ''}">${k === 'src' ? (r.source === 'meta' ? 'Meta Ads' : esc((r.channels || []).map((n) => (NET[n] || {}).n || n).join(', ') || 'Other')) : k === 'pace' && r.pace != null ? `<span style="color:${r.pace > 1 ? '#B42318' : '#067647'};font-weight:700">${f(r.pace, 'pct')}</span>` : f(r[k], t)}</td>`).join('')}</tr>`).join('')}
          <tr style="font-weight:700"><td>Total</td><td></td><td></td><td style="text-align:right">${inr(T.daily)}</td><td style="text-align:right">${inr(T.yesterday)}</td><td></td><td style="text-align:right">${inr(T.spend30)}</td><td style="text-align:right">${inr(T.month)}</td><td></td><td style="text-align:right">${inr(T.fy)}</td><td style="text-align:right">${nf(T.leads30)}</td><td></td><td style="text-align:right">${nf(T.chats30)}</td><td></td></tr></table></div>` : '<div class="mk-empty">No campaign is running right now.</div>'}</div>`);
    $$('#mkBody [data-as]').forEach((th) => (th.onclick = () => { if (S.actSort === th.dataset.as) S.actDir = -(S.actDir || -1); else { S.actSort = th.dataset.as; S.actDir = -1; } active(); }));
    $$('#mkBody [data-ac]').forEach((tr) => (tr.onclick = () => { if (tr.dataset.meta) mdrill('campaign', 'c' + tr.dataset.ac); else campForm(D.campaigns.find((c) => c.id === +tr.dataset.ac)); }));
  }

  // ---------- campaigns: plan → designs → budget → approval → calendar → posted ----------
  const PLAN = { draft: ['Being planned', '#667085'], submitted: ['Waiting for approval', '#DC6803'], partly: ['Partly approved', '#7A5AF8'], approved: ['Approved', '#12B76A'], sent_back: ['Sent back', '#B42318'] };
  function campaigns() {
    const plans = D.campaigns.filter((c) => c.source !== 'meta'), meta = D.campaigns.filter((c) => c.source === 'meta');
    const des = (c) => D.posts.filter((p) => p.campaign_id === c.id);
    const thumb = (p) => { const f = (p.files || []).find((x) => /^image\//.test(x.mime)) || (p.files || [])[0];
      return `<button type="button" class="mk-dz" data-post="${p.id}" title="${esc(p.title)}">${f && /^image\//.test(f.mime) ? `<img src="/api/marketing?pfile=${f.id}" alt="" loading="lazy">` : `<span>${f ? (/video/.test(f.mime) ? 'Video' : 'PDF') : 'No file'}</span>`}<em style="background:${ST[p.status][1]}">${ST[p.status][0]}</em><small>${p.publish_at ? day(p.publish_at) : 'no date'} ${chanDots(p)}</small></button>`; };
    const card = (c) => { const ps = PLAN[c.plan_status] || PLAN.draft, d = des(c), ok = (x) => `<span class="mk-ok ${x ? 'y' : ''}">${x ? '✓' : '…'}</span>`;
      return `<div class="mk-plan"><div class="c1"><div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><h3>${esc(c.name)}</h3><span class="mk-pill" style="color:${ps[1]}">${ps[0]}</span></div>
          <div class="small muted">${esc(projName(c.project_id))}${c.start_on ? ' · ' + day(c.start_on) : ''}${c.end_on ? ' – ' + day(c.end_on) : ''}</div><div style="margin:6px 0">${(c.channels || []).map((n) => `<span style="color:${(NET[n] || NET.website).c}">${ic(n)}</span>`).join(' ')}</div>
          <p class="brief">${esc(c.brief || 'No description yet.')}</p>${c.review_note ? `<p class="mk-back" style="margin:6px 0 0"><b>Sent back:</b> ${esc(c.review_note)}</p>` : ''}
          ${D.can.edit ? `<button class="ghost small" data-camp="${c.id}">Change</button>` : ''}</div>
        <div class="c2"><h4>Designs (${d.length})</h4><div class="mk-dzs">${d.map(thumb).join('')}${D.can.edit && c.plan_status !== 'approved' ? `<button type="button" class="mk-dz add" data-adddes="${c.id}"><span>+ Add design</span></button>` : ''}</div></div>
        <div class="c3"><h4>Budget</h4><div class="bg"><b>${inr(c.daily_budget)}</b><span>a day</span></div><div class="bg"><b>${inr(c.monthly_budget)}</b><span>a month</span></div>${c.budget ? `<div class="bg"><b>${inr(c.budget)}</b><span>in all</span></div>` : ''}${+c.spent ? `<div class="small muted">Spent so far ${inr(c.spent)}</div>` : ''}</div>
        <div class="c4"><h4>Approval</h4><div class="mk-okrow">${ok(c.designs_ok_at)} Designs${c.designs_ok_name ? ` <small>${esc(c.designs_ok_name)}</small>` : ''}</div><div class="mk-okrow">${ok(c.budget_ok_at)} Budget${c.budget_ok_name ? ` <small>${esc(c.budget_ok_name)}</small>` : ''}</div>
          ${D.can.approve && ['submitted', 'partly'].includes(c.plan_status) ? `${!c.designs_ok_at ? `<button class="small" data-ap="designs" data-c="${c.id}">Approve designs</button>` : ''}${!c.budget_ok_at ? `<button class="small" data-ap="budget" data-c="${c.id}">Approve budget</button>` : ''}<button class="ghost small" data-back="${c.id}">Send back</button>` : ''}
          ${D.can.edit && ['draft', 'sent_back'].includes(c.plan_status) ? `<button class="small" data-submit="${c.id}">Send for approval</button><p class="small muted" style="margin:4px 0 0">You get an email with approve buttons.</p>` : ''}
          ${c.plan_status === 'approved' ? '<p class="small" style="margin:4px 0 0;color:#067647">The designs are in the calendar and post on their dates.</p>' : ''}</div></div>`; };
    body(`<div class="mk-actions">${D.can.edit ? '<button id="newCamp">+ New campaign</button>' : ''}<span class="muted small">Plan the campaign, add its Canva designs and the budget, and send it for approval. Once the designs and the budget are approved, the designs go to the calendar and post on their dates.</span></div>
      ${plans.length ? plans.map(card).join('') : '<div class="mk-empty">No campaigns yet. Press "+ New campaign".</div>'}
      ${meta.length ? `<h3 style="margin:22px 0 8px;color:#10114e;font-size:15px">Running on Meta Ads</h3><div class="mk-camp">${meta.map((c) => { const ld = Math.max(+c.ad_leads || 0, c.leads || 0), sp = +c.spent || 0;
        return `<div class="mk-card" style="margin:0"><div style="display:flex;justify-content:space-between;gap:8px"><h3 style="margin:0">${esc(c.name)}</h3><span class="mk-pill">${esc(String(c.ext_status || c.status).toLowerCase())}</span></div><div class="small muted">${esc(projName(c.project_id))} · ${nf(+c.impressions || 0)} seen · ${nf(+c.clicks || 0)} clicks</div>
          <div class="mk-funnel" style="margin-top:10px"><div><b>${inr(sp)}</b><span>Spent</span></div><div><b>${ld}</b><span>Leads</span></div><div><b>${ld && sp ? inr(sp / ld) : '–'}</b><span>Per lead</span></div><div><b>${nf(+c.messages || 0)}</b><span>Chats</span></div></div></div>`; }).join('')}</div>` : ''}`);
    if ($('#newCamp')) $('#newCamp').onclick = () => campForm(null);
    $$('#mkBody [data-camp]').forEach((b) => (b.onclick = () => campForm(D.campaigns.find((c) => c.id === +b.dataset.camp))));
    $$('#mkBody [data-post]').forEach((b) => (b.onclick = () => postForm(D.posts.find((p) => p.id === +b.dataset.post))));
    $$('#mkBody [data-adddes]').forEach((b) => (b.onclick = () => { const c = D.campaigns.find((x) => x.id === +b.dataset.adddes); postForm({ campaign_id: c.id, project_id: c.project_id, channels: (c.channels && c.channels.length ? c.channels : ['instagram', 'facebook']), status: 'draft', kind: 'post', title: c.name + ': ' }); }));
    $$('#mkBody [data-submit]').forEach((b) => (b.onclick = async () => { try { const r = await C.api('/api/marketing', { action: 'campaign.submit', data: { id: +b.dataset.submit } }); const m = Object.values(r.mail || {})[0] || {}; C.toast(m.to ? 'Sent for approval: Management has been emailed.' : 'Sent for approval.'); await load(); paint(); } catch (e) { alert(e.message); } }));
    $$('#mkBody [data-ap]').forEach((b) => (b.onclick = async () => { const r = await C.api('/api/marketing', { action: 'campaign.approve', data: { id: +b.dataset.c, kind: b.dataset.ap } }); C.toast(r.designs && r.budget ? `Approved: ${r.scheduled} designs are in the calendar.` : 'Approved.'); await load(); paint(); }));
    $$('#mkBody [data-back]').forEach((b) => (b.onclick = async () => { const note = prompt('What should change?'); if (!note || !note.trim()) return; await C.api('/api/marketing', { action: 'campaign.sendback', data: { id: +b.dataset.back, note } }); C.toast('Sent back.'); await load(); paint(); }));
  }
  function campForm(c) {
    const x = c || { status: 'planned', channels: ['instagram', 'facebook'], project_id: S.scope === 'company' ? (D.projects.find((p) => /signature/i.test(p.name)) || {}).id : +S.scope };
    const metaC = x.source === 'meta';
    const dl = C.dialog(`<div class="mk-dl"><h2>${c ? 'Campaign' : 'New campaign'}</h2><label>Name<input name="name" value="${esc(x.name)}" required placeholder="e.g. Dream Signature Diwali site visits" ${metaC ? 'readonly' : ''}></label>
      <label>What the campaign is about</label><textarea name="brief" rows="4" placeholder="The idea, the offer, who it is for, the message, what we want people to do">${esc(x.brief)}</textarea>
      <div class="row"><div><label>For</label><select name="projectId"><option value="company">Company</option>${D.projects.map((p) => `<option value="${p.id}" ${x.project_id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
        <div><label>Runs from</label><input type="date" name="startOn" value="${esc((x.start_on || '').slice(0, 10))}" ${metaC ? 'readonly' : ''}></div><div><label>to</label><input type="date" name="endOn" value="${esc((x.end_on || '').slice(0, 10))}" ${metaC ? 'readonly' : ''}></div></div>
      <label>Channels</label><div class="mk-ch">${['instagram', 'facebook', 'youtube', 'linkedin', 'whatsapp', 'google', 'website'].map((n) => `<label><input type="checkbox" name="ch" value="${n}" ${(x.channels || []).includes(n) ? 'checked' : ''}>${ic(n, 'mk-ic', NET[n].c)}${NET[n].n}</label>`).join('')}</div>
      <div class="row"><div><label>Daily budget ₹</label><input name="dailyBudget" inputmode="decimal" value="${x.daily_budget ?? ''}"></div><div><label>Monthly budget ₹</label><input name="monthlyBudget" inputmode="decimal" value="${x.monthly_budget ?? ''}"></div><div><label>Total budget ₹</label><input name="budget" inputmode="decimal" value="${x.budget ?? ''}" ${metaC ? 'readonly' : ''}></div></div>
      ${metaC ? '' : `<div class="row"><div><label>Spent so far ₹ (print, portals, events)</label><input name="spent" inputmode="decimal" value="${x.spent ?? ''}"></div><div><label>Site visits (if not tracked on leads)</label><input name="visits" inputmode="numeric" value="${x.visits ?? ''}"></div></div>`}
      <label>Note</label><input name="note" value="${esc(x.note)}">${c && !metaC ? '<p class="small"><a href="#" id="delCamp" style="color:#B42318">Delete campaign</a></p>' : ''}
      ${c && ['submitted', 'partly', 'approved'].includes(c.plan_status) ? '<p class="small muted">Changing the daily or monthly budget sends the budget for approval again.</p>' : ''}</div>`,
    async (v) => { const r = await C.api('/api/marketing', { action: 'campaign.save', data: { id: c && c.id, ...v, channels: $$('.mk-dl [name=ch]:checked').map((i) => i.value), status: x.status } }); C.toast(c ? 'Saved.' : 'Campaign created: now add its designs.'); await load(); paint(); return r; });
    const db = $('#delCamp', dl); if (db) db.onclick = async (e) => { e.preventDefault(); if (!confirm('Delete this campaign? Its posts and leads stay.')) return; await C.api('/api/marketing', { action: 'campaign.delete', data: { id: c.id } }); dl.close(); dl.remove(); await load(); paint(); };
  }

  // ---------- design library ----------
  const kindOf = (f) => { const t = `${f.folder} ${f.name}`; for (const [k, , re] of LIB) if (re.test(t)) return k; return /\.pdf$/i.test(f.name) ? 'brochure' : /image\//.test(f.mime) ? 'render' : 'other'; };
  async function library() {
    const key = S.scope;
    body('<p class="muted">Opening the Google Drive folder…</p>');
    if (S.libFor !== key) { S.lib = await C.api('/api/marketing?library=' + encodeURIComponent(key)).catch((e) => ({ files: [], error: e.message })); S.libFor = key; S.libF = 'all'; }
    const L = S.lib;
    if (!L.folder) return body(`<div class="mk-empty">No Google Drive folder is linked for ${esc(key === 'company' ? 'the company' : projName(+key))} yet.<br>Keep brochures, floor plans, elevations, renders and amenity images in one Drive folder (sub-folders are fine), then paste its link under Set-up.</div>`);
    if (L.error) return body(`<div class="mk-empty">The ERP cannot open the Drive folder yet: ${esc(L.error)}<br>Share the folder with <b>${esc(L.share || 'the ERP\'s Google account')}</b> as Viewer.</div>`);
    const files = L.files.map((f) => ({ ...f, k: kindOf(f) }));
    const cnt = {}; for (const f of files) cnt[f.k] = (cnt[f.k] || 0) + 1;
    const cats = [['all', 'Everything'], ...LIB.map(([k, l]) => [k, l]), ['other', 'Other']].filter(([k]) => k === 'all' || cnt[k]);
    const show = files.filter((f) => S.libF === 'all' || f.k === S.libF).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    body(`<div class="mk-actions"><a class="button ghost" href="https://drive.google.com/drive/folders/${esc(L.folder)}" target="_blank" rel="noopener">Open the folder in Drive ↗</a><a class="button ghost" href="https://www.canva.com/" target="_blank" rel="noopener">Canva ↗</a><span class="muted small">${files.length} files. Add or replace files in Drive; they show here straight away.</span></div>
      <div class="mk-chips">${cats.map(([k, l]) => `<button data-lk="${k}" aria-pressed="${S.libF === k}">${esc(l)}${k === 'all' ? ' ' + files.length : ' ' + cnt[k]}</button>`).join('')}</div>
      <div class="mk-lib">${show.slice(0, 300).map((f) => `<a href="${esc(f.link)}" target="_blank" rel="noopener"><div class="th" ${f.thumb ? `data-th="${esc(f.id)}"` : ''}>${f.thumb ? '' : esc((f.name.split('.').pop() || 'file').toUpperCase())}</div><div class="nm">${esc(f.name)}<small>${esc(f.folder || '')}${f.folder ? ' · ' : ''}${day(f.at)}</small></div></a>`).join('') || '<div class="mk-empty">Nothing in this group.</div>'}</div>`);
    $$('#mkBody [data-lk]').forEach((b) => (b.onclick = () => { S.libF = b.dataset.lk; library(); }));
    // previews load as they come into view
    const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { const el = e.target; el.style.backgroundImage = `url(/api/marketing?thumb=${encodeURIComponent(el.dataset.th)})`; io.unobserve(el); } }), { rootMargin: '200px' }) : null;
    $$('#mkBody [data-th]').forEach((el) => (io ? io.observe(el) : (el.style.backgroundImage = `url(/api/marketing?thumb=${encodeURIComponent(el.dataset.th)})`)));
  }

  // ---------- tasks ----------
  function tasks() {
    body(`${D.can.edit ? `<div class="mk-card"><div class="row" style="grid-template-columns:2fr 1fr 1fr auto;align-items:end"><div><label>New task</label><input id="tt" placeholder="e.g. Shoot the sample flat reel"></div><div><label>By</label><input type="date" id="td"></div><div><label>Who</label><select id="tw"><option value="">—</option>${D.team.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></div><button id="ta" style="margin-bottom:6px">Add</button></div></div>` : ''}
      <div class="mk-card">${D.tasks.map((t) => `<div class="mk-row"><input type="checkbox" data-task="${t.id}" ${t.done_at ? 'checked' : ''} ${D.can.edit ? '' : 'disabled'} style="width:auto;margin:0"><div style="flex:1;${t.done_at ? 'text-decoration:line-through;color:#98A2B3' : ''}"><b style="font-size:14px">${esc(t.title)}</b><div class="small muted">${t.due ? 'By ' + day(t.due) : ''}${t.assigned_name ? ' · ' + esc(t.assigned_name) : ''}${S.scope === 'company' && t.project_id ? ' · ' + esc(projName(t.project_id)) : ''}</div></div>${t.due && !t.done_at && t.due.slice(0, 10) < iso(new Date()) ? '<span class="mk-pill" style="color:#B42318">Late</span>' : ''}${D.can.edit ? `<button class="ghost small" data-tdel="${t.id}">×</button>` : ''}</div>`).join('') || '<p class="muted" style="margin:0">No tasks. Add the week\'s shoots, designs and posts here.</p>'}</div>`);
    if ($('#ta')) $('#ta').onclick = async () => { const t = $('#tt').value.trim(); if (!t) return; await C.api('/api/marketing', { action: 'task.save', data: { title: t, due: $('#td').value, assignedTo: $('#tw').value, projectId: S.scope } }); await load(); tasks(); };
    $$('#mkBody [data-task]').forEach((x) => (x.onchange = async () => { await C.api('/api/marketing', { action: 'task.done', data: { id: +x.dataset.task, undo: !x.checked } }); await load(); tasks(); }));
    $$('#mkBody [data-tdel]').forEach((x) => (x.onclick = async () => { await C.api('/api/marketing', { action: 'task.delete', data: { id: +x.dataset.tdel } }); await load(); tasks(); }));
  }

  // ---------- set-up ----------
  function setup() {
    const s = D.settings, SO = D.social;
    const chRow = (c = {}) => `<div class="row chrow" style="grid-template-columns:150px 1fr 1.4fr 170px auto;align-items:end"><div><label>Channel</label><select data-c="network">${Object.entries(NET).map(([k, v]) => `<option value="${k}" ${c.network === k ? 'selected' : ''}>${v.n}</option>`).join('')}</select></div><div><label>Handle</label><input data-c="handle" value="${esc(c.handle)}" placeholder="dreamindiarealty"></div><div><label>Link</label><input data-c="url" value="${esc(c.url)}" placeholder="https://…"></div><div><label>For</label><select data-c="projectId"><option value="">Company</option>${D.projects.map((p) => `<option value="${p.id}" ${c.projectId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div><button type="button" class="ghost small" data-rmch style="margin-bottom:8px">×</button></div>`;
    const exp = SO.meta.expires ? Math.round((Date.parse(SO.meta.expires) - Date.now()) / 864e5) : null;
    body(`<div class="mk-card"><h3>Connected channels</h3>
        <div class="mk-row"><span style="display:flex;gap:4px"><span style="color:#1877F2">${ic('facebook')}</span><span style="color:#E1306C">${ic('instagram')}</span></span><div style="flex:1;min-width:0"><b>Facebook, Instagram and Meta Ads</b>
          <div class="small muted">${SO.meta.connected ? `Connected by ${esc(SO.meta.name || '')} on ${day(SO.meta.at)}: ${SO.meta.pages.map((p) => esc(p.name) + (p.instagram ? ' + @' + esc(p.instagram) : '')).join(', ') || 'no page'}${SO.meta.ads.length ? ' · ads: ' + SO.meta.ads.map((a) => esc(a.name)).join(', ') : ' · no ad account'}${exp != null ? ` · <span style="${exp < 10 ? 'color:#B42318;font-weight:700' : ''}">connect again within ${Math.max(0, exp)} days</span>` : ''}` : SO.meta.configured ? 'Not connected. Press Connect and sign in with the Facebook login that manages the Dream India page, Instagram and ad account; tick all of them.' : 'Needs the Meta app first (see "How to set it up" below).'}${SO.meta.error ? `<br><b style="color:#B42318">${esc(SO.meta.error)}</b>` : ''}${SO.meta.lastFail && (!SO.meta.at || SO.meta.lastFail.at > SO.meta.at) ? `<br><b style="color:#B42318">Last try to connect (${when(SO.meta.lastFail.at)}) did not work: ${esc(SO.meta.lastFail.message)}</b>` : ''}</div></div>
          ${D.can.edit && SO.meta.configured ? `<a class="btn ${SO.meta.connected ? 'ghost' : ''} small" href="/api/marketing?connect=meta">${SO.meta.connected ? 'Connect again' : 'Connect with Facebook'}</a>` : ''}${D.can.edit && SO.meta.connected ? '<button class="ghost small" data-disc="meta">Disconnect</button>' : ''}</div>
        <div class="mk-row"><span style="color:#FF0000">${ic('youtube')}</span><div style="flex:1;min-width:0"><b>YouTube</b><div class="small muted">${SO.youtube.connected ? `Connected: ${esc(SO.youtube.title)}${SO.youtube.handle ? ' (@' + esc(SO.youtube.handle) + ')' : ''} on ${day(SO.youtube.at)}` : SO.youtube.configured ? 'Not connected. Press Connect and sign in with the Google account that owns the Dream India channel.' : 'Needs the ERP\'s Google sign-in (already used for Customer documents).'}${SO.youtube.error ? `<br><b style="color:#B42318">${esc(SO.youtube.error)}</b>` : ''}${SO.youtube.lastFail && (!SO.youtube.at || SO.youtube.lastFail.at > SO.youtube.at) ? `<br><b style="color:#B42318">Last try to connect (${when(SO.youtube.lastFail.at)}) did not work: ${esc(SO.youtube.lastFail.message)}</b>` : ''}</div></div>
          ${D.can.edit && SO.youtube.configured ? `<a class="btn ${SO.youtube.connected ? 'ghost' : ''} small" href="/api/marketing?connect=youtube">${SO.youtube.connected ? 'Connect again' : 'Connect YouTube'}</a>` : ''}${D.can.edit && SO.youtube.connected ? '<button class="ghost small" data-disc="youtube">Disconnect</button>' : ''}</div>
        <div class="mk-row"><span style="color:#0A66C2">${ic('linkedin')}</span><div style="flex:1"><b>LinkedIn, Google Business Profile, portals</b><div class="small muted">Their figures are typed in below for now. LinkedIn and Google give this data only to approved apps; it can be added once approved.</div></div></div>
        ${SO.lastSync ? `<p class="small muted" style="margin:10px 0 0">Last pull ${when(SO.lastSync.at)}${SO.lastSync.errors && SO.lastSync.errors.length ? ` · <span style="color:#B42318">${esc(SO.lastSync.errors.join(' · '))}</span>` : ''}${SO.lastSync.missing && SO.lastSync.missing.length ? ` · not available: ${esc(SO.lastSync.missing.join(', '))}` : ''}</p>` : ''}
        ${D.can.edit && (SO.meta.connected || SO.youtube.connected) ? '<div class="mk-actions" style="margin:10px 0 0"><button class="ghost" id="syncNow">Pull the figures now</button><span class="small muted">Every morning the ERP pulls yesterday\'s figures by itself.</span></div>' : ''}
        ${!SO.meta.configured ? `<details style="margin-top:12px"><summary><b>How to set it up (once, about 15 minutes)</b></summary><ol class="small" style="margin:8px 0 0;padding-left:18px;line-height:1.6">
          <li>On developers.facebook.com, sign in with the Facebook login that is admin of the Dream India page and ad account. Create an app ("Other" → "Business"), named "Dream India ERP", linked to the Dream India business.</li>
          <li>Add the products Facebook Login, Instagram (Graph API) and Marketing API. Under Facebook Login → Settings, add this redirect address: <code style="user-select:all">${esc(SO.metaRedirect || location.origin + '/oauth/meta')}</code></li>
          <li>Under App settings → Basic, copy the App ID and App secret. In Vercel (dream-india-erp → Settings → Environment Variables) add them yourself as <b>META_APP_ID</b> and <b>META_APP_SECRET</b>, then redeploy. Do not send them to anyone.</li>
          <li>The Instagram account must be a Business account linked to the Facebook page (Instagram app → Settings → Account type).</li>
          <li>Come back here and press <b>Connect with Facebook</b>. The app can stay in development mode: it only reads Dream India's own page, Instagram and ads.</li></ol></details>` : ''}
        ${SO.youtube.configured && !SO.youtube.connected ? `<details style="margin-top:8px"><summary><b>Before connecting YouTube</b></summary><ol class="small" style="margin:8px 0 0;padding-left:18px;line-height:1.6"><li>In Google Cloud (the project of the ERP's Google sign-in) → APIs &amp; Services → Library, turn on <b>YouTube Data API v3</b> and <b>YouTube Analytics API</b>.</li><li>In OAuth consent screen, set the app to <b>In production</b> (in "Testing", Google signs the ERP out every 7 days). Google may show "not verified": press Advanced → continue.</li></ol></details>` : ''}</div>
      <div class="mk-card"><h3>Channels</h3><div id="chs">${(s.channels || []).map(chRow).join('')}</div>${D.can.edit ? '<button type="button" class="ghost small" id="addCh">+ Add a channel</button>' : ''}</div>
      <div class="mk-card"><h3>Design library: Google Drive folders</h3><p class="small muted" style="margin:0 0 8px">One folder per project (sub-folders like Brochures, Floor plans, Elevations, Renders, Amenities are fine). Share each folder with <b>${esc(s.share || "the ERP's Google account")}</b> as Viewer, then paste its link here.</p>
        ${[['company', 'Company (logos, corporate profile)'], ...D.projects.map((p) => [String(p.id), p.name])].map(([k, l]) => `<label>${esc(l)}<input data-drive="${k}" value="${s.drive[k] ? 'https://drive.google.com/drive/folders/' + esc(s.drive[k]) : ''}" placeholder="Paste the Drive folder link"></label>`).join('')}</div>
      <div class="mk-card"><h3>Approvals</h3><label class="check"><input type="checkbox" id="needAp" ${s.needApproval ? 'checked' : ''}> Posts need Management's approval before they are scheduled or published</label></div>
      ${s.ivrUrl ? `<div class="mk-card"><h3>IVR calls (Exotel or any IVR)</h3><p class="small" style="margin:0 0 8px">Every call to the IVR number comes into the ERP and the caller becomes a lead (source IVR); missed calls are listed to call back. Whoever manages the IVR account adds this link once. In Exotel: App Bazaar → open the call flow → add a <b>Passthru</b> step at the start (and, optionally, set it as the flow's status callback) with this URL, method GET.</p><code style="user-select:all;word-break:break-all;display:block;background:#F7F7FB;padding:8px;border-radius:8px">${esc(location.origin + s.ivrUrl)}</code></div>` : ''}
      ${s.leadUrl ? `<div class="mk-card"><h3>Leads coming in by themselves</h3><p class="small" style="margin:0 0 8px">Give this link to the website developer for the enquiry form, and use it in a Meta lead-ads or portal connector (Zapier, Make). Each enquiry (name, phone, email, source, project, message) arrives in Leads; a number already received in the last 30 days is not added twice.</p><code style="user-select:all;word-break:break-all;display:block;background:#F7F7FB;padding:8px;border-radius:8px">${esc(location.origin + s.leadUrl)}</code></div>` : ''}
      <div class="mk-card"><h3>Type figures by hand</h3><p class="small muted" style="margin:0 0 8px">For LinkedIn, Google Business Profile or any channel not connected. One date's figures; leave a box empty if you do not have it.</p>
        <div class="row" style="grid-template-columns:repeat(4,1fr)"><div><label>Channel</label><select id="sn">${Object.entries(NET).map(([k, v]) => `<option value="${k}">${v.n}</option>`).join('')}</select></div><div><label>Date</label><input type="date" id="sd" value="${iso(new Date())}"></div><div><label>Followers</label><input id="sf" inputmode="numeric"></div><div><label>Views</label><input id="sv" inputmode="numeric"></div></div>
        <div class="row" style="grid-template-columns:repeat(4,1fr)"><div><label>Reach</label><input id="sr" inputmode="numeric"></div><div><label>Posts</label><input id="sp" inputmode="numeric"></div><div><label>Interactions</label><input id="si" inputmode="numeric"></div><div style="display:flex;align-items:end"><button class="ghost" id="saveSt">Save figures</button></div></div></div>
      ${D.can.edit ? '<div class="actions"><button id="saveSet">Save set-up</button></div>' : ''}`);
    if ($('#addCh')) $('#addCh').onclick = () => $('#chs').insertAdjacentHTML('beforeend', chRow({ network: 'facebook' }));
    $('#mkBody').addEventListener('click', (e) => { if (e.target.closest('[data-rmch]')) e.target.closest('.chrow').remove(); });
    if ($('#syncNow')) $('#syncNow').onclick = () => pullAll([...(SO.meta.connected ? ['facebook', 'instagram', 'ads', 'leads'] : []), ...(SO.youtube.connected ? ['youtube'] : [])], false);
    $$('#mkBody [data-disc]').forEach((b) => (b.onclick = async () => { if (!confirm('Disconnect? The figures already pulled stay; nothing new comes in.')) return; await C.api('/api/marketing', { action: 'disconnect', data: { net: b.dataset.disc } }); await load(); paint(); }));
    $('#saveSt').onclick = async () => { await C.api('/api/marketing', { action: 'stats.save', data: { network: $('#sn').value, day: $('#sd').value, followers: $('#sf').value, views: $('#sv').value, reach: $('#sr').value, posts: $('#sp').value, interactions: $('#si').value } }); C.toast('Figures saved.'); await load(); };
    if ($('#saveSet')) $('#saveSet').onclick = async () => {
      const drive = {}; $$('#mkBody [data-drive]').forEach((i) => { if (i.value.trim()) drive[i.dataset.drive] = i.value.trim(); });
      await C.api('/api/marketing', { action: 'settings', data: { needApproval: $('#needAp').checked, drive, channels: $$('#chs .chrow').map((r) => ({ network: r.querySelector('[data-c=network]').value, handle: r.querySelector('[data-c=handle]').value, url: r.querySelector('[data-c=url]').value, projectId: r.querySelector('[data-c=projectId]').value || null })) } });
      C.toast('Saved.'); S.libFor = null; await load(); paint();
    };
  }

  window.Marketing = { render };
})();
