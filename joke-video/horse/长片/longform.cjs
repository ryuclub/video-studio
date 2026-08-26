const { Resvg } = require('@resvg/resvg-js');
const fs=require('fs'), path=require('path');
// ⚠ **字体跟方案 §一 给的不是同一批。** 方案要思源黑 Black 当旁白，这台机器上没有；
// 能拿到的最接近的无衬线中文是**微软雅黑 Bold**。台词那支站酷快乐体、备用的得意黑，
// 仓库 fonts/ 里都有，路径一并指过来。
//
// ⚠ **字族名要跟着改**（下面的 FAM / FAM_NARR）：resvg 按 family 名匹配，
// 喂了雅黑却仍写 Noto Sans CJK SC 的话 **不报错，只是字全找不到** —— 帧上是空的。
const FONTS=[
  'C:/Windows/Fonts/msyhbd.ttc',
  'C:/Windows/Fonts/msyh.ttc',
  path.join(__dirname,'../../../fonts/ZCOOLKuaiLe-Regular.ttf'),
  path.join(__dirname,'../../../fonts/smiley-sans-v2.0.1/SmileySans-Oblique.otf'),
];
const FAM='Microsoft YaHei';
const FAM_LINE='ZCOOL KuaiLe';        // 台词：俏皮圆头
const FAM_NARR='Microsoft YaHei';    // 旁白
const CREAM='#F2EDE3',INK='#2A2622',AMBER='#C8862E',LINE='#8C8072',DUSK='#E7DFD1';
const C_MA='#C2793C';    // 老马主体色（赭橙）
const C_FISH='#D94F2B';   // 小金鱼：全片唯一的高饱和色
const C_NIU='#5A4A40';   // 老牛主体色（原色，白边下不必提亮）

function loadRig(file){
  const raw=fs.readFileSync(path.join(__dirname,file),'utf8');
  const vb=raw.match(/viewBox="([^"]+)"/)[1];
  const n=vb.split(/\s+/).map(Number);
  return {vb, inner: raw.replace(/^[\s\S]*?<svg[^>]*>/,'').replace(/<\/svg>\s*$/,''), ratio:n[2]/n[3]};
}
// ⚠ **两个 rig 都用仓库里现成的，不复制副本** —— 一份东西一个家。
// 老牛的 bull_stand.svg 结构跟老马对等（五个口型、pupil、head 都齐），
// 见 horse/bull-side/BULL_HANDOFF.md。
const MA=loadRig('../horse_only.svg'), NIU=loadRig('../bull-side/bull_stand.svg');
// mouth: 'closed' | 'A' | 'E' | 'I' | 'O'
function setMouth(inner, m){
  if(!m || m==='closed') return inner;
  let out = inner.replace(/(id="mouth-closed")/, '$1 style="display:none"');
  out = out.replace(new RegExp(`(id="mouth-${m}")\\s+style="display:none"`), '$1');
  return out;
}
let FISH=0.5, TIME=0;
const rig=(R,x,y,h,flip,mouth)=>{const w=h*R.ratio;
 const g=`<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${R.vb}" preserveAspectRatio="xMidYMax meet">${setMouth(R.inner,mouth)}</svg>`;
 return `<g${flip?` transform="translate(${2*x+w},0) scale(-1,1)"`:''}>${g}</g>`;};
const NIUFILTER='';

const W=1280,H=720;

