import { useState, useEffect, useRef, useCallback, KeyboardEvent } from 'react';

// ── Game constants ─────────────────────────────────────────────────────────────
const GW = 1140, GH = 680;

// ── Building definitions ──────────────────────────────────────────────────────
interface Bld {
  id: string; name: string;
  x: number; y: number; w: number; h: number;
  brick: string; mortar: string; roof: string; roofTop: string;
  peaks: number; taskType: string; sideColor: string;
}

const BLDS: Bld[] = [
  { id:'nexus',   name:'COMMAND CENTER', x:480, y:118, w:218, h:162,
    brick:'#c86022', mortar:'#8a3a12', roof:'#3a3848', roofTop:'#2a2838', sideColor:'#7a3a10', peaks:4, taskType:'sync' },
  { id:'apex',    name:'APEX HUB',       x:748, y:82,  w:148, h:128,
    brick:'#b05010', mortar:'#7a3010', roof:'#2e2c3c', roofTop:'#1e1c2c', sideColor:'#6a3010', peaks:3, taskType:'route' },
  { id:'tactix',  name:'WAR ROOM',       x:956, y:148, w:144, h:122,
    brick:'#8a8898', mortar:'#5a5868', roof:'#c03020', roofTop:'#901a10', sideColor:'#4a4858', peaks:2, taskType:'strategy' },
  { id:'forge',   name:'FORGE LAB',      x:78,  y:208, w:138, h:112,
    brick:'#9a6830', mortar:'#6a4818', roof:'#5a3818', roofTop:'#3a2008', sideColor:'#5a3818', peaks:2, taskType:'code' },
  { id:'spark',   name:'RESEARCH LAB',   x:62,  y:394, w:148, h:116,
    brick:'#2a8870', mortar:'#185a48', roof:'#1a4a3a', roofTop:'#0e3028', sideColor:'#185a48', peaks:2, taskType:'research' },
  { id:'vega',    name:'VEGA HUB',       x:944, y:378, w:138, h:112,
    brick:'#a02030', mortar:'#6a1020', roof:'#3a3848', roofTop:'#2a2838', sideColor:'#6a1020', peaks:3, taskType:'marketing' },
  { id:'atlas',   name:'ATLAS BASE',     x:428, y:502, w:132, h:106,
    brick:'#8a7040', mortar:'#5a4820', roof:'#4a3010', roofTop:'#2a1800', sideColor:'#4a3010', peaks:2, taskType:'knowledge' },
  { id:'data',    name:'DATA VAULT',     x:606, y:498, w:138, h:106,
    brick:'#607080', mortar:'#3a4a58', roof:'#3a4858', roofTop:'#2a3848', sideColor:'#3a4858', peaks:2, taskType:'collect' },
  { id:'revenue', name:'REVENUE HQ',     x:998, y:502, w:128, h:100,
    brick:'#a09020', mortar:'#6a6010', roof:'#3a3018', roofTop:'#2a2008', sideColor:'#6a6010', peaks:3, taskType:'revenue' },
];

function bc(id: string) {
  const b = BLDS.find(b => b.id === id)!;
  return { x: b.x + b.w/2, y: b.y + b.h/2 };
}

const EDGES: [string,string][] = [
  ['forge','nexus'],['nexus','apex'],['apex','tactix'],
  ['spark','nexus'],['nexus','tactix'],
  ['atlas','data'],['data','revenue'],
  ['forge','spark'],['spark','atlas'],
  ['nexus','atlas'],['nexus','data'],
  ['tactix','vega'],['vega','revenue'],
  ['nexus','vega'],
];

const WATER = { x:296, y:380, w:208, h:168 };
const TREES: [number,number,number][] = [
  [258,200,1.05],[368,184,0.92],[858,100,1.08],[922,100,0.88],
  [52,328,0.95],[52,498,1.02],[258,490,0.9],
  [398,432,1.0],[392,558,0.88],[570,432,0.95],
  [808,364,1.05],[820,484,0.92],[898,305,0.9],
  [1100,195,1.0],[1108,375,0.9],[1110,502,1.02],
  [488,190,0.88],[558,204,0.92],[708,190,0.88],
];

const AI_TASKS: Record<string,string[]> = {
  sync:      ['Sync data','Merge batches','Run pipeline','Export results'],
  route:     ['Route tasks','Balance load','Coordinate agents','Monitor status'],
  strategy:  ['Plan approach','Analyze market','Set KPIs','Review strategy'],
  code:      ['Build tool','Deploy API','Optimize flow','Fix pipeline'],
  research:  ['Scan sources','Analyze trends','Find insights','Evaluate data'],
  marketing: ['Write copy','Plan campaign','Set targeting','Review metrics'],
  knowledge: ['Index data','Update docs','Archive logs','Link sources'],
  collect:   ['Collect data','Label dataset','Validate batch','Export data'],
  revenue:   ['Process order','Check margins','Optimize pricing','Log results'],
};

const BARRELS:  [number,number][] = [[118,315],[140,315],[470,480],[908,340],[988,490]];
const CRATES:   [number,number][] = [[102,312],[620,480],[750,480],[1090,460]];
const BENCHES:  [number,number][] = [[380,350],[740,350],[420,600],[740,600]];
const LANTERNS: [number,number][] = [[300,280],[700,280],[300,490],[700,490],[510,175],[490,605]];
const FENCES: [number,number,number,number][] = [
  [28,28,1100,12],[28,28,12,628],[28,628,1100,12],[1116,28,12,628],
];

function bfs(from: string, to: string): string[] {
  if (from === to) return [from];
  const adj: Record<string,string[]> = Object.fromEntries(BLDS.map(b=>[b.id,[]]));
  for (const [a,b] of EDGES){ adj[a].push(b); adj[b].push(a); }
  const seen = new Set([from]); const q: string[][] = [[from]];
  while (q.length){
    const path = q.shift()!;
    for (const n of adj[path[path.length-1]]){
      if (n===to) return [...path,n];
      if (!seen.has(n)){ seen.add(n); q.push([...path,n]); }
    }
  }
  return [from];
}

interface Agent {
  id:string; name:string; col:string; hatCol:string;
  homeId:string; curId:string; path:string[];
  px:number; py:number; tx:number; ty:number;
  status:'idle'|'moving'|'working'|'thinking';
  workTick:number; task:string; thought:string;
}

function initAgents(): Agent[] {
  return [
    {id:'forge', name:'FORGE', col:'#ff7a2a', hatCol:'#cc5500', homeId:'forge'},
    {id:'apex',  name:'APEX',  col:'#00d9ff', hatCol:'#0090cc', homeId:'apex'},
    {id:'tactix',name:'TACTIX',col:'#00ff9d', hatCol:'#00aa66', homeId:'tactix'},
    {id:'spark', name:'SPARK', col:'#ffb800', hatCol:'#cc8800', homeId:'spark'},
    {id:'vega',  name:'VEGA',  col:'#ff2d55', hatCol:'#cc1133', homeId:'vega'},
    {id:'atlas', name:'ATLAS', col:'#00b4ff', hatCol:'#0070cc', homeId:'atlas'},
  ].map(s=>{ const c=bc(s.homeId); return {...s,curId:s.homeId,path:[],px:c.x,py:c.y,tx:c.x,ty:c.y,status:'idle' as const,workTick:0,task:'',thought:''}; });
}

