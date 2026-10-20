import { contours } from 'd3-contour'
import { geoPath } from 'd3-geo'
const W=200,H=125; const v=new Float64Array(W*H)
const bumps=[[20,20,34,1],[120,70,40,1.1],[70,110,30,-.7],[185,20,30,.8],[0,100,36,.9]]
for(let y=0;y<H;y++)for(let x=0;x<W;x++){let s=Math.sin(x/34+y/60)*.35+Math.cos(y/26+x/55)*.25;for(const[bx,by,r,a]of bumps)s+=a*Math.exp(-((x-bx)**2+(y-by)**2)/(2*r*r));v[y*W+x]=s}
const th=Array.from({length:30},(_,i)=>-0.9+i*0.075)
const path=geoPath(null)
const ds=contours().size([W,H]).smooth(true).thresholds(th)(v).map(c=>path(c)).filter(Boolean)
const round=s=>s.replace(/\d+\.\d+/g,m=>(+m).toFixed(1))
console.log(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"><g fill="none" stroke="#17130F" stroke-opacity=".2" stroke-width=".1">${ds.map(d=>`<path d="${round(d)}"/>`).join('')}</g></svg>`)