// —— 鱼缸：全片唯一会动的东西，也是唯一的高饱和色 ——
function fishtank(x,y,sc,fp,dark){ fp = (fp===undefined?FISH:fp);
  const w=120*sc, h=88*sc, st=(3*sc).toFixed(2);
  const col = dark ? '#CFC4B4' : LINE;
  const water = y+h*0.30;
  const fx = x + w*(0.20+0.60*fp), fy = water + h*0.36;
  const S2 = 1.15*sc, dir = fp>0.5?1:-1;
  return `<g>
    <path d="M${x} ${y} h${w} v${h} q0 ${10*sc} ${-10*sc} ${10*sc} h${-(w-20*sc)} q${-10*sc} 0 ${-10*sc} ${-10*sc} z"
      fill="none" stroke="${col}" stroke-width="${st}" stroke-linejoin="round" opacity="${dark?0.9:0.68}"/>
    <path d="M${x+4*sc} ${water} q${w*0.25} ${-6*sc} ${w*0.5} 0 t${w*0.5-8*sc} 0" fill="none" stroke="${col}" stroke-width="${(2.2*sc).toFixed(2)}" opacity="${dark?0.7:0.55}"/>
    <g transform="translate(${fx.toFixed(1)},${fy.toFixed(1)}) scale(${(dir*S2).toFixed(2)},${S2.toFixed(2)})">
      <path d="M-13 0 q-7 -8 -12 -9 q3 9 0 18 q6 -1 12 -9 z" fill="${C_FISH}" opacity="0.85"/>
      <path d="M-13 0 q7 -11 20 -11 q13 0 17 11 q-4 11 -17 11 q-13 0 -20 -11 z" fill="${C_FISH}"/>
      <path d="M2 -9 q5 -7 10 -4 q-3 4 -4 8 z" fill="${C_FISH}" opacity="0.75"/>
      <circle cx="16" cy="-2" r="2.4" fill="#1E1A17"/>
    </g>
    ${(()=>{const out=[];
      const bottom=y+h-6*sc, top=water+4*sc, span=bottom-top;
      // 五串气泡，每串五颗；大小、速度、间距按固定种子随机，避免均匀
      const rnd=(n=>()=>((n=(n*1103515245+12345)&0x7fffffff)/0x7fffffff))(90731);
      for(let si=0; si<5; si++){
        const px   = 0.13 + si*0.185 + rnd()*0.05;
        const spd  = 0.60 + rnd()*1.00;
        const base = rnd();
        for(let k=0;k<5;k++){
          const gap  = 0.13 + rnd()*0.13;
          const sz   = 0.50 + rnd()*1.20;
          const u=((TIME*spd*0.30 + base + k*gap) % 1);
          const cy=bottom-span*u;
          const r=(1.1+1.5*u)*sz*sc;
          const op=0.60*(1-Math.pow(u,2.4));
          const wob=Math.sin(TIME*(2.1+si*0.55)+k*1.7+u*7)*(1.4+sz)*sc;
          out.push(`<circle cx="${(x+w*px+wob).toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="${col}" stroke-width="${(1.3*sc).toFixed(2)}" opacity="${op.toFixed(2)}"/>`);
        }
      }
      return out.join('');
    })()}
  </g>`;
}
// ================= 场景库 =================
// 每个场景返回 {bg, art}。线描统一：stroke 3、圆头、透明度分两档
const S=(d,w=3,op=0.42)=>`<path d="${d}" fill="none" stroke="${LINE}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" opacity="${op}"/>`;
const glow=(x,y,r,c,id)=>`<defs><radialGradient id="${id}"><stop offset="0" stop-color="${c}" stop-opacity="0.55"/><stop offset="0.5" stop-color="${c}" stop-opacity="0.16"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient></defs><circle cx="${x}" cy="${y}" r="${r}" fill="url(#${id})"/>`;

const SCENES={
  // 工位·清晨：斜光、显示器、纸箱
  office_dawn:{bg:'#EFE7D8',art:()=>`
    ${S('M0 566 H1280',3,0.40)}
    ${S('M70 566 V300 M70 300 H330 M330 300 V566',3,0.30)}
    ${S('M96 330 h208 v128 h-208 z M200 458 v34 M160 492 h80',3,0.34)}
    ${S('M1000 566 V250 h210 v316 M1000 340 h210 M1105 250 V566',3,0.22)}
    ${S('M1010 262 L1120 566 M1080 262 L1190 566',3,0.13)}
    ${S('M560 566 v-84 h130 v84 M560 512 h130 M600 482 v-22 h50 v22',3,0.34)}
    ${S('M840 566 v-96 h230 v96 M840 470 h230',3,0.26)}
    ${fishtank(920,404,0.62)}`},
  // 工位·白天：格挡、吊灯、更多工位
  office_day:{bg:'#EDE6D9',art:()=>`
    ${S('M0 566 H1280',3,0.40)}
    ${S('M60 566 V320 H300 V566 M60 320 H300',3,0.26)}
    ${S('M980 566 V320 H1220 V566 M980 320 H1220',3,0.26)}
    ${S('M86 350 h188 v112 h-188 z',3,0.30)}
    ${S('M1006 350 h188 v112 h-188 z',3,0.30)}
    ${S('M400 0 v92 M340 92 h120 l-16 34 h-88 z',3,0.30)}
    ${S('M880 0 v92 M820 92 h120 l-16 34 h-88 z',3,0.30)}`},
  // 楼道：窄、暖气片、门、竖墙线
  corridor:{bg:'#E5DDD0',art:()=>`
    ${S('M0 566 H1280',3,0.40)}
    ${S('M150 0 V566 M1130 0 V566',3,0.20)}
    ${S('M210 150 h150 v416 M210 150 V566 M345 360 h10',3,0.32)}
    ${S('M960 200 h180 M960 200 V566 M1140 200 V566',3,0.20)}
    ${S('M990 430 h120 M1000 400 v96 M1024 400 v96 M1048 400 v96 M1072 400 v96 M1096 400 v96 M990 400 h120',3,0.34)}
    ${S('M470 60 h180 v150 h-180 z M560 60 V210 M470 135 h180',3,0.18)}`},
  // 饭桌：大圆桌、转盘、盘子、吊灯
  dinner:{bg:'#E9E0CF',seat:18,
   fg:()=>`
    <path d="M-40 500 Q640 432 1320 500 L1320 780 L-40 780 Z" fill="#E9E0CF"/>
    <path d="M-40 500 Q640 432 1320 500" fill="none" stroke="${LINE}" stroke-width="3.5" opacity="0.5"/>
    <path d="M-40 530 Q640 462 1320 530" fill="none" stroke="${LINE}" stroke-width="2.5" opacity="0.2"/>
    ${[-360,-215,215,360].map(dx=>`<ellipse cx="${640+dx}" cy="${504+(Math.abs(dx)>300?14:0)}" rx="48" ry="14" fill="none" stroke="${LINE}" stroke-width="2.8" opacity="0.28"/>`).join('')}
    ${S('M250 496 v-30 M250 466 h18 M1030 496 v-30 M1030 466 h18',2.6,0.24)}`,
   art:()=>`
    ${S('M0 560 H1280',3,0.16)}
    ${S('M640 0 v66 M566 66 h148 l-22 38 h-104 z',3,0.30)}
    <ellipse cx="640" cy="464" rx="238" ry="30" fill="none" stroke="${LINE}" stroke-width="3" opacity="0.22"/>
    ${[-150,150].map(dx=>`<ellipse cx="${640+dx}" cy="${456}" rx="40" ry="11" fill="none" stroke="${LINE}" stroke-width="2.6" opacity="0.24"/>`).join('')}
    ${S('M90 470 V250 h200 v220 M90 250 h200 M90 330 h200',3,0.14)}
    ${S('M990 470 V250 h200 v220 M990 250 h200 M990 330 h200',3,0.14)}`},
  // 楼下·傍晚：远楼、云、路灯、地铁口
  street_dusk:{bg:'#E7DFD1',art:()=>`
    ${S('M0 566 H1280',3,0.42)}
    ${S('M60 566 V376 h130 V566 M60 470 h130 M60 420 h130 M125 376 V566',3,0.34)}
    ${S('M1085 566 V326 h140 V566 M1085 470 h140 M1085 400 h140 M1155 326 V566',3,0.34)}
    ${S('M300 170 q70 -20 140 0 M350 214 q56 -16 112 0',2.5,0.20)}
    ${S('M232 566 V236 M232 236 q0 -26 26 -26 h18',3,0.42)}
    ${S('M266 200 h34 l-8 30 h-18 z',3,0.42)}
    ${S('M960 566 v-46 h96 v46 M960 520 l48 -34 l48 34',3,0.30)}
    ${fishtank(915,452,1.0)}`},
  // 工位·夜：只剩两三盏灯、窗外灯点、窗台鱼缸
  office_night:{bg:'#322E29',art:()=>`
    ${glow(400,96,230,'#F3D9A0','g1')}
    ${glow(1060,300,150,'#CFE3EE','g2')}
    ${S('M0 566 H1280',3,0.26)}
    ${S('M400 0 v82 M340 82 h120 l-16 34 h-88 z',3,0.5)}
    <circle cx="400" cy="104" r="9" fill="#F3D9A0" opacity="0.9"/>
    ${S('M60 566 V320 H300 V566 M60 320 H300 M86 350 h188 v112 h-188 z',3,0.26)}
    ${S('M980 200 h240 v300 h-240 z M1100 200 V500 M980 350 h240',3,0.30)}
    ${[1010,1042,1074,1140,1172].map((x,i)=>`<rect x="${x}" y="${232+(i%3)*54}" width="14" height="12" fill="#F3D9A0" opacity="${0.35+0.2*(i%3)}"/>`).join('')}
    ${S('M960 512 h300',3,0.34)}
    ${glow(1090,452,120,'#CFE3EE','g3')}
    ${fishtank(1010,400,1.35,undefined,true)}`},
};
function scene(name){
  const sc=SCENES[name]||SCENES.street_dusk;
  return {bg:sc.bg, art:`<rect width="${W}" height="${H}" fill="${sc.bg}"/>${sc.art()}`};
}

// —— 保证字色与底色的对比度：不够就朝白/黑推，直到达标 ——
const hex2rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
const rgb2hex=r=>'#'+r.map(v=>Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,'0')).join('');
const lum=h=>{const c=hex2rgb(h).map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});
  return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2];};
const ratio=(a,b)=>{const l1=lum(a),l2=lum(b);return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);};
function ensure(color,bg,min=3.2){
  if(ratio(color,bg)>=min) return color;
  const toward = lum(bg)>0.4 ? [0,0,0] : [255,255,255];   // 浅底压暗，深底提亮
  let c=hex2rgb(color);
  for(let t=0.05;t<=1.001;t+=0.05){
    const mixed=rgb2hex(c.map((v,i)=>v+(toward[i]-v)*t));
    if(ratio(mixed,bg)>=min) return mixed;
  }
  return rgb2hex(toward);
}

// —— 断行：优先在标点后断，其次按字数 ——
const PUNCT='。，、；：！？…—）」』】';
function wrap(text, maxChars){
  if([...text].length<=maxChars) return [text];
  const ch=[...text]; const lines=[]; let cur='';
  for(let i=0;i<ch.length;i++){
    cur+=ch[i];
    const nextIsPunct = ch[i+1] && PUNCT.includes(ch[i+1]);
    if([...cur].length>=maxChars && !nextIsPunct){
      // 回溯找最近的标点
      let cut=-1;
      const arr=[...cur];
      for(let j=arr.length-1;j>=Math.floor(maxChars*0.5);j--){
        if(PUNCT.includes(arr[j])){cut=j;break;}
      }
      if(cut>=0){ lines.push(arr.slice(0,cut+1).join('')); cur=arr.slice(cut+1).join(''); }
      else { lines.push(cur); cur=''; }
    }
  }
  if(cur) lines.push(cur);
  return lines;
}
// 粗略字宽：汉字 1.0em，半角 0.55em
const measure=(t,size)=>[...t].reduce((a,c)=>a+(/[\x00-\xff]/.test(c)?0.55:1.0),0)*size;

// —— 台词：无气泡，白字黑边，句末标点不显示 ——
const stripEnd = t => t.replace(/[。，、；：！？…—]+$/,'');
function line(text,{cx,headY,color,halo}){
  const size=50, lh=size*1.28, maxChars=15;
  const lines=wrap(text,maxChars).map((t,i,arr)=> i===arr.length-1 ? stripEnd(t) : t);
  const bottom=headY-38;
  const top=bottom-(lines.length-1)*lh;
  return lines.map((t,i)=>
    `<text x="${cx}" y="${(top+i*lh).toFixed(1)}" font-family="${FAM_LINE}" font-size="${size}" font-weight="700" fill="${color}" stroke="${halo}" stroke-width="10" paint-order="stroke" stroke-linejoin="round" text-anchor="middle">${t}</text>`).join('');
}

// —— 旁白：白字黑边加粗，底部居中 ——
function narr(lines,halo,bg,prog){
  const size=40;
  const fill = lum(bg)>0.4 ? '#FFFFFF' : '#F4EFE6';
  const edge = lum(bg)>0.4 ? INK : '#15120F';
  // ⚠ **整块往上顶，让最后一行永远落在 H-96。**
  // 原来是第一行钉在 H-96、往下长 —— 三行的旁白第三行就掉出画外了（画布 720，
  // 第三行基线到 728）。长句在这条稿子里很常见，不是个例。
  const top = H - 96 - (lines.length - 1) * 52;
  // **从下往上浮出来**（2026-08-25）：prog 0→1 的时候整块往上走 22px、同时淡入。
  // 不传 prog 就是老样子（静止、全不透明），别的调用方不受影响。
  const p = prog === undefined ? 1 : Math.max(0, Math.min(1, prog));
  const dy = (1 - p) * 22, op = Math.min(1, p * 2.2);
  return `<g transform="translate(0,${dy.toFixed(1)})" opacity="${op.toFixed(3)}">` + lines.map((t,i)=>
    `<text x="${W/2}" y="${top+i*52}" font-family="${FAM_NARR}" font-size="${size}" font-weight="900" fill="${fill}" stroke="${edge}" stroke-width="8" paint-order="stroke" stroke-linejoin="round" text-anchor="middle" letter-spacing="1">${t}</text>`).join('') + '</g>';
}

/**
 * **场景标牌**（2026-08-25 加）：左上角一块小牌子，写这一场是哪儿。
 *
 * 画成场景里的一块牌，不是浮在画面上的 UI —— 底色取场景底色压暗一档，
 * 描边用墨色，跟手绘线条那套一致。**放左上角**：底部中间是旁白，
 * 头顶那一带是台词，左上是全片唯一一直空着的地方。
 *
 * 字号 26、半透明 —— 它是给人认场用的，**不该跟台词抢**。
 */
/**
 * ⚠ **牌匾用单点式那三个色，不用场景那套线色**（`horse/plaque.mjs` 顶上的常量）。
 * 挂绳原先拿的是 `LINE`（#8C8072，场景细线那支）—— 那是画墙和桌子用的浅灰褐，
 * 挂在木牌上像根尼龙线；单点式那块牌子上下一体都是 #3B322B 的墨。
 */
const PL_LINE='#3B322B', PL_WOOD='#D8BE93', PL_SHADE='#A98A5C';
/** 牌子中心的 y。**不是随便定的**，见 label() 里那条「绳结要留在画布里」 */
const LABEL_CY=106;

function label(text,bg){
  if(!text) return '';
  // **照单点式那块木牌的样子**（`horse/plaque.mjs` 的 `style:"wood"`）：
  // 两根挂绳从顶角斜上去、木色底、上下两道横木、墨色描边。
  // ⚠ **不搬 `rough.mjs` 的手绘抖动** —— 长片这套画面是干净的细线，
  // 抖出来的边在这儿是另一种笔触，两种线放一起就花了。**借的是样式，不是笔法。**
  const w = 26*[...text].length + 46, h = 56;
  const x = -w/2, y = -h/2;
  // ⚠ **绳结要留在画布里**，这条 plaque.mjs 里记着，长片头一版照样踩了：
  // 绳子从牌顶往上 70px 收成结，牌高 56 —— 中心定在 88 时结落在 **y = −10**，
  // 被上沿切掉一截，看着不像「挂在画外」，像画漏了。106 让它落在 y = 8。
  const cx = 150, cy = LABEL_CY;
  // ⚠ `lum(bg)>0.4` 是**浅底**，不是深底 —— 变量原先叫 `dark`，名字反着。两档只差 0.05，
  // 看不出来，但下一个人要照它加规则就会加反。
  const light = lum(bg)>0.4;
  return `<g transform="translate(${cx},${cy}) rotate(-1.6)" opacity="${light?0.95:0.9}">`
    // **两根挂绳**，各自从一个顶角斜上去，在牌子正上方收成一个结，
    // 像挂在画外的钉子上。⚠ 原先是一条折线串下来 —— 那是**一根**绳绕过钉子，
    // 规范写的是两根（`plaque.mjs` 也是两条独立的 stroke）。
    // ⚠ **绳子的颜色要过 `ensure()`，牌子的描边不用。**
    // 绳子挂在**背景**上：墨色 #3B322B 落在夜景底 #322E29 上对比度只有 1.05，
    // 整根看不见 —— 剩一块木牌浮在半空，跟绳结被切掉是同一种「像画漏了」。
    // 描边压在**木色底**上，那儿一直是浅的，照单点式用墨色不动。
    // （这条不是新规矩：§四之三 那三条自动规则里就有「字色按底色保证对比度」。）
    + [-1,1].map(sx=>`<path d="M${sx*w*0.34} ${y} L${sx*w*0.18} ${y-42} L0 ${y-70}" fill="none" stroke="${ensure(PL_LINE,bg)}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" opacity="0.8"/>`).join('')
    + `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${PL_WOOD}"/>`
    // 木纹：三道斜线，压在木色上（单点式那边是 hatch，这边不抖，三道就够）
    + [0.28,0.5,0.72].map(f=>`<path d="M${x+8} ${y+h*f+6} L${x+w-8} ${y+h*f}" stroke="${PL_SHADE}" stroke-width="1.4" opacity="0.35"/>`).join('')
    // 上下两道横木
    + [0.16,0.84].map(f=>`<path d="M${x+9} ${y+h*f} L${x+w-9} ${y+h*f}" stroke="${PL_SHADE}" stroke-width="2.6" opacity="0.55"/>`).join('')
    + `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="none" stroke="${PL_LINE}" stroke-width="2.2" opacity="0.9"/>`
    // ⚠ **牌匾上的字是站酷快乐体**，跟单点式那块一样（`plaque.mjs` 的 `FONT`）。
    // 原先用的是旁白那支雅黑 —— 字幕规范 §二 禁站酷快乐体是**禁在字幕上**，
    // 牌匾是场景里的一块牌子、不是台词，**可以有语气**（`config.ts` 的 FONT_FILES
    // 注释写得很清楚：那支字体「只给标题牌匾」）。
    + `<text x="0" y="10" font-family="${FAM_LINE}" font-size="26" fill="${PL_LINE}" text-anchor="middle" letter-spacing="2">${text}</text></g>`;
}