// ── Draw helpers ───────────────────────────────────────────────────────────────
function drawCheckerGrass(ctx: CanvasRenderingContext2D) {
  const TS=40;
  for(let gx=0;gx<GW;gx+=TS)
    for(let gy=0;gy<GH;gy+=TS){
      ctx.fillStyle=((gx/TS+gy/TS)%2===0)?'#5ec847':'#53b83f';
      ctx.fillRect(gx,gy,TS,TS);
    }
  for(let i=0;i<90;i++){
    const gx=Math.floor(Math.random()*GW/TS)*TS;
    const gy=Math.floor(Math.random()*GH/TS)*TS;
    ctx.fillStyle='rgba(0,0,0,0.03)'; ctx.fillRect(gx,gy,TS,TS);
  }
  const vg=ctx.createRadialGradient(GW/2,GH/2,GH*0.18,GW/2,GH/2,GH*0.76);
  vg.addColorStop(0,'transparent'); vg.addColorStop(1,'rgba(0,0,0,0.28)');
  ctx.fillStyle=vg; ctx.fillRect(0,0,GW,GH);
}

function drawPaths(ctx: CanvasRenderingContext2D) {
  const PW=54;
  for(const [aid,bid] of EDGES){
    const a=bc(aid),b=bc(bid);
    const dx=b.x-a.x,dy=b.y-a.y;
    const len=Math.sqrt(dx*dx+dy*dy);
    const nx=-dy/len,ny=dx/len;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(a.x+nx*(PW/2+7),a.y+ny*(PW/2+7));
    ctx.lineTo(b.x+nx*(PW/2+7),b.y+ny*(PW/2+7));
    ctx.lineTo(b.x-nx*(PW/2+7),b.y-ny*(PW/2+7));
    ctx.lineTo(a.x-nx*(PW/2+7),a.y-ny*(PW/2+7));
    ctx.closePath(); ctx.fillStyle='#a89870'; ctx.fill();
    ctx.beginPath();
    ctx.moveTo(a.x+nx*PW/2,a.y+ny*PW/2);
    ctx.lineTo(b.x+nx*PW/2,b.y+ny*PW/2);
    ctx.lineTo(b.x-nx*PW/2,b.y-ny*PW/2);
    ctx.lineTo(a.x-nx*PW/2,a.y-ny*PW/2);
    ctx.closePath(); ctx.fillStyle='#d8c8a0'; ctx.fill();
    ctx.strokeStyle='#bca882'; ctx.lineWidth=0.9;
    for(let i=0;i<=Math.floor(len/30);i++){
      const tf=i/Math.floor(len/30);
      const px=a.x+dx*tf,py=a.y+dy*tf;
      ctx.beginPath();
      ctx.moveTo(px+nx*PW/2,py+ny*PW/2);
      ctx.lineTo(px-nx*PW/2,py-ny*PW/2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawFences(ctx: CanvasRenderingContext2D) {
  for(const [x,y,w,h] of FENCES){
    ctx.fillStyle='#8a5a28';
    ctx.fillRect(x,y,w,h);
    const isHoriz = w>h;
    if(isHoriz){
      for(let px=x;px<x+w;px+=20){ ctx.fillStyle='#6a4018'; ctx.fillRect(px-2,y-5,5,h+10); ctx.fillStyle='#8a5a28'; }
    } else {
      for(let py=y;py<y+h;py+=20){ ctx.fillStyle='#6a4018'; ctx.fillRect(x-5,py-2,w+10,5); ctx.fillStyle='#8a5a28'; }
    }
  }
}

function drawWater(ctx: CanvasRenderingContext2D, t: number) {
  const {x,y,w,h}=WATER;
  ctx.fillStyle='#a89060'; ctx.fillRect(x-12,y-12,w+24,h+24);
  ctx.fillStyle='#8a7040'; ctx.fillRect(x-9,y-9,w+18,h+18);
  for(let bx=x-9;bx<x+w+9;bx+=22){
    ctx.fillStyle='#7a6030'; ctx.fillRect(bx,y-9,18,5); ctx.fillRect(bx,y+h+4,18,5);
  }
  for(let by=y-9;by<y+h+9;by+=22){
    ctx.fillStyle='#7a6030'; ctx.fillRect(x-9,by,5,18); ctx.fillRect(x+w+4,by,5,18);
  }
  const wg=ctx.createLinearGradient(x,y,x,y+h);
  wg.addColorStop(0,'#62c8f4'); wg.addColorStop(0.45,'#4ab0dc'); wg.addColorStop(1,'#3088b8');
  ctx.fillStyle=wg; ctx.fillRect(x,y,w,h);
  ctx.fillStyle='rgba(0,30,80,0.12)'; ctx.fillRect(x,y+h*0.7,w,h*0.3);
  ctx.strokeStyle='rgba(255,255,255,0.3)'; ctx.lineWidth=1.6;
  for(let wy=y+16;wy<y+h-14;wy+=22){
    ctx.beginPath();
    for(let wx=x+6;wx<x+w-6;wx+=2){
      const wave=Math.sin((wx/20+t/820)*Math.PI*2)*2.8;
      if(wx===x+6) ctx.moveTo(wx,wy+wave); else ctx.lineTo(wx,wy+wave);
    }
    ctx.stroke();
  }
  const lps=[[x+48,y+48],[x+162,y+58],[x+78,y+118],[x+168,y+128],[x+110,y+85]];
  for(const [lx,ly] of lps){
    ctx.fillStyle='#3a9830'; ctx.beginPath(); ctx.ellipse(lx,ly,10,6,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#e8a0a0'; ctx.beginPath(); ctx.arc(lx,ly,3,0,Math.PI*2); ctx.fill();
  }
  const rp=(t/2200)%1;
  ctx.strokeStyle=`rgba(255,255,255,${0.22*(1-rp)})`; ctx.lineWidth=1;
  ctx.beginPath(); ctx.ellipse(x+102,y+82,16*rp+5,8*rp+2.5,0,0,Math.PI*2); ctx.stroke();
  ctx.fillStyle='#8a5a2a';
  for(let di=0;di<3;di++) ctx.fillRect(x+w-4,y+h/2-20+di*15,30,11);
  ctx.fillStyle='#5a3a18'; ctx.fillRect(x+w+24,y+h/2-26,8,56);
  ctx.strokeStyle='rgba(200,200,200,0.4)'; ctx.lineWidth=0.7;
  ctx.beginPath(); ctx.moveTo(x+w+28,y+h/2-26); ctx.lineTo(x+w+50,y+h/2+30); ctx.stroke();
  ctx.fillStyle='#4488cc'; ctx.beginPath(); ctx.arc(x+w+50,y+h/2+30,2,0,Math.PI*2); ctx.fill();
}

function drawBrick(ctx: CanvasRenderingContext2D, x:number,y:number,w:number,h:number,brick:string,mortar:string) {
  const BW=17,BH=8,GAP=1.5;
  ctx.fillStyle=mortar; ctx.fillRect(x,y,w,h);
  ctx.fillStyle=brick;
  for(let row=0;row*BH<h;row++){
    const off=(row%2)*(BW/2);
    for(let col=-1;col*BW<w+BW;col++){
      const bx=x+col*BW+off,by=y+row*BH;
      const rx=Math.max(x,bx+GAP/2),ry=Math.max(y,by+GAP/2);
      const rw=Math.min(x+w,bx+BW-GAP)-rx;
      const rh=Math.min(y+h,by+BH-GAP)-ry;
      if(rw>1&&rh>1){
        ctx.fillStyle=brick; ctx.fillRect(rx,ry,rw,rh);
        ctx.fillStyle='rgba(255,255,255,0.07)'; ctx.fillRect(rx,ry,rw,1.5);
      }
    }
  }
}

function drawTree(ctx: CanvasRenderingContext2D,x:number,y:number,s=1) {
  ctx.fillStyle='rgba(0,0,0,0.18)';
  ctx.beginPath(); ctx.ellipse(x+3*s,y+5*s,17*s,6.5*s,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#7a5030'; ctx.fillRect(x-4*s,y-3*s,8*s,16*s);
  ctx.fillStyle='#6a4020'; ctx.fillRect(x-2*s,y-3*s,3*s,14*s);
  ctx.fillStyle='#1e6014'; ctx.beginPath(); ctx.arc(x,y-12*s,18*s,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#2a7820'; ctx.beginPath(); ctx.arc(x-6*s,y-18*s,13*s,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#2e8824'; ctx.beginPath(); ctx.arc(x+5*s,y-23*s,11*s,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#3a9830'; ctx.beginPath(); ctx.arc(x-2*s,y-27*s,8.5*s,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle='rgba(0,0,0,0.16)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.arc(x,y-16*s,18*s,0,Math.PI*2); ctx.stroke();
  ctx.fillStyle='rgba(160,255,100,0.2)'; ctx.beginPath(); ctx.arc(x+2*s,y-29*s,5*s,0,Math.PI*2); ctx.fill();
}

function drawBarrel(ctx: CanvasRenderingContext2D,x:number,y:number){
  ctx.fillStyle='#7a4a20'; ctx.fillRect(x-7,y-10,14,18);
  ctx.strokeStyle='#4a2a10'; ctx.lineWidth=1.5; ctx.strokeRect(x-7,y-10,14,18);
  ctx.strokeStyle='#c07a30'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(x-7,y-4); ctx.lineTo(x+7,y-4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x-7,y+2); ctx.lineTo(x+7,y+2); ctx.stroke();
}

function drawCrate(ctx: CanvasRenderingContext2D,x:number,y:number){
  ctx.fillStyle='#a07840'; ctx.fillRect(x-10,y-10,20,18);
  ctx.strokeStyle='#6a4a20'; ctx.lineWidth=1.2; ctx.strokeRect(x-10,y-10,20,18);
  ctx.beginPath(); ctx.moveTo(x-10,y-10); ctx.lineTo(x+10,y+8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x+10,y-10); ctx.lineTo(x-10,y+8); ctx.stroke();
}

function drawBench(ctx: CanvasRenderingContext2D,x:number,y:number){
  ctx.fillStyle='#5a3818'; ctx.fillRect(x-15,y+2,5,9); ctx.fillRect(x+10,y+2,5,9);
  ctx.fillStyle='#8a5830'; ctx.fillRect(x-17,y-2,34,5);
  ctx.fillStyle='#7a4820'; ctx.fillRect(x-17,y-14,34,5);
  ctx.fillStyle='#5a3818'; ctx.fillRect(x-14,y-14,4,16); ctx.fillRect(x+10,y-14,4,16);
}

function drawLamppost(ctx: CanvasRenderingContext2D,x:number,y:number,t:number){
  ctx.fillStyle='#4a4858'; ctx.fillRect(x-2,y-50,4,50);
  ctx.fillStyle='#3a3848'; ctx.fillRect(x-3,y,6,8);
  ctx.strokeStyle='#5a5870'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(x,y-50); ctx.lineTo(x+14,y-48); ctx.stroke();
  ctx.fillStyle='#ffe890'; ctx.beginPath(); ctx.arc(x+14,y-48,6,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='rgba(255,230,100,0.2)'; ctx.beginPath(); ctx.arc(x+14,y-48,24,0,Math.PI*2); ctx.fill();
  const glow=0.1+0.06*Math.sin(t/600);
  ctx.fillStyle=`rgba(255,220,100,${glow})`; ctx.beginPath(); ctx.arc(x+14,y-48,42,0,Math.PI*2); ctx.fill();
}

function drawFountain(ctx: CanvasRenderingContext2D,x:number,y:number,t:number){
  ctx.fillStyle='#8a8070'; ctx.beginPath(); ctx.ellipse(x,y+10,28,11,0,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle='#6a6050'; ctx.lineWidth=2; ctx.beginPath(); ctx.ellipse(x,y+10,28,11,0,0,Math.PI*2); ctx.stroke();
  ctx.fillStyle='#5ab0e0'; ctx.beginPath(); ctx.ellipse(x,y+10,22,8,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#9a9088'; ctx.fillRect(x-4,y-24,8,34);
  ctx.fillStyle='#7a7068'; ctx.fillRect(x-6,y-28,12,6);
  const sp=(t/500)%1;
  for(let i=0;i<8;i++){
    const a=(i/8)*Math.PI*2;
    const sf=(sp+i*0.125)%1;
    ctx.fillStyle=`rgba(100,200,255,${0.55*(1-sf)})`;
    ctx.beginPath(); ctx.arc(x+Math.cos(a)*sf*14,y-24-sf*14+sf*sf*10,2.5-sf*1.5,0,Math.PI*2); ctx.fill();
  }
}

function drawBuilding(ctx: CanvasRenderingContext2D, b: Bld, active: boolean, t: number) {
  const {x,y,w,h,brick,mortar,roof,roofTop,peaks,sideColor}=b;
  const SIDE=10, RHTOP=10, RH=34;
  ctx.fillStyle='rgba(0,0,0,0.24)'; ctx.fillRect(x+16,y+18,w,h);
  ctx.fillStyle=roofTop; ctx.fillRect(x,y,w,RHTOP);
  ctx.strokeStyle='rgba(0,0,0,0.2)'; ctx.lineWidth=1;
  for(let rs=2;rs<RHTOP;rs+=3){ ctx.beginPath(); ctx.moveTo(x,y+rs); ctx.lineTo(x+w,y+rs); ctx.stroke(); }
  ctx.fillStyle=roof; ctx.fillRect(x-4,y+RHTOP,w+8,RH-RHTOP);
  const peakW=w/peaks;
  for(let p=0;p<peaks;p++){
    ctx.beginPath();
    ctx.moveTo(x+p*peakW-3,y+RH);
    ctx.lineTo(x+p*peakW+peakW/2,y+RHTOP+3);
    ctx.lineTo(x+p*peakW+peakW+3,y+RH);
    ctx.closePath(); ctx.fillStyle=roof; ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.15)'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(x+p*peakW-3,y+RH); ctx.lineTo(x+p*peakW+peakW/2,y+RHTOP+3); ctx.stroke();
    ctx.fillStyle='#b0a090'; ctx.fillRect(x+p*peakW+peakW/2-3,y+RHTOP,6,RH-RHTOP);
  }
  ctx.fillStyle='#a09080'; ctx.fillRect(x-5,y+RH-5,w+10,6);
  ctx.fillStyle=sideColor;
  ctx.beginPath();
  ctx.moveTo(x+w,y+RH); ctx.lineTo(x+w+SIDE,y+RH+4);
  ctx.lineTo(x+w+SIDE,y+h+4); ctx.lineTo(x+w,y+h);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle='rgba(0,0,0,0.15)'; ctx.lineWidth=0.5;
  for(let sb=y+RH;sb<y+h;sb+=9){ ctx.beginPath(); ctx.moveTo(x+w,sb); ctx.lineTo(x+w+SIDE,sb+2); ctx.stroke(); }
  const wallTop=y+RH;
  drawBrick(ctx,x,wallTop,w,h-RH+4,brick,mortar);
  const shade=ctx.createLinearGradient(x,0,x+w,0);
  shade.addColorStop(0,'rgba(255,255,255,0.07)'); shade.addColorStop(0.7,'transparent'); shade.addColorStop(1,'rgba(0,0,0,0.28)');
  ctx.fillStyle=shade; ctx.fillRect(x,wallTop,w,h-RH+4);
  if(peaks>=3){
    const cx=x+w*0.72;
    ctx.fillStyle=mortar; ctx.fillRect(cx,y-12,14,18);
    ctx.fillStyle='#8a7060'; ctx.fillRect(cx-2,y-14,18,5);
    const sf=(t/750)%1;
    for(let si=0;si<3;si++){
      const sp=(sf+si*0.33)%1;
      ctx.fillStyle=`rgba(200,200,215,${0.38*(1-sp)})`;
      ctx.beginPath(); ctx.arc(cx+7+sp*5,y-14-sp*18,4+sp*6,0,Math.PI*2); ctx.fill();
    }
  }
  const winY=wallTop+10, winW=16, winH=14;
  const wpos:number[]= w>160?[x+16,x+w/2-winW/2,x+w-16-winW]:[x+16,x+w-16-winW];
  for(const wx of wpos){
    ctx.fillStyle='#b0a090'; ctx.fillRect(wx-3,winY+winH,winW+6,3);
    ctx.fillStyle='#3a2010'; ctx.fillRect(wx-2,winY-2,winW+4,winH+4);
    ctx.fillStyle=active?'#ffd870':'#82badf'; ctx.fillRect(wx,winY,winW,winH);
    ctx.fillStyle=active?'rgba(255,220,0,0.35)':'rgba(180,220,255,0.45)';
    ctx.fillRect(wx,winY,winW/2,winH/2);
    ctx.fillStyle='rgba(0,0,0,0.22)';
    ctx.fillRect(wx+winW/2-0.5,winY,1,winH); ctx.fillRect(wx,winY+winH/2-0.5,winW,1);
    if(active){ ctx.fillStyle=`rgba(255,220,0,${0.18+0.13*Math.sin(t/200+wx)})`; ctx.fillRect(wx,winY,winW,winH); }
  }
  const dw=22,dh=28,dx2=x+w/2-dw/2;
  ctx.fillStyle='#b8a888'; ctx.fillRect(dx2-4,y+h-4,dw+8,7);
  ctx.fillStyle='#4a2c0e'; ctx.fillRect(dx2,y+h-dh,dw,dh);
  ctx.fillStyle='#4a2c0e'; ctx.beginPath(); ctx.arc(dx2+dw/2,y+h-dh,dw/2,Math.PI,0); ctx.fill();
  ctx.fillStyle='#3a1e08';
  ctx.fillRect(dx2+3,y+h-dh+5,(dw-8)/2,dh*0.38);
  ctx.fillRect(dx2+dw/2+1,y+h-dh+5,(dw-8)/2,dh*0.38);
  ctx.fillStyle='#d4a030'; ctx.beginPath(); ctx.arc(dx2+dw-5,y+h-10,2.5,0,Math.PI*2); ctx.fill();
  const sw=Math.min(w-10,120),sx=x+w/2-sw/2,sy=y+RH+4;
  ctx.fillStyle='#9a6820'; ctx.fillRect(sx,sy,sw,22);
  ctx.fillStyle='#6a4810'; ctx.fillRect(sx,sy,sw,3); ctx.fillRect(sx,sy+19,sw,3);
  ctx.fillStyle='#1a0800'; ctx.fillRect(sx,sy+3,sw,16);
  ctx.fillStyle='#7a4a10'; ctx.fillRect(sx+8,sy+22,4,8); ctx.fillRect(sx+sw-12,sy+22,4,8);
  ctx.font='bold 8.5px Consolas,monospace'; ctx.fillStyle='#f0da80'; ctx.textAlign='center';
  ctx.fillText(b.name,x+w/2,sy+16);
  ctx.fillStyle='#c0aa80'; ctx.fillRect(x-10,y+h-18,w+20+SIDE,26);
  ctx.strokeStyle='#a09068'; ctx.lineWidth=0.8;
  for(let fx=x-10;fx<x+w+SIDE+10;fx+=28){ ctx.beginPath(); ctx.moveTo(fx,y+h-18); ctx.lineTo(fx,y+h+8); ctx.stroke(); }
  if(active){
    ctx.shadowColor=brick+'cc'; ctx.shadowBlur=20+8*Math.sin(t/300);
    ctx.strokeStyle=brick+'aa'; ctx.lineWidth=3;
    ctx.strokeRect(x-2,y-2,w+4,h+4);
    ctx.shadowBlur=0;
  }
}

function drawPixelAgent(ctx: CanvasRenderingContext2D, a: Agent, t: number) {
  const walking=a.status==='moving';
  const bob=walking?Math.sin(t/140)*2.5:0;
  const x=a.px, y=a.py+bob;
  const P=2.2;
  ctx.fillStyle='rgba(0,0,0,0.22)';
  ctx.beginPath(); ctx.ellipse(x,y+11*P,7.5*P,2.8*P,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#2a1a0a';
  if(walking){
    const ls=Math.sin(t/140)*4*P;
    ctx.fillRect(x-3*P,y+P,3*P,5.5*P+ls); ctx.fillRect(x,y+P,3*P,5.5*P-ls);
    ctx.fillStyle='#1a0800';
    ctx.fillRect(x-4*P,y+5.5*P+ls,4.5*P,2*P); ctx.fillRect(x,y+5.5*P-ls,4.5*P,2*P);
  } else {
    ctx.fillRect(x-3*P,y+P,6*P,6.5*P);
    ctx.fillStyle='#1a0800'; ctx.fillRect(x-3.5*P,y+6.5*P,4*P,1.8*P);
  }
  ctx.fillStyle=a.col; ctx.fillRect(x-4*P,y-5*P,8*P,7*P);
  ctx.fillStyle='rgba(255,255,255,0.18)'; ctx.fillRect(x-4*P,y-5*P,8*P,2*P);
  const as2=walking?Math.sin(t/140)*2*P:0;
  ctx.fillStyle=a.col;
  ctx.fillRect(x-6.5*P,y-4.5*P+as2,2.5*P,5*P);
  ctx.fillRect(x+4*P,y-4.5*P-as2,2.5*P,5*P);
  ctx.fillStyle='#f0c888';
  ctx.beginPath(); ctx.arc(x-5.5*P,y+P/2+as2,P,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(x+5.5*P,y+P/2-as2,P,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#f0c888'; ctx.fillRect(x-3*P,y-11*P,6*P,6*P);
  ctx.fillStyle='#2a0800';
  ctx.fillRect(x-2*P,y-9*P,P,P); ctx.fillRect(x+P,y-9*P,P,P);
  ctx.fillStyle='#c09060'; ctx.fillRect(x-P,y-6.5*P,2*P,P);
  ctx.fillStyle=a.hatCol;
  ctx.fillRect(x-5.5*P,y-14*P,11*P,2.2*P);
  ctx.fillRect(x-3.5*P,y-17.5*P,7*P,4*P);
  ctx.fillStyle='rgba(255,255,255,0.22)'; ctx.fillRect(x-3.5*P,y-17.5*P,7*P,P);
  if(a.status==='working'||a.status==='thinking'){
    ctx.save(); ctx.translate(x+9*P,y-15*P); ctx.rotate(t/(a.status==='thinking'?180:280));
    ctx.strokeStyle=a.status==='thinking'?'#aa88ff':'#ffdd00'; ctx.lineWidth=1.5;
    for(let gi=0;gi<6;gi++){
      const ga=(gi/6)*Math.PI*2;
      ctx.beginPath(); ctx.moveTo(Math.cos(ga)*3,Math.sin(ga)*3); ctx.lineTo(Math.cos(ga)*7,Math.sin(ga)*7); ctx.stroke();
    }
    ctx.restore();
  }
  ctx.font='bold 9px Consolas,monospace'; ctx.textAlign='center';
  const tw=ctx.measureText(a.name).width;
  const lw=tw+10,lh=15,lx=x-lw/2,ly=y-25*P;
  ctx.fillStyle='#e8d460'; ctx.fillRect(lx,ly,lw,lh);
  ctx.strokeStyle='#8a7000'; ctx.lineWidth=1; ctx.strokeRect(lx,ly,lw,lh);
  ctx.fillStyle='#1a0800'; ctx.fillText(a.name,x,ly+lh-3);
  if(a.task||a.thought){
    ctx.font='7px Consolas,monospace';
    ctx.fillStyle='rgba(255,255,200,0.75)';
    ctx.fillText((a.thought||a.task).slice(0,18),x,ly-4);
  }
}

// ── Opdracht types ─────────────────────────────────────────────────────────────
interface Opdracht {
  id: number;
  raw: string;
  type: 'idea'|'research'|'market'|'other';
  agentIds: string[];
  doneAgents: string[];
  status: 'bezig'|'klaar'|'fout';
  startedAt: number;
  finishedAt?: number;
  resultCount: number;
}

interface IdeaEntry { id:number; topic:string; agentId:string; response:string; saved:boolean; }
interface MarketEntry { symbol:string; eur:number; usd:number; change24h:number; }

const AGENT_COLORS: Record<string,string> = {
  forge:'#ff7a2a', apex:'#00d9ff', tactix:'#00ff9d', spark:'#ffb800', vega:'#ff2d55', atlas:'#00b4ff'
};

// ── Component ──────────────────────────────────────────────────────────────────
export function EcosystemPage({ onClose }: { onClose: () => void }) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const agentsRef  = useRef<Agent[]>(initAgents());
  const rafRef     = useRef(0);
  const runningRef = useRef(true);
  const cmdRef     = useRef<HTMLInputElement>(null);
  const ideaIdRef  = useRef(0);
  const opdrachtIdRef = useRef(0);

  const [agents,     setAgents]    = useState<Agent[]>(agentsRef.current);
  const [running,    setRunning]   = useState(true);
  const [panel,      setPanel]     = useState<'opdrachten'|'data'>('opdrachten');
  const [opdrachten, setOpdrachten]= useState<Opdracht[]>([]);
  const [ideas,      setIdeas]     = useState<IdeaEntry[]>([]);
  const [market,     setMarket]    = useState<MarketEntry[]>([]);
  const [dataCount,  setDataCount] = useState(0);
  const [cmdText,    setCmdText]   = useState('');
  const [cmdLog,     setCmdLog]    = useState<string[]>(['▶ NEXUS klaar. Typ "help" voor commando\'s.']);
  const [loading,    setLoading]   = useState(false);
  const [selectedOpdracht, setSelectedOpdracht] = useState<number|null>(null);

  const mono = '"Cascadia Code",Consolas,monospace';
  const pick = useCallback(<T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)], []);

  // ── Game tick (agent movement) ───────────────────────────────────────────────
  const tick = useCallback(() => {
    if (!runningRef.current) return;
    const as = agentsRef.current;
    for (const a of as) {
      if (a.status === 'idle') {
        const adj = EDGES.filter(([x,y]) => x===a.curId||y===a.curId).map(([x,y])=>x===a.curId?y:x);
        if (Math.random() < 0.5 && adj.length) {
          const dest = Math.random() < 0.15 ? pick(BLDS.map(b=>b.id)) : pick(adj);
          if (dest !== a.curId) {
            const path = bfs(a.curId, dest).slice(1);
            if (path.length) { a.path=path; a.status='moving'; const nxt=bc(a.path[0]); a.tx=nxt.x; a.ty=nxt.y; continue; }
          }
        }
        const room = BLDS.find(b=>b.id===a.curId)!;
        a.status='working'; a.workTick=5+Math.floor(Math.random()*9);
        a.task=pick(AI_TASKS[room.taskType]);
      } else if (a.status === 'working') {
        a.workTick--;
        if (a.workTick <= 0) { a.task=''; a.status='idle'; }
      }
    }
    setAgents([...agentsRef.current]);
  }, [pick]);

  // ── Canvas loop ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const SPEED = 1.4;
    canvas.width = GW; canvas.height = GH;
    const tickIv = setInterval(tick, 980);
    const draw = (ts: number) => {
      ctx.clearRect(0,0,GW,GH);
      const t = ts;
      drawCheckerGrass(ctx);
      drawFences(ctx);
      drawPaths(ctx);
      drawWater(ctx,t);
      drawFountain(ctx,570,420,t);
      for(const [bx,by] of BARRELS) drawBarrel(ctx,bx,by);
      for(const [cx,cy] of CRATES)  drawCrate(ctx,cx,cy);
      for(const [bx,by] of BENCHES) drawBench(ctx,bx,by);
      for(const [lx,ly] of LANTERNS) drawLamppost(ctx,lx,ly,t);
      for(const [tx,ty,ts2] of TREES) drawTree(ctx,tx,ty,ts2);
      for(const b of BLDS){
        const act=agentsRef.current.filter(a=>a.curId===b.id&&a.status==='working');
        drawBuilding(ctx,b,act.length>0,t);
      }
      for(const a of agentsRef.current){
        if(a.status==='moving'){
          const dx=a.tx-a.px,dy=a.ty-a.py;
          const dist=Math.sqrt(dx*dx+dy*dy);
          if(dist>1.5){ a.px+=(dx/dist)*SPEED; a.py+=(dy/dist)*SPEED; }
          else {
            a.px=a.tx; a.py=a.ty; a.curId=a.path[0]; a.path.shift();
            if(a.path.length>0){ const nxt=bc(a.path[0]); a.tx=nxt.x; a.ty=nxt.y; }
            else a.status='idle';
          }
        }
        drawPixelAgent(ctx,a,t);
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(rafRef.current); clearInterval(tickIv); };
  }, [tick]);

  // ── Market ───────────────────────────────────────────────────────────────────
  const fetchMarket = useCallback(async () => {
    try {
      const res = await fetch('/api/ecosystem/market');
      if (!res.ok) return;
      const d = await res.json();
      setMarket(Object.entries(d).map(([k,v]:any) => ({
        symbol: k.toUpperCase(), eur: v.eur??0, usd: v.usd??0,
        change24h: v.eur_24h_change??v.usd_24h_change??0,
      })));
    } catch {}
  }, []);

  useEffect(() => { fetchMarket(); const iv=setInterval(fetchMarket, 30000); return ()=>clearInterval(iv); }, [fetchMarket]);
  useEffect(() => { fetch('/api/ecosystem/dataset').then(r=>r.json()).then(d=>setDataCount(d.total??0)).catch(()=>{}); }, []);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const addLog = (line: string) => setCmdLog(p=>[...p, line].slice(-80));

  const setAgentThinking = useCallback((agentId: string, thinking: boolean) => {
    const a = agentsRef.current.find(a=>a.id===agentId);
    if (a) { a.status = thinking ? 'thinking' : 'idle'; a.thought = thinking ? 'Verwerkt...' : ''; }
  }, []);

  // ── Opdracht management ───────────────────────────────────────────────────────
  const createOpdracht = useCallback((raw: string, type: Opdracht['type'], agentIds: string[]): Opdracht => {
    const od: Opdracht = {
      id: ++opdrachtIdRef.current, raw, type, agentIds,
      doneAgents: [], status: 'bezig', startedAt: Date.now(), resultCount: 0,
    };
    setOpdrachten(p => [od, ...p].slice(0, 30));
    setPanel('opdrachten');
    return od;
  }, []);

  const updateOpdracht = useCallback((id: number, update: Partial<Opdracht>) => {
    setOpdrachten(p => p.map(o => o.id === id ? {...o, ...update} : o));
  }, []);

  // ── Idea generation ───────────────────────────────────────────────────────────
  const generateIdeas = useCallback(async (topic: string) => {
    setLoading(true);
    const agentIds = ['forge','apex','tactix','spark','vega','atlas'];
    const od = createOpdracht(`idea ${topic}`, 'idea', agentIds);
    addLog(`▶ Agents genereren ideeën: "${topic}"`);
    let doneCount = 0;
    for (const agentId of agentIds) {
      setAgentThinking(agentId, true);
      try {
        const res = await fetch('/api/ecosystem/idea', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ topic, agentId })
        });
        const data = await res.json();
        if (data.response) {
          doneCount++;
          const entry: IdeaEntry = { id: ++ideaIdRef.current, topic, agentId, response: data.response, saved: false };
          setIdeas(p=>[entry,...p].slice(0,60));
          updateOpdracht(od.id, { doneAgents: agentIds.slice(0, doneCount), resultCount: doneCount });
          addLog(`  ✓ [${agentId.toUpperCase()}] bijdrage ontvangen`);
        }
      } catch { addLog(`  ✗ [${agentId.toUpperCase()}] offline`); }
      setAgentThinking(agentId, false);
    }
    updateOpdracht(od.id, { status: 'klaar', finishedAt: Date.now(), doneAgents: agentIds.slice(0, doneCount), resultCount: doneCount });
    setLoading(false);
    addLog(`✓ Opdracht klaar — ${doneCount} ideeën gegenereerd.`);
  }, [createOpdracht, updateOpdracht, setAgentThinking]);

  // ── Research ──────────────────────────────────────────────────────────────────
  const doResearch = useCallback(async (query: string) => {
    setLoading(true);
    const agentIds = ['spark','tactix','atlas'];
    const od = createOpdracht(`research ${query}`, 'research', agentIds);
    addLog(`▶ Onderzoek gestart: "${query}"`);
    let doneCount = 0;
    for (const agentId of agentIds) {
      setAgentThinking(agentId, true);
      try {
        const res = await fetch('/api/ecosystem/research', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ query, agentId })
        });
        const data = await res.json();
        if (data.response) {
          doneCount++;
          const entry: IdeaEntry = { id: ++ideaIdRef.current, topic: `[RESEARCH] ${query}`, agentId, response: data.response, saved: false };
          setIdeas(p=>[entry,...p].slice(0,60));
          updateOpdracht(od.id, { doneAgents: agentIds.slice(0, doneCount), resultCount: doneCount });
        }
      } catch {}
      setAgentThinking(agentId, false);
    }
    updateOpdracht(od.id, { status: 'klaar', finishedAt: Date.now(), resultCount: doneCount });
    setLoading(false);
    addLog(`✓ Onderzoek klaar — ${doneCount} resultaten.`);
  }, [createOpdracht, updateOpdracht, setAgentThinking]);

  // ── Save ideas ────────────────────────────────────────────────────────────────
  const saveIdeas = useCallback(async () => {
    const unsaved = ideas.filter(i=>!i.saved);
    if (!unsaved.length) { addLog('Niets nieuws om op te slaan.'); return; }
    for (const idea of unsaved) {
      await fetch('/api/ecosystem/save', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ type:'ecosystem_idea', ...idea })
      }).catch(()=>{});
      idea.saved = true;
    }
    setIdeas([...ideas]);
    const dc = dataCount + unsaved.length;
    setDataCount(dc);
    addLog(`✓ ${unsaved.length} items opgeslagen. Dataset: ${dc}`);
  }, [ideas, dataCount]);

  // ── Command handler ────────────────────────────────────────────────────────────
  const handleCommand = useCallback(async (raw: string) => {
    const cmd = raw.trim().toLowerCase();
    if (!cmd) return;
    addLog(`› ${raw}`);
    setCmdText('');
    if (cmd === 'help') {
      addLog('  idea [onderwerp]   — agents genereren ideeën');
      addLog('  research [query]   — diep onderzoek door 3 agents');
      addLog('  market             — live crypto marktdata');
      addLog('  save               — sla resultaten op als dataset');
      addLog('  export             — download dataset als JSON');
      addLog('  clear              — leeg log');
      addLog('  pause / start      — pauzeer/hervat agents');
    } else if (cmd.startsWith('idea ')) {
      await generateIdeas(raw.slice(5).trim());
    } else if (cmd.startsWith('research ')) {
      await doResearch(raw.slice(9).trim());
    } else if (cmd === 'market') {
      const od = createOpdracht('market', 'market', []);
      setPanel('opdrachten');
      await fetchMarket();
      setMarket(m => m);
      updateOpdracht(od.id, { status:'klaar', finishedAt: Date.now() });
      addLog('✓ Marktdata bijgewerkt.');
    } else if (cmd === 'save') {
      await saveIdeas();
    } else if (cmd === 'export') {
      const res = await fetch('/api/ecosystem/dataset').catch(()=>null);
      if (res?.ok) {
        const d = await res.json();
        const blob = new Blob([JSON.stringify(d.entries, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        Object.assign(document.createElement('a'),{href:url,download:`nexus-dataset-${Date.now()}.json`}).click();
        URL.revokeObjectURL(url);
        addLog(`✓ Export klaar: ${d.total} items.`);
      }
    } else if (cmd === 'clear') {
      setCmdLog([]);
    } else if (cmd === 'pause') {
      runningRef.current = false; setRunning(false); addLog('⏸ Agents gepauzeerd.');
    } else if (cmd === 'start') {
      runningRef.current = true; setRunning(true); addLog('▶ Agents hervat.');
    } else {
      addLog(`? Onbekend commando: "${cmd}". Typ "help".`);
    }
  }, [generateIdeas, doResearch, saveIdeas, fetchMarket, createOpdracht, updateOpdracht]);

  const handleKey = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleCommand(cmdText);
  }, [cmdText, handleCommand]);

  const activeOpdrachten = opdrachten.filter(o => o.status === 'bezig').length;
  const selectedOp = opdrachten.find(o => o.id === selectedOpdracht);
  const selectedIdeas = selectedOp
    ? ideas.filter(i => i.topic.replace('[RESEARCH] ','').includes(selectedOp.raw.replace(/^(idea|research) /,'')))
    : [];

  // time formatter
  const elapsed = (ms: number) => {
    const s = Math.floor(ms/1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s/60)}m ${s%60}s`;
  };

  return (
    <div style={{ position:'fixed', inset:0, zIndex:100, background:'#080f06', display:'flex', flexDirection:'column', overflow:'hidden', fontFamily:mono }}>

      {/* ── Top HUD ── */}
      <div style={{ display:'flex', alignItems:'center', padding:'5px 14px', background:'rgba(0,0,0,0.85)', borderBottom:'2px solid #1a3a0a', gap:12, flexShrink:0 }}>
        {/* Logo */}
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <div style={{ width:18, height:18, background:'#00ff88', clipPath:'polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%)', flexShrink:0 }} />
          <span style={{ fontSize:13, fontWeight:900, color:'#a8ff80', letterSpacing:'0.15em' }}>NEXUS</span>
          <span style={{ fontSize:8, color:'rgba(150,255,100,0.3)', letterSpacing:'0.1em' }}>ECOSYSTEM v4.0</span>
        </div>

        <div style={{ width:1, height:22, background:'rgba(0,255,100,0.1)' }} />

        {/* Agent status dots */}
        <div style={{ display:'flex', gap:4, alignItems:'center' }}>
          {agents.map(a=>(
            <div key={a.id} title={`${a.name}: ${a.status}`} style={{ width:8, height:8, borderRadius:'50%', background:a.col, opacity:a.status!=='idle'?1:0.3, boxShadow:a.status!=='idle'?`0 0 6px ${a.col}`:'' }} />
          ))}
        </div>

        <div style={{ flex:1 }} />

        {/* Counters */}
        <div style={{ display:'flex', gap:6 }}>
          <div style={{ display:'flex', alignItems:'center', gap:5, padding:'3px 10px', background:activeOpdrachten>0?'rgba(255,180,0,0.08)':'rgba(0,200,100,0.05)', border:`1px solid ${activeOpdrachten>0?'rgba(255,180,0,0.25)':'rgba(0,200,100,0.15)'}`, borderRadius:4 }}>
            <span style={{ fontSize:7, color:activeOpdrachten>0?'#ffb800':'rgba(0,200,100,0.5)', letterSpacing:'0.12em', textTransform:'uppercase' }}>Opdrachten</span>
            <span style={{ fontSize:13, fontWeight:900, color:activeOpdrachten>0?'#ffb800':'#40cc80' }}>{activeOpdrachten > 0 ? `${activeOpdrachten} ●` : opdrachten.length}</span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:5, padding:'3px 10px', background:'rgba(0,180,255,0.05)', border:'1px solid rgba(0,180,255,0.15)', borderRadius:4 }}>
            <span style={{ fontSize:7, color:'rgba(0,180,255,0.5)', letterSpacing:'0.12em', textTransform:'uppercase' }}>Dataset</span>
            <span style={{ fontSize:13, fontWeight:900, color:'#22d3ff' }}>{dataCount}</span>
          </div>
        </div>

        {loading && (
          <div style={{ display:'flex', alignItems:'center', gap:4, padding:'3px 8px', background:'rgba(140,80,255,0.08)', border:'1px solid rgba(140,80,255,0.2)', borderRadius:4 }}>
            <div style={{ width:6, height:6, borderRadius:'50%', background:'#aa80ff', animation:'none', opacity:0.9 }} />
            <span style={{ fontSize:8, color:'#aa80ff', letterSpacing:'0.08em' }}>AGENTS BEZIG</span>
          </div>
        )}

        <div style={{ width:1, height:22, background:'rgba(0,255,100,0.08)' }} />
        <button onClick={()=>{runningRef.current=!running;setRunning(!running);}}
          style={{ fontFamily:mono, fontSize:8, fontWeight:700, padding:'4px 12px', cursor:'pointer', background:running?'rgba(255,45,85,0.08)':'rgba(0,255,157,0.08)', border:`1px solid ${running?'rgba(255,45,85,0.3)':'rgba(0,255,157,0.3)'}`, color:running?'#ff4455':'#00ff9d', borderRadius:3 }}>
          {running?'⏸ PAUSE':'▶ START'}
        </button>
        <button onClick={onClose}
          style={{ fontFamily:mono, fontSize:8, fontWeight:700, padding:'4px 12px', cursor:'pointer', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.35)', borderRadius:3 }}>
          ✕
        </button>
      </div>

      {/* ── Main body ── */}
      <div style={{ flex:1, display:'flex', overflow:'hidden' }}>

        {/* ── Canvas ── */}
        <div style={{ flex:'1 1 0', position:'relative', overflow:'hidden', background:'#1a2e12' }}>
          <canvas ref={canvasRef} style={{ position:'absolute', inset:0, width:'100%', height:'100%', imageRendering:'pixelated' }} />
        </div>

        {/* ── Right panel ── */}
        <div style={{ width:320, flexShrink:0, display:'flex', flexDirection:'column', background:'rgba(4,8,3,0.97)', borderLeft:'1px solid #1a3a0a' }}>

          {/* Tabs */}
          <div style={{ display:'flex', borderBottom:'1px solid #1a2a0a', flexShrink:0 }}>
            {([['opdrachten','⚡ OPDRACHTEN'],['data','💾 DATASET']] as [typeof panel, string][]).map(([id,label])=>(
              <button key={id} onClick={()=>setPanel(id)}
                style={{ flex:1, padding:'9px 4px', fontFamily:mono, fontSize:9, fontWeight:700, cursor:'pointer', border:'none', background:panel===id?'rgba(0,255,100,0.07)':'transparent', color:panel===id?'#80ff80':'rgba(255,255,255,0.25)', borderBottom:panel===id?'2px solid #50ff50':'2px solid transparent', letterSpacing:'0.06em', transition:'all 0.15s' }}>
                {label}
                {id==='opdrachten' && activeOpdrachten>0 && (
                  <span style={{ marginLeft:5, padding:'1px 5px', background:'rgba(255,180,0,0.2)', border:'1px solid rgba(255,180,0,0.4)', borderRadius:8, fontSize:8, color:'#ffb800' }}>{activeOpdrachten}</span>
                )}
              </button>
            ))}
          </div>

          {/* Panel content */}
          <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column' }}>

            {/* OPDRACHTEN panel */}
            {panel==='opdrachten' && (
              <div style={{ flex:1, display:'flex', flexDirection:'column' }}>
                {opdrachten.length === 0 ? (
                  <div style={{ padding:20, textAlign:'center', marginTop:40 }}>
                    <div style={{ fontSize:28, marginBottom:12, opacity:0.3 }}>⚡</div>
                    <div style={{ fontSize:9, color:'rgba(255,255,255,0.2)', lineHeight:1.8 }}>
                      Geen opdrachten.<br/>
                      <span style={{ color:'rgba(0,255,100,0.3)' }}>idea dropshipping europa</span><br/>
                      <span style={{ color:'rgba(0,180,255,0.3)' }}>research niche electronics</span><br/>
                      <span style={{ color:'rgba(255,180,0,0.3)' }}>market</span>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding:'10px 8px', display:'flex', flexDirection:'column', gap:6 }}>
                    {opdrachten.map(op => {
                      const isSelected = selectedOpdracht === op.id;
                      const progress = op.agentIds.length > 0 ? op.doneAgents.length / op.agentIds.length : 1;
                      const duration = op.finishedAt ? op.finishedAt - op.startedAt : Date.now() - op.startedAt;
                      return (
                        <div key={op.id}
                          onClick={() => setSelectedOpdracht(isSelected ? null : op.id)}
                          style={{ background:isSelected?'rgba(0,255,100,0.06)':'rgba(255,255,255,0.02)', border:`1px solid ${op.status==='bezig'?'rgba(255,180,0,0.25)':op.status==='klaar'?'rgba(0,255,100,0.15)':'rgba(255,80,80,0.2)'}`, borderRadius:4, cursor:'pointer', overflow:'hidden' }}>
                          {/* Header row */}
                          <div style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 8px' }}>
                            <div style={{ fontSize:14, lineHeight:1 }}>
                              {op.status==='bezig'?'⏳':op.status==='klaar'?'✓':'✗'}
                            </div>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontSize:9, fontWeight:700, color:op.status==='bezig'?'#ffb800':op.status==='klaar'?'#80ff80':'#ff6060', letterSpacing:'0.04em', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                                {op.raw.toUpperCase()}
                              </div>
                              <div style={{ fontSize:7.5, color:'rgba(255,255,255,0.25)', marginTop:2 }}>
                                {op.status==='bezig'?`${op.doneAgents.length}/${op.agentIds.length} agents`:
                                  op.status==='klaar'?`${op.resultCount} resultaat${op.resultCount!==1?'en':''} · ${elapsed(duration)}`:
                                  'mislukt'}
                              </div>
                            </div>
                            <div style={{ fontSize:7, color:'rgba(255,255,255,0.2)' }}>
                              {new Date(op.startedAt).toLocaleTimeString('nl',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
                            </div>
                          </div>

                          {/* Progress bar */}
                          {op.status==='bezig' && op.agentIds.length > 0 && (
                            <div style={{ height:3, background:'rgba(255,255,255,0.04)', margin:'0 8px 8px' }}>
                              <div style={{ height:'100%', width:`${progress*100}%`, background:'linear-gradient(90deg,#ffb800,#ff9900)', borderRadius:2, transition:'width 0.3s' }} />
                            </div>
                          )}

                          {/* Agent dots */}
                          {op.agentIds.length > 0 && (
                            <div style={{ display:'flex', gap:3, padding:'0 8px 7px', flexWrap:'wrap' }}>
                              {op.agentIds.map(id => (
                                <div key={id} style={{ display:'flex', alignItems:'center', gap:2, padding:'1px 5px', background:`${AGENT_COLORS[id]||'#888'}12`, border:`1px solid ${AGENT_COLORS[id]||'#888'}30`, borderRadius:8, fontSize:7.5 }}>
                                  <div style={{ width:4, height:4, borderRadius:'50%', background:op.doneAgents.includes(id)?AGENT_COLORS[id]||'#888':'rgba(255,255,255,0.15)' }} />
                                  <span style={{ color:op.doneAgents.includes(id)?AGENT_COLORS[id]||'#aaa':'rgba(255,255,255,0.2)' }}>{id}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Expanded results */}
                          {isSelected && selectedIdeas.length > 0 && (
                            <div style={{ borderTop:'1px solid rgba(255,255,255,0.05)', padding:'8px 8px' }}>
                              {selectedIdeas.map(idea => (
                                <div key={idea.id} style={{ marginBottom:8 }}>
                                  <div style={{ display:'flex', alignItems:'center', gap:4, marginBottom:3 }}>
                                    <div style={{ width:5, height:5, borderRadius:'50%', background:AGENT_COLORS[idea.agentId]||'#888' }} />
                                    <span style={{ fontSize:8, fontWeight:700, color:AGENT_COLORS[idea.agentId]||'#aaa' }}>{idea.agentId.toUpperCase()}</span>
                                    {idea.saved && <span style={{ fontSize:7, color:'rgba(0,255,100,0.4)', marginLeft:'auto' }}>✓ SAVED</span>}
                                  </div>
                                  <div style={{ fontSize:8, color:'rgba(210,230,200,0.65)', lineHeight:1.55 }}>{idea.response}</div>
                                </div>
                              ))}
                              <button onClick={e=>{e.stopPropagation();saveIdeas();}}
                                style={{ width:'100%', marginTop:4, padding:'5px', fontFamily:mono, fontSize:8, fontWeight:700, cursor:'pointer', background:'rgba(0,255,100,0.06)', border:'1px solid rgba(0,255,100,0.18)', color:'#60ff60', borderRadius:3 }}>
                                💾 OPSLAAN ALS DATASET
                              </button>
                            </div>
                          )}

                          {/* Market results inline */}
                          {isSelected && op.type==='market' && market.length > 0 && (
                            <div style={{ borderTop:'1px solid rgba(255,255,255,0.05)', padding:'8px' }}>
                              {market.slice(0,8).map(m=>(
                                <div key={m.symbol} style={{ display:'flex', alignItems:'center', padding:'4px 0', borderBottom:'1px solid rgba(255,255,255,0.03)' }}>
                                  <span style={{ fontSize:8, fontWeight:700, color:'#e0d0a0', width:70 }}>{m.symbol}</span>
                                  <div style={{ flex:1 }}>
                                    <span style={{ fontSize:9, fontWeight:700, color:'#f0e060' }}>€{m.eur.toLocaleString('nl',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
                                  </div>
                                  <span style={{ fontSize:8.5, fontWeight:700, color:m.change24h>=0?'#00ff9d':'#ff4455' }}>
                                    {m.change24h>=0?'+':''}{m.change24h.toFixed(2)}%
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* DATA panel */}
            {panel==='data' && (
              <div style={{ padding:'12px 10px', flex:1, display:'flex', flexDirection:'column', gap:10 }}>
                <div style={{ fontSize:8, color:'rgba(0,255,100,0.35)', letterSpacing:'0.1em' }}>OPGESLAGEN ITEMS: {dataCount}</div>
                <div style={{ display:'flex', gap:6 }}>
                  <button onClick={saveIdeas}
                    style={{ flex:1, padding:'8px', fontFamily:mono, fontSize:9, fontWeight:700, cursor:'pointer', background:'rgba(0,255,100,0.06)', border:'1px solid rgba(0,255,100,0.18)', color:'#60ff60', borderRadius:3 }}>
                    💾 OPSLAAN
                  </button>
                  <button onClick={async()=>{
                    const r=await fetch('/api/ecosystem/dataset').catch(()=>null);
                    if(r?.ok){const d=await r.json();const b=new Blob([JSON.stringify(d.entries,null,2)],{type:'application/json'});const u=URL.createObjectURL(b);Object.assign(document.createElement('a'),{href:u,download:`nexus-dataset-${Date.now()}.json`}).click();URL.revokeObjectURL(u);}
                  }}
                    style={{ flex:1, padding:'8px', fontFamily:mono, fontSize:9, fontWeight:700, cursor:'pointer', background:'rgba(0,180,255,0.06)', border:'1px solid rgba(0,180,255,0.18)', color:'#22aaff', borderRadius:3 }}>
                    ⬇ EXPORT
                  </button>
                </div>
                <div style={{ fontSize:8, color:'rgba(255,255,255,0.15)', lineHeight:1.8 }}>
                  Dataset opgeslagen in:<br/>
                  <span style={{ color:'rgba(0,255,100,0.3)', fontSize:7.5 }}>nexus/data/ecosystem-dataset.jsonl</span><br/><br/>
                  Gebruik voor:<br/>
                  • Fine-tuning eigen model via QLoRA<br/>
                  • Analyse agent-gedrag<br/>
                  • Trainingsdata toekomstige agents
                </div>
                <div style={{ marginTop:'auto', padding:'10px 0 0', borderTop:'1px solid rgba(255,255,255,0.04)', fontSize:8, color:'rgba(255,255,255,0.1)' }}>
                  {ideas.length} ideeën gegenereerd dit sessie<br/>
                  {ideas.filter(i=>i.saved).length} opgeslagen
                </div>
              </div>
            )}
          </div>

          {/* ── Agent status bar ── */}
          <div style={{ borderTop:'1px solid #0f1e08', padding:'7px 8px', flexShrink:0 }}>
            <div style={{ display:'flex', flexWrap:'wrap', gap:3 }}>
              {agents.map(a=>(
                <div key={a.id} style={{ display:'flex', alignItems:'center', gap:2, padding:'2px 7px', background:`${a.col}0d`, border:`1px solid ${a.col}25`, borderRadius:10, fontSize:7.5 }}>
                  <div style={{ width:5, height:5, borderRadius:'50%', background:a.col, opacity:a.status!=='idle'?1:0.35, transition:'opacity 0.3s', boxShadow:a.status!=='idle'?`0 0 4px ${a.col}`:'' }} />
                  <span style={{ color:`${a.col}bb` }}>{a.name}</span>
                  <span style={{ color:'rgba(255,255,255,0.15)', fontSize:6.5 }}>
                    {a.status==='moving'?'→':a.status==='working'?'⚙':a.status==='thinking'?'◆':'·'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Command Line ── */}
      <div style={{ borderTop:'1px solid #1a3a0a', background:'rgba(0,4,0,0.95)', flexShrink:0 }}>
        <div style={{ maxHeight:68, overflowY:'auto', padding:'4px 14px 0' }}>
          {cmdLog.slice(-5).map((line,i)=>(
            <div key={i} style={{ fontSize:8.5, color:'rgba(160,220,160,0.45)', lineHeight:1.7, fontFamily:mono }}>{line}</div>
          ))}
        </div>
        <div style={{ display:'flex', alignItems:'center', padding:'4px 14px 7px', gap:8 }}>
          <span style={{ color:'#50ff50', fontSize:13, fontWeight:900, lineHeight:1 }}>›</span>
          <input
            ref={cmdRef} value={cmdText}
            onChange={e=>setCmdText(e.target.value)}
            onKeyDown={handleKey}
            placeholder="idea [onderwerp]  ·  research [query]  ·  market  ·  help"
            style={{ flex:1, background:'transparent', border:'none', outline:'none', fontFamily:mono, fontSize:10, color:'#b0ffb0', caretColor:'#50ff50' }}
          />
          <button onClick={()=>handleCommand(cmdText)}
            style={{ fontFamily:mono, fontSize:8, padding:'4px 12px', cursor:'pointer', background:'rgba(0,255,80,0.07)', border:'1px solid rgba(0,255,80,0.2)', color:'#40ff80', fontWeight:700, borderRadius:3 }}>
            ENTER
          </button>
        </div>
      </div>
    </div>
  );
}