/**
 * 一帧。
 *
 * ⚠ **`maX` / `maH` / `overlay` 这三个是第四处接线改动**（2026-08-26，给封面用），
 * **画法仍旧一个像素没动**：出帧脚本不传它们，出来的帧跟以前逐字节一样。
 *
 *   maX      老马站在哪儿（缺省 300，也就是画面左三分之一）。封面要他站右边
 *   maH      老马多高（缺省 366）。**脚底永远落在 y=566 那条地面线上** ——
 *            改高度是从头顶往上长，不是把人抬起来。封面推近了看才有分量
 *   overlay  最后叠一层 svg（封面的标题块）。画在所有东西之上
 *
 * 封面为什么走这个函数、而不是另画一张：**片子里是什么样，封面就该是什么样。**
 * 场景、鱼缸、灯光、色温差全是这儿定的，抄一份到封面脚本里就是第二个真相。
 */
function frame(o){
  if(o.fish!==undefined) FISH=o.fish;
  if(o.t!==undefined) TIME=o.t;
  const sc=scene(o.scene||'street_dusk');
  const BG = o.bg || sc.bg;
  // 描边＝当前场景底色。浅底像柔光托起，深底自动变成暗色描边
  const HALO = BG;
  let s = o.bg ? `<rect width="${W}" height="${H}" fill="${o.bg}"/>`+sc.art.replace(/^<rect[^>]*\/>/,'') : sc.art;
  const seat=(SCENES[o.scene||'street_dusk']||{}).seat||0;
  const maX = o.maX!==undefined ? o.maX : (seat?470:300), niuX = seat?700:720;   // 并排坐同侧时靠拢
  const maH = o.maH || 366;
  s+=rig(MA,maX,566+seat-maH,maH,false,o.ma?(o.mouthMa||'A'):'closed');
  if(o.two) s+=rig(NIU,niuX,178+seat,392,seat?false:true,o.niu?(o.mouthNiu||'A'):'closed');
  if(o.label) s+=label(o.label,BG);
  if(o.narr) s+=narr(o.narr,HALO,BG,o.narrProg);
  const scObj=SCENES[o.scene||'street_dusk'];
  if(scObj && scObj.fg) s+=scObj.fg();
  if(o.ma)  s+=line(o.ma,{cx:seat?400:360,headY:206+seat,color:ensure(C_MA,BG),halo:HALO});
  if(o.niu) s+=line(o.niu,{cx:seat?940:900,headY:182+seat,color:ensure(C_NIU,BG),halo:HALO});
  if(o.overlay) s+=o.overlay;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${NIUFILTER}</defs>${s}</svg>`;
}

// ⚠ **样张那一段只在直接跑这个文件时执行。** 不加这个判断的话，
// 每次 require 它拿 frame() 都会顺手重渲七张样张 —— 出帧脚本要 require 四千多次…
// 不，只 require 一次，但那七张样张会白渲一遍，而且看不出是谁写的。
if (require.main === module) {
const OUT=path.join(__dirname,'../../out/长片样张');
fs.mkdirSync(OUT,{recursive:true});
const opt={font:{fontFiles:FONTS,loadSystemFonts:false,defaultFontFamily:FAM}};
const samples=[
 ['S1_工位清晨.png',{scene:'office_dawn',two:true,narr:['他正把最后一摞东西往箱子里放']}],
 ['S2_工位白天.png',{scene:'office_day',two:true,narr:['活干不完的时候，我就不干了，我坐着']}],
 ['S3_楼道.png',{scene:'corridor',two:true,niu:'也不一定。去了再看',mouthNiu:'A'}],
 ['S4_饭桌.png',{scene:'dinner',two:true,niu:'没有没有',mouthNiu:'O'}],
 ['S5_楼下傍晚.png',{scene:'street_dusk',two:true,ma:'我什么都不干，我就永远不用知道自己到底行不行。',mouthMa:'A'}],
 ['S6_工位夜.png',{scene:'office_night',narr:['我一直以为他傻']}],
 ['S6b_夜_换水.png',{scene:'office_night',fish:0.78,narr:['十一点我走的时候，给鱼换了点水']}],
];
samples.forEach(([f,o])=>{fs.writeFileSync(path.join(OUT,f),new Resvg(frame(o),opt).render().asPng());console.log('ok',f);});
}

// 给出帧脚本用（）。**方案里那个 animatic.js 的 seq 不再手写** ——
// 时间轴由对齐过的配音直接生成，见方案 §六之四「用每句音频的实际时长替换 seq」。
module.exports={frame,SCENES};
