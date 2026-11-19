var ut={xPct:94,yPct:22};function Me(e){return Boolean(e)&&typeof e==="object"&&!Array.isArray(e)}function be(e,t,n){if(!Number.isFinite(e))return t;if(t>n)return(t+n)/2;return Math.max(t,Math.min(n,e))}function Oe(e,t=2,n=98){return be(e,t,n)}function Gt(e){return Boolean(e)&&(typeof e==="object"||typeof e==="function")&&typeof e.then==="function"}function Ut(e){if(!Me(e))return null;if(typeof e.chatId==="string"&&e.chatId)return e.chatId;if(typeof e.id==="string"&&e.id)return e.id;if(Me(e.chat)&&typeof e.chat.id==="string"&&e.chat.id)return e.chat.id;return null}function ht(e){let t=e.trim();if(!t)return"GG";let n=t.split(/[\s_-]+/).filter(Boolean);if(n.length>=2)return`${n[0][0]??""}${n[1][0]??""}`.toUpperCase();return t.slice(0,2).toUpperCase()}function $e(e){return`/api/v1/characters/${encodeURIComponent(e)}/avatar?thumb=1`}function Te(e){if(typeof e!=="string")return;let t=e.trim();if(!t)return;if(t.startsWith("/")&&!t.startsWith("//"))return t;if(/^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(t))return t;try{let n=new URL(t);if(n.protocol==="http:"||n.protocol==="https:")return t}catch{}return}function Vt(e,t,n=0){return!(e.right+n<=t.left||e.left>=t.right+n||e.bottom+n<=t.top||e.top>=t.bottom+n)}class We{ctx;heads=new Map;headItemRefs=new Map;characterCache=new Map;pendingCharacterFetches=new Set;disposers=[];rootEl=null;resizeCleanup=null;dragCleanup=null;suppressClickTimer=null;suppressNextClick=!1;isDragging=!1;pos;destroyed=!1;constructor(e){this.ctx=e;if(this.pos=this.loadPosition(),typeof this.ctx.events?.on==="function")try{this.disposers.push(this.ctx.events.on("CHAT_DELETED",(t)=>{this.onChatDeleted(Ut(t))}))}catch{}}syncRuns(e,t){if(this.destroyed)return;let n=t!==void 0?t:this.safeGetActiveChatId();if(n){if(this.heads.get(n)?.status==="completed")this.heads.delete(n)}let i=new Map;for(let r of e){let s=r;if(s&&typeof s.chatId==="string"&&s.chatId.length>0)i.set(s.chatId,s)}for(let[r,s]of[...this.heads.entries()]){if(s.status==="completed")continue;if(!i.has(r))this.heads.delete(r)}for(let[,r]of i.entries())this.upsertFromActiveRun(r,n);this.render(n)}handleStatusEvent(e,t){if(this.destroyed)return;let n=t!==void 0?t:this.safeGetActiveChatId(),i=typeof e.chatId==="string"&&e.chatId.length>0?e.chatId:void 0,r=e.run??null,s=Boolean(e.done)||Boolean(e.aborted)||Boolean(e.error);if(i&&(s||!r||r.chatId!==i))this.finalizeChatRun(i,{aborted:Boolean(e.aborted),hasError:Boolean(e.error)},n);if(r&&typeof r.chatId==="string"&&r.chatId.length>0){if(!s||i!==void 0&&r.chatId!==i)this.upsertFromActiveRun(r,n);else if(!i&&s)this.finalizeChatRun(r.chatId,{aborted:Boolean(e.aborted),hasError:Boolean(e.error)},n)}else if(!i){for(let[o,d]of[...this.heads.entries()])if(d.status==="running"||d.status==="streaming")this.finalizeChatRun(o,{aborted:Boolean(e.aborted),hasError:Boolean(e.error)},n)}this.render(n)}onChatChanged(e){if(this.destroyed)return;let t=e!==void 0?e:this.safeGetActiveChatId();if(t){if(this.heads.get(t)?.status==="completed")this.heads.delete(t)}this.render(t)}onChatDeleted(e){if(this.destroyed||!e)return;if(this.heads.delete(e))this.render()}destroy(){if(this.destroyed)return;this.destroyed=!0,this.clearDragSession(),this.clearResizeListener(),this.clearSuppressClickTimer(),this.suppressNextClick=!1;for(let e of this.disposers)try{e()}catch{}if(this.disposers.length=0,this.heads.clear(),this.headItemRefs.clear(),this.characterCache.clear(),this.pendingCharacterFetches.clear(),this.rootEl)this.rootEl.remove(),this.rootEl=null}getCachedCharacter(e){let t=this.characterCache.get(e);if(t!==void 0)this.characterCache.delete(e),this.characterCache.set(e,t);return t}setCachedCharacter(e,t){if(this.characterCache.has(e))this.characterCache.delete(e);else if(this.characterCache.size>=200){let n=this.characterCache.keys().next().value;if(n!==void 0)this.characterCache.delete(n)}this.characterCache.set(e,t)}upsertFromActiveRun(e,t){let n=this.heads.get(e.chatId),i=t===e.chatId?this.safeGetActiveChat():null,r=(typeof e.characterId==="string"&&e.characterId.length>0?e.characterId:void 0)??n?.characterId??(typeof i?.characterId==="string"&&i.characterId.length>0?i.characterId:void 0),s=r?this.getCachedCharacter(r):void 0,o=(typeof e.characterName==="string"&&e.characterName.trim().length>0?e.characterName.trim():void 0)??n?.characterName??s?.name,d=Te(e.avatarUrl)??Te(n?.avatarUrl)??Te(s?.avatarUrl)??(r?$e(r):void 0),l=e.hasContentOutput?"streaming":"running",h={chatId:e.chatId,runId:e.runId,status:l,startedAt:e.startedAt,...r?{characterId:r}:{},...o?{characterName:o}:{},...d?{avatarUrl:d}:{},...n?.avatarFailed&&n.avatarUrl===d?{avatarFailed:!0}:{}};if(this.heads.set(e.chatId,h),r&&!o&&!this.characterCache.has(r))this.resolveCharacterMeta(e.chatId,r)}finalizeChatRun(e,t,n){let i=this.heads.get(e);if(t.aborted||t.hasError||n===e){this.heads.delete(e);return}if(i)this.heads.set(e,{...i,status:"completed"});else this.heads.set(e,{chatId:e,runId:`gg-completed-${e}`,status:"completed",startedAt:Date.now()})}async resolveCharacterMeta(e,t){if(this.destroyed||!t)return;if(this.pendingCharacterFetches.has(t)||this.characterCache.has(t))return;let n=this.ctx.characters;if(typeof n?.get!=="function")return;this.pendingCharacterFetches.add(t);try{let i=await Promise.resolve(n.get(t));if(this.destroyed)return;if(!Me(i)){this.setCachedCharacter(t,{});return}let r=typeof i.name==="string"&&i.name.trim().length>0?i.name.trim():void 0,s=$e(t),o=Te(i.avatarUrl)??Te(i.avatar_url),d=o??s;this.setCachedCharacter(t,{...r?{name:r}:{},avatarUrl:d});let l=this.heads.get(e);if(l&&l.characterId===t){let h=!1;if(r&&!l.characterName)l.characterName=r,h=!0;if(o&&(!l.avatarUrl||l.avatarUrl===s)){if(l.avatarUrl!==o)l.avatarUrl=o,delete l.avatarFailed,h=!0}else if(d&&!l.avatarUrl)l.avatarUrl=d,h=!0;if(h)this.render()}}catch{if(!this.destroyed)this.setCachedCharacter(t,{})}finally{this.pendingCharacterFetches.delete(t)}}render(e){if(this.destroyed)return;if(typeof document>"u"||!document.body)return;let t=e!==void 0?e:this.safeGetActiveChatId(),{nativeChatIds:n,nativeContainer:i}=this.heads.size>0?this.scanNativeChatHeads():{nativeChatIds:new Set,nativeContainer:null},r=[];for(let h of this.heads.values()){if(h.chatId===t)continue;if(n.has(h.chatId))continue;r.push(h)}if(r.length===0){if(this.clearDragSession(),this.clearResizeListener(),this.headItemRefs.clear(),this.rootEl)this.rootEl.remove(),this.rootEl=null;return}let s=!this.isDragging,o=this.getViewportSize(),d=s&&i?this.resolveNativeBounds(i,o.vw,o.vh):null;if(!this.rootEl)this.rootEl=document.createElement("div"),this.rootEl.className="gg-chat-heads-root",this.rootEl.setAttribute("data-gg-chat-heads-root","true"),this.attachDragHandlers(this.rootEl),this.ensureResizeListener();let l=new Set(r.map((h)=>h.chatId));for(let[h,a]of[...this.headItemRefs.entries()])if(!l.has(h))a.item.remove(),this.headItemRefs.delete(h);for(let h=0;h<r.length;h+=1){let a=r[h],u=this.headItemRefs.get(a.chatId);if(u)this.updateHeadItem(u,a);else u=this.buildHeadItem(a),this.headItemRefs.set(a.chatId,u);if(this.rootEl.children[h]!==u.item)this.rootEl.insertBefore(u.item,this.rootEl.children[h]??null)}if(this.applyRootPosition(this.rootEl,r.length,{avoidNative:s,nativeBox:d,viewport:o}),!this.rootEl.isConnected)document.body.append(this.rootEl)}buildHeadItem(e){let t=e.chatId,n=document.createElement("div");n.className="gg-chat-head-item";let i=document.createElement("button");i.type="button",i.className="gg-chat-head",i.setAttribute("data-gg-chat-head","true"),i.setAttribute("data-chat-id",t);let r=document.createElement("span");r.className="gg-chat-head-badge",r.setAttribute("aria-hidden","true"),i.append(r),i.addEventListener("contextmenu",(o)=>{if(o.preventDefault(),o.stopPropagation(),!this.isDragging&&this.heads.get(t)?.status==="completed")this.dismissCompletedHead(t)}),i.addEventListener("click",(o)=>{if(o.preventDefault(),o.stopPropagation(),this.suppressNextClick){this.suppressNextClick=!1,this.clearSuppressClickTimer();return}this.navigateToChat(t,()=>{if(this.destroyed)return;if(this.heads.get(t)?.status==="completed")this.heads.delete(t),this.render()})}),n.append(i);let s={item:n,btn:i,badge:r,img:null,initials:null,pip:null,dismissBtn:null};return this.updateHeadItem(s,e),s}updateHeadItem(e,t){let{item:n,btn:i,badge:r}=e;if(e.lastStatus!==t.status)i.classList.toggle("is-running",t.status==="running"||t.status==="streaming"),i.classList.toggle("is-streaming",t.status==="streaming"),i.classList.toggle("is-completed",t.status==="completed"),i.setAttribute("data-status",t.status);let s=t.characterName||t.chatId,o=t.status==="completed"?"Generation completed — click to open chat":t.status==="streaming"?"Streaming response in background — click to open chat":"Generating response in background — click to open chat",d=`${s}: ${o}`;if(e.lastLabel!==d)i.setAttribute("aria-label",d),i.title=d,e.lastLabel=d;let l=t.avatarUrl??(t.characterId?$e(t.characterId):void 0),h=Boolean(t.avatarFailed);if(e.lastAvatarUrl!==l||e.lastAvatarFailed!==h||e.lastDisplayName!==s||!e.img&&!e.initials){if(l&&!h){if(e.initials)e.initials.remove(),e.initials=null;if(e.img){if(e.img.getAttribute("src")!==l)e.img.src=l;e.img.alt=s}else{let a=document.createElement("img");a.className="gg-chat-head-avatar",a.src=l,a.alt=s,a.draggable=!1,a.addEventListener("error",()=>{if(this.destroyed)return;let u=this.heads.get(t.chatId);if(u)u.avatarFailed=!0;if(a.isConnected){let v=this.heads.get(t.chatId)?.characterName||t.chatId,c=document.createElement("span");c.className="gg-chat-head-initials",c.textContent=ht(v),a.replaceWith(c);let g=this.headItemRefs.get(t.chatId);if(g&&g.img===a)g.img=null,g.initials=c,g.lastAvatarFailed=!0}}),i.insertBefore(a,r),e.img=a}}else{if(e.img)e.img.remove(),e.img=null;let a=ht(s);if(e.initials)e.initials.textContent=a;else{let u=document.createElement("span");u.className="gg-chat-head-initials",u.textContent=a,i.insertBefore(u,r),e.initials=u}}e.lastAvatarUrl=l,e.lastAvatarFailed=h}if(t.status==="completed"){if(!e.pip){let a=document.createElement("span");a.className="gg-chat-head-pip",a.setAttribute("aria-hidden","true"),i.append(a),e.pip=a}}else if(e.pip)e.pip.remove(),e.pip=null;if(t.status==="completed")if(e.dismissBtn){if(e.lastDisplayName!==s)e.dismissBtn.setAttribute("aria-label",`Dismiss ${s}`)}else{let a=document.createElement("button");a.type="button",a.className="gg-chat-head-dismiss",a.setAttribute("data-gg-chat-head-dismiss","true"),a.setAttribute("aria-label",`Dismiss ${s}`),a.title="Dismiss",a.textContent="×",a.addEventListener("click",(u)=>{u.preventDefault(),u.stopPropagation(),this.dismissCompletedHead(t.chatId)}),n.append(a),e.dismissBtn=a}else if(e.dismissBtn)e.dismissBtn.remove(),e.dismissBtn=null;e.lastStatus=t.status,e.lastDisplayName=s}dismissCompletedHead(e){if(this.destroyed)return;if(this.heads.get(e)?.status==="completed")this.heads.delete(e),this.render()}scanNativeChatHeads(){let e=new Set,t=null;if(typeof document>"u"||!document.body)return{nativeChatIds:e,nativeContainer:t};let n=document.body.querySelectorAll("[data-head-idx][data-chat-id]:not([data-gg-chat-head]), [data-chat-head][data-chat-id]:not([data-gg-chat-head]), body > * > [data-chat-id]:not([data-gg-chat-head])"),i=new Map;for(let r of n){if(r.hasAttribute("data-gg-chat-head"))continue;if(this.rootEl?.contains(r)||r.closest("[data-gg-chat-heads-root]"))continue;let s=r.getAttribute("data-chat-id");if(!s)continue;if(r.hasAttribute("data-head-idx")||r.hasAttribute("data-chat-head")){if(e.add(s),!t){let l=r.parentElement;t=!l||l===document.body?r:l}continue}let d=r.parentElement;if(d&&d.parentElement===document.body){let l=i.get(d);if(l===void 0){let h=typeof d.className==="string"?d.className:"";l=/ChatHeads/i.test(h)||d.querySelector("[data-head-idx]")!==null,i.set(d,l)}if(l)e.add(s)}}return{nativeChatIds:e,nativeContainer:t}}findNativeChatHeadsContainer(){return this.scanNativeChatHeads().nativeContainer}getViewportSize(){let e=typeof window<"u"?window:typeof document<"u"?document.defaultView:null,t=e&&typeof e.innerWidth==="number"&&e.innerWidth>0?e.innerWidth:(typeof document<"u"?document.documentElement?.clientWidth:0)||1024,n=e&&typeof e.innerHeight==="number"&&e.innerHeight>0?e.innerHeight:(typeof document<"u"?document.documentElement?.clientHeight:0)||768;return{vw:t,vh:n}}getStackDimensions(e,t){let n=Math.max(1,e),i=60,r=n*48+Math.max(0,n-1)*10+12,s=Math.max(60,t-24);return{width:60,height:Math.min(r,s)}}clampCenterPos(e,t,n){let{vw:i,vh:r}=n??this.getViewportSize(),{width:s,height:o}=this.getStackDimensions(t,r),d=12+s/2,l=i-12-s/2,h=12+o/2,a=r-12-o/2,u=be(e.xPct/100*i,d,l),v=be(e.yPct/100*r,h,a);return{xPct:u/i*100,yPct:v/r*100}}resolveNativeBounds(e,t,n){try{let c=e.getBoundingClientRect?.();if(c&&c.width>0&&c.height>0)return{left:c.left,top:c.top,right:c.right,bottom:c.bottom}}catch{}let i=e.querySelectorAll("[data-head-idx], [data-chat-head]"),r=Math.max(1,i.length),s=e.style?.flexDirection==="row",o=s?r*48+Math.max(0,r-1)*8+12:60,d=s?60:r*48+Math.max(0,r-1)*8+12,l=parseFloat(e.style?.left??""),h=parseFloat(e.style?.top??"");if(Number.isFinite(l)&&Number.isFinite(h)&&l>=0&&h>=0)return{left:l,top:h,right:l+o,bottom:h+d};let a=this.readNativeStoredPosition();if(a){let c,g;if(a.xPct<0||a.yPct<0)c=t-o-12,g=Math.round((n-d)/2);else if(a.xPct<=1&&a.yPct<=1)c=be(a.xPct*t,12,t-o-12),g=be(a.yPct*n,12,n-d-12);else c=be(a.xPct/100*t,12,t-o-12),g=be(a.yPct/100*n,12,n-d-12);return{left:c,top:g,right:c+o,bottom:g+d}}let u=t-o-12,v=Math.round((n-d)/2);return{left:u,top:v,right:u+o,bottom:v+d}}readNativeStoredPosition(){try{let t=this.getStorage()?.getItem("lumiverse:chatHeadsPos");if(!t)return null;let n=JSON.parse(t);if(Me(n)&&typeof n.xPct==="number"&&Number.isFinite(n.xPct)&&typeof n.yPct==="number"&&Number.isFinite(n.yPct))return{xPct:n.xPct,yPct:n.yPct}}catch{}return null}attachDragHandlers(e){e.addEventListener("click",()=>{if(this.suppressNextClick)this.suppressNextClick=!1,this.clearSuppressClickTimer()}),e.addEventListener("pointerdown",(t)=>{if(this.destroyed)return;if(t.pointerType==="mouse"&&t.button!==0)return;if(typeof document>"u")return;let n=t.target;if(n?.closest?.("[data-gg-chat-head-dismiss]"))return;if(this.isDragging)return;this.clearSuppressClickTimer(),this.suppressNextClick=!1,this.clearDragSession();let{pointerId:i,clientX:r,clientY:s}=t,o=this.getViewportSize(),d=this.rootEl?.children.length||this.heads.size||1,l=parseFloat(e.style.left),h=parseFloat(e.style.top),a=Number.isFinite(l)&&Number.isFinite(h)?{xPct:l,yPct:h}:this.clampCenterPos(this.pos,d,o),u=!1,v=!1,c=null,g=null,b=0,I=0,S=!1,C=()=>{if(c!==null)clearTimeout(c),c=null},w=()=>{if(g!==null){if(typeof cancelAnimationFrame==="function")cancelAnimationFrame(g);g=null}},y=()=>{if(!S||this.destroyed)return;if(S=!1,this.pos=this.clampCenterPos({xPct:a.xPct+b/o.vw*100,yPct:a.yPct+I/o.vh*100},d,o),this.rootEl)this.applyRootPosition(this.rootEl,d,{avoidNative:!1,viewport:o})},x=(P)=>{if(P.pointerId!==i)return;let z=P.clientX-r,j=P.clientY-s;if(!u&&Math.hypot(z,j)>6){u=!0,C(),this.isDragging=!0,this.suppressNextClick=!0,e.classList.add("is-dragging");try{e.setPointerCapture?.(i)}catch{}}if(!u)return;if(b=z,I=j,S=!0,typeof requestAnimationFrame==="function"){if(g===null)g=requestAnimationFrame(()=>{if(g=null,v||this.destroyed)return;y()})}else y()},A=()=>{if(v)return;if(v=!0,C(),w(),u&&S)y();this.clearDragSession(),e.classList.remove("is-dragging");try{if(e.hasPointerCapture?.(i))e.releasePointerCapture?.(i)}catch{}if(u){if(this.savePosition(this.pos),this.rootEl){let P=this.rootEl.children.length||this.heads.size||1;this.applyRootPosition(this.rootEl,P)}this.clearSuppressClickTimer(),this.suppressClickTimer=setTimeout(()=>{this.suppressClickTimer=null,this.suppressNextClick=!1},350)}},N=n?.closest?.("[data-gg-chat-head]")?.getAttribute("data-chat-id")??null;if(t.pointerType==="touch"&&N&&this.heads.get(N)?.status==="completed")c=setTimeout(()=>{if(c=null,u||v||this.destroyed)return;if(this.heads.get(N)?.status!=="completed")return;this.suppressNextClick=!0,this.clearSuppressClickTimer(),this.suppressClickTimer=setTimeout(()=>{this.suppressClickTimer=null,this.suppressNextClick=!1},350),A(),this.dismissCompletedHead(N)},450);let H=(P)=>{if(P.pointerId!==i)return;A()},L=(P)=>{if(P.pointerId!==i)return;if(P.target!==e)return;A()},k=()=>{A()},X=(P)=>{if(u&&P.cancelable)P.preventDefault()},K=typeof window<"u"?window:document.defaultView;if(document.addEventListener("pointermove",x,!0),document.addEventListener("pointerup",H,!0),document.addEventListener("pointercancel",H,!0),t.pointerType==="touch")document.addEventListener("touchmove",X,{capture:!0,passive:!1});e.addEventListener("lostpointercapture",L),K?.addEventListener("blur",k),this.dragCleanup=()=>{if(C(),w(),document.removeEventListener("pointermove",x,!0),document.removeEventListener("pointerup",H,!0),document.removeEventListener("pointercancel",H,!0),t.pointerType==="touch")document.removeEventListener("touchmove",X,!0);e.removeEventListener("lostpointercapture",L),K?.removeEventListener("blur",k)}})}clearDragSession(){if(this.isDragging=!1,this.rootEl?.classList.remove("is-dragging"),this.dragCleanup){let e=this.dragCleanup;this.dragCleanup=null,e()}}clearSuppressClickTimer(){if(this.suppressClickTimer!==null)clearTimeout(this.suppressClickTimer),this.suppressClickTimer=null}ensureResizeListener(){if(this.resizeCleanup)return;let e=typeof window<"u"?window:typeof document<"u"?document.defaultView:null;if(!e)return;let t=null,n=()=>{if(this.destroyed||!this.rootEl)return;let r=this.rootEl.children.length||this.heads.size||1;this.applyRootPosition(this.rootEl,r,{avoidNative:!this.isDragging})},i=()=>{if(this.destroyed||!this.rootEl)return;if(typeof requestAnimationFrame==="function"){if(t!==null)return;t=requestAnimationFrame(()=>{t=null,n()})}else n()};e.addEventListener("resize",i),this.resizeCleanup=()=>{if(t!==null){if(typeof cancelAnimationFrame==="function")cancelAnimationFrame(t);t=null}e.removeEventListener("resize",i)}}clearResizeListener(){if(this.resizeCleanup){let e=this.resizeCleanup;this.resizeCleanup=null,e()}}applyRootPosition(e,t=this.heads.size||1,n={}){let i=n.viewport??this.getViewportSize(),{vw:r,vh:s}=i,{width:o,height:d}=this.getStackDimensions(t,s),l=this.clampCenterPos(this.pos,t,i),h=l.xPct/100*r,a=l.yPct/100*s;if(n.avoidNative!==!1){let c=n.nativeBox!==void 0?n.nativeBox:(()=>{let g=this.findNativeChatHeadsContainer();return g?this.resolveNativeBounds(g,r,s):null})();if(c){let g=12+o/2,b=r-12-o/2,I=12+d/2,S=s-12-d/2,C={left:h-o/2,top:a-d/2,right:h+o/2,bottom:a+d/2};if(Vt(C,c,8)){let w=c.bottom+8+d/2,y=c.top-8-d/2,x=c.left-8-o/2,A=c.right+8+o/2;if(w>=I&&w<=S)a=w;else if(y>=I&&y<=S)a=y;else if(x>=g&&x<=b)h=x;else if(A>=g&&A<=b)h=A}}}let u=Oe(h/r*100,0,100),v=Oe(a/s*100,0,100);e.style.left=`${u}%`,e.style.top=`${v}%`}getStorage(){try{return typeof localStorage<"u"?localStorage:typeof window<"u"?window.localStorage:null}catch{return null}}loadPosition(){try{let e=this.getStorage()?.getItem("gg:chatHeadsPos");if(!e)return{...ut};let t=JSON.parse(e);if(Me(t)&&typeof t.xPct==="number"&&Number.isFinite(t.xPct)&&typeof t.yPct==="number"&&Number.isFinite(t.yPct))return{xPct:Oe(t.xPct),yPct:Oe(t.yPct)}}catch{}return{...ut}}savePosition(e){try{this.getStorage()?.setItem("gg:chatHeadsPos",JSON.stringify(e))}catch{}}navigateToChat(e,t){try{let n=this.ctx.host?.surfaces;if(n&&typeof n.invoke==="function"){let i=n.invoke({kind:"route",id:"/chat/:chatId"},{chatId:e});if(Gt(i)){Promise.resolve(i).then(()=>{t?.()},()=>{if(this.fallbackHistoryNavigate(e))t?.()});return}t?.();return}}catch{}if(this.fallbackHistoryNavigate(e))t?.()}fallbackHistoryNavigate(e){try{let t=typeof window<"u"?window:typeof document<"u"?document.defaultView:null;if(t?.history&&typeof t.history.pushState==="function"){t.history.pushState(null,"",`/chat/${encodeURIComponent(e)}`);let n=t.PopStateEvent??(typeof PopStateEvent<"u"?PopStateEvent:Event);return t.dispatchEvent(new n("popstate")),!0}}catch{}return!1}safeGetActiveChat(){try{return this.ctx.getActiveChat?.()??null}catch{return null}}safeGetActiveChatId(){return this.safeGetActiveChat()?.chatId??null}}var Fe=["guided_response","guided_continue","guided_regenerate","guided_swipe","guided_impersonate"];var pt=0,gt=!0,ft=[{value:"before_post_history",label:"Before Post-History (after chat history)",shortLabel:"Before Post-History",sublabel:"Places guidance right after chat history and before post-history preset blocks."},{value:"in_history",label:"In History (at depth)",shortLabel:"In History",sublabel:"Splices guidance inside chat history N messages back from the end."},{value:"pre_history",label:"Pre-History (before chat history)",shortLabel:"Pre-History",sublabel:"Places guidance after pre-history system prompts and before the first chat turn."},{value:"post_history",label:"Post-History (end of prompt)",shortLabel:"Post-History",sublabel:"Appends guidance at the very end of the assembled prompt (before any trailing prefill)."}];function Xe(e,t="before_post_history"){if(e==="before_post_history"||e==="in_history"||e==="pre_history"||e==="post_history")return e;return t}function mt(e,t=0){if(typeof e==="number"&&Number.isFinite(e))return Math.max(0,Math.min(999,Math.floor(e)));return Math.max(0,Math.min(999,Math.floor(t)))}var qe=[...Fe,"input_recovery"],_e=[{value:"after_native",label:"Inline (after native buttons)",shortLabel:"Inline",sublabel:"Sits directly next to Home, Regenerate, Continue, etc."},{value:"before_native",label:"Left side (before native buttons)",shortLabel:"Left",sublabel:"Placed at the start of the composer top action bar"},{value:"right",label:"Right side (top bar)",shortLabel:"Right",sublabel:"Aligned to the right side of the composer top action bar"},{value:"below_bar",label:"Separate row (below native buttons)",shortLabel:"New row",sublabel:"Shown on the dedicated extension toolbar row underneath"}];function Kt(e){return typeof e==="string"&&Fe.includes(e)}function zt(e){return e==="input_recovery"||Kt(e)}function Pe(e){if(e==="after_native"||e==="before_native"||e==="right"||e==="below_bar")return e;return"after_native"}function Be(e){let t=[],n=new Set;if(Array.isArray(e))for(let i of e){if(!zt(i)||n.has(i))continue;n.add(i),t.push(i)}for(let i of qe)if(!n.has(i))n.add(i),t.push(i);return t}var ye={guided_response:{id:"guided_response",label:"Guided Response",shortLabel:"Response",description:"Steer the next AI reply using your composer text as temporary guidance without adding a user message.",tooltip:"Guided Response — steer next AI reply without sending a user message"},guided_continue:{id:"guided_continue",label:"Guided Continue",shortLabel:"Continue",description:"Continue the last AI message using optional guidance text and this option's profile & preset.",tooltip:"Guided Continue — continue last AI message (guided if input present)"},guided_regenerate:{id:"guided_regenerate",label:"Guided Regenerate",shortLabel:"Regenerate",description:"Replace the last AI message with a fresh regenerated reply using optional guidance text and this option's profile & preset.",tooltip:"Guided Regenerate — regenerate last AI reply (guided if input present)"},guided_swipe:{id:"guided_swipe",label:"Guided Swipe",shortLabel:"Swipe",description:"Generate a new swipe on the last AI message steered by your guidance text.",tooltip:"Guided Swipe — create a steered new swipe on the last AI message"},guided_impersonate:{id:"guided_impersonate",label:"Impersonation",shortLabel:"Impersonate",description:"Generate a user reply into the composer input box using your configured preset and optional outline.",tooltip:"Impersonate — draft user message into input box"}};function re(e,t="1.85"){return`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${t}" stroke-linecap="round" stroke-linejoin="round">${e}</svg>`}var vt=re('<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>'),bt=re('<circle cx="12" cy="12" r="9"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',"1.8"),yt='<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>',Le={guided_response:re('<path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4Z"/>'),guided_continue:re('<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>'),guided_regenerate:vt,guided_swipe:re('<path d="m9 18 6-6-6-6"/>'),guided_impersonate:re('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),input_recovery:re('<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>')},je={remove_last_continue:re('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/>'),regenerate_last_continue:vt},Ye={history:re('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>'),clear_history:re('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>')};function Se(e,t=68){let n=Number.isFinite(t)?Math.max(4,Math.floor(t)):60,i=e.replace(/\s+/g," ").trim();if(i.length<=n)return i;return`${i.slice(0,n-1)}…`}function Et(e,t){if(e.length===0)return null;if(t)return e.find((n)=>n.id===t)??e[0]??null;return e[0]??null}function wt(e){return e[0]?.text?` ("${e[0].text.replace(/\s+/g," ").trim().slice(0,48)}")`:""}function $t(e){let t=Pe(e.settings.toolbarPlacement),n=Be(e.settings.buttonOrder),i=0;if(e.settings.actions.guided_response?.enabled)i|=1;if(e.settings.actions.guided_continue?.enabled)i|=2;if(e.settings.actions.guided_regenerate?.enabled)i|=4;if(e.settings.actions.guided_swipe?.enabled)i|=8;if(e.settings.actions.guided_impersonate?.enabled)i|=16;if(e.settings.inputRecovery.enabled)i|=32;let s=Boolean(e.settings.inputRecovery.enabled)&&e.recovery.length>0;return{placement:t,order:n,enabledMask:i,hasActiveChat:Boolean(e.hasActiveChat),hasActiveRun:Boolean(e.activeRun),activeRunId:e.activeRun?.runId??null,activeRunActionId:e.activeRun?.actionId??null,hasRecovery:s,latestRecoveryPreview:s?wt(e.recovery):""}}function Wt(e,t){if(e.placement!==t.placement||e.enabledMask!==t.enabledMask||e.hasActiveChat!==t.hasActiveChat||e.hasActiveRun!==t.hasActiveRun||e.activeRunId!==t.activeRunId||e.activeRunActionId!==t.activeRunActionId||e.hasRecovery!==t.hasRecovery||e.latestRecoveryPreview!==t.latestRecoveryPreview||e.order.length!==t.order.length)return!1;for(let n=0;n<e.order.length;n+=1)if(e.order[n]!==t.order[n])return!1;return!0}var Ze=["gg-actions-host","gg-actions-host--row","is-before-native","is-right"],Xt=450,qt=10,It=150,Ct=3000,jt=0,Yt=250;class Je{ctx;handlers;actionsMountRoot;toolbarMountRoot=null;toolbarEl;buttons=[];buttonPool=new Map;latestState=null;activeActionId=null;activeHoldCancel=null;suppressNextHoldClick=!1;suppressHoldClickActionId=null;suppressHoldClickUntil=0;clearSuppressHoldClickTimer=null;holdReleaseCleanup=null;postHoldCleanup=null;continueMenu=null;latestRecovery=[];lastRenderSignature=null;lastChatId=void 0;destroyed=!1;onKeyDown;onFocusIn;constructor(e,t){this.ctx=e;this.handlers=t;this.actionsMountRoot=e.ui.mount("chat_actions"),this.actionsMountRoot.classList.add("gg-actions-host"),this.toolbarEl=document.createElement("div"),this.toolbarEl.className="gg-toolbar",this.toolbarEl.setAttribute("role","toolbar"),this.toolbarEl.setAttribute("aria-label","Guided Generations actions"),this.onKeyDown=(n)=>{this.handleToolbarKeyDown(n)},this.onFocusIn=(n)=>{let i=n.target;if(!i||i.tagName!=="BUTTON"||i.disabled)return;let r=i.getAttribute("data-gg-action");if(r)this.activeActionId=r,this.applyRovingTabIndex()},this.toolbarEl.addEventListener("keydown",this.onKeyDown),this.toolbarEl.addEventListener("focusin",this.onFocusIn),this.actionsMountRoot.replaceChildren(this.toolbarEl)}render(e){if(this.destroyed)return;this.latestState=e;let t=e.chatId!==void 0&&this.lastChatId!==void 0&&e.chatId!==this.lastChatId;if(e.chatId!==void 0)this.lastChatId=e.chatId;let n=$t(e),i=n.placement==="below_bar"?this.toolbarMountRoot:this.actionsMountRoot,r=i!==null&&this.toolbarEl.parentElement===i&&this.toolbarEl.childElementCount===this.buttons.length;if(this.lastRenderSignature!==null&&r&&Wt(this.lastRenderSignature,n)){if(this.latestRecovery=e.recovery,t)this.closeContinueMenu({restoreFocus:!1}),this.clearActiveHold();else if(this.continueMenu?.kind==="recovery")this.continueMenu.refreshRecovery?.();return}this.closeContinueMenu({restoreFocus:!1}),this.clearActiveHold(),this.latestRecovery=e.recovery;let s=[];for(let v of n.order)if(v==="input_recovery"?Boolean(e.settings.inputRecovery.enabled):Boolean(e.settings.actions[v]?.enabled))s.push(v);if(this.buttons.length===s.length&&this.toolbarEl.childElementCount===s.length&&this.buttons.every((v,c)=>v.getAttribute("data-gg-action")===s[c])){for(let v of s){let c=this.buttonPool.get(v);if(c)this.syncOptionButton(c,v,e)}this.applyRovingTabIndex(),this.applyPlacement(n.placement,s.length>0),this.lastRenderSignature=n;return}let d=typeof document<"u"?document.activeElement:null,l=d&&this.toolbarEl.contains(d)?d.getAttribute?.("data-gg-action"):null,h=[];for(let v of s){let c=this.getOrCreateOptionButton(v);this.syncOptionButton(c,v,e),h.push(c.btn)}this.buttons=h,this.toolbarEl.replaceChildren(...h);let a=l?this.buttons.find((v)=>!v.disabled&&v.getAttribute("data-gg-action")===l):void 0;if(a&&l)this.activeActionId=l;this.applyRovingTabIndex();let u=h.length>0;if(this.applyPlacement(n.placement,u),this.lastRenderSignature=n,a)a.focus()}applyRovingTabIndex(){let e=this.buttons.filter((n)=>!n.disabled);if(e.length===0){for(let n of this.buttons)n.tabIndex=-1;return}let t=(this.activeActionId?e.find((n)=>n.getAttribute("data-gg-action")===this.activeActionId):void 0)??e[0];this.activeActionId=t.getAttribute("data-gg-action")??null;for(let n of this.buttons)n.tabIndex=n===t?0:-1}handleToolbarKeyDown(e){if(e.altKey||e.ctrlKey||e.metaKey)return;let t=e.key;if(t!=="ArrowRight"&&t!=="ArrowLeft"&&t!=="ArrowDown"&&t!=="ArrowUp"&&t!=="Home"&&t!=="End")return;let n=this.buttons.filter((d)=>!d.disabled);if(n.length===0)return;let i=typeof document<"u"?document.activeElement:null,r=n.findIndex((d)=>d===i);if(r===-1)r=n.findIndex((d)=>d.tabIndex===0);if(r===-1)r=0;let s=r;if(t==="ArrowRight"||t==="ArrowDown")s=(r+1)%n.length;else if(t==="ArrowLeft"||t==="ArrowUp")s=(r-1+n.length)%n.length;else if(t==="Home")s=0;else if(t==="End")s=n.length-1;let o=n[s];e.preventDefault(),this.activeActionId=o.getAttribute("data-gg-action")??null,this.applyRovingTabIndex(),o.focus()}getOrCreateOptionButton(e){let t=this.buttonPool.get(e);if(t)return t;let n=document.createElement("button");n.type="button",n.className="gg-btn",n.setAttribute("data-gg-action",e);let i={btn:n,iconKey:""};if(e==="input_recovery")i.iconKey="input_recovery",n.innerHTML=Le.input_recovery,this.attachRecoveryHoldHandlers(n);else if(e==="guided_swipe")this.attachSwipeHoldHandlers(n);else if(e==="guided_continue")this.attachContinueHoldHandlers(n);else n.addEventListener("click",(r)=>{r.preventDefault(),r.stopPropagation();let s=this.latestState?.activeRun;if(s?.actionId===e)this.handlers.onAbortAction(s.runId);else this.handlers.onTriggerAction(e)});return this.buttonPool.set(e,i),i}syncOptionButton(e,t,n){if(t==="input_recovery"){this.syncRecoveryButton(e,n);return}this.syncActionButton(e,t,n)}syncActionButton(e,t,n){let{btn:i}=e,r=ye[t],s=n.activeRun?.actionId===t,o=Boolean(n.activeRun)&&!s,d=!n.hasActiveChat||o;if(i.classList.toggle("is-running",s),i.classList.toggle("is-dimmed",d),i.disabled=d,i.setAttribute("aria-label",s?`Stop ${r.label}`:r.label),t==="guided_swipe"&&!s)i.setAttribute("aria-keyshortcuts","Control+Enter Meta+Enter"),i.removeAttribute("aria-haspopup"),i.removeAttribute("aria-expanded"),i.title="Guided Swipe — click to swipe, hold (or Ctrl+Click) to swipe in background";else if(t==="guided_continue"&&!s)i.setAttribute("aria-haspopup","menu"),i.setAttribute("aria-expanded","false"),i.setAttribute("aria-keyshortcuts","Shift+F10 Alt+ArrowUp Control+Enter Meta+Enter"),i.title="Guided Continue — click to continue, hold for continue options";else i.removeAttribute("aria-keyshortcuts"),i.removeAttribute("aria-haspopup"),i.removeAttribute("aria-expanded"),i.title=s?`Stop ${r.label}`:r.tooltip;let l=s?"stop":t;if(e.iconKey!==l)e.iconKey=l,i.innerHTML=s?yt:Le[t]}clearActiveHold(){if(this.activeHoldCancel){let e=this.activeHoldCancel;this.activeHoldCancel=null,e()}}clearPostHoldClickSuppression(){if(this.suppressNextHoldClick=!1,this.suppressHoldClickActionId=null,this.suppressHoldClickUntil=0,this.clearSuppressHoldClickTimer!==null)clearTimeout(this.clearSuppressHoldClickTimer),this.clearSuppressHoldClickTimer=null;if(this.holdReleaseCleanup){let e=this.holdReleaseCleanup;this.holdReleaseCleanup=null,e()}if(this.postHoldCleanup){let e=this.postHoldCleanup;this.postHoldCleanup=null,e()}}isHoldClickSuppressed(e){if(!this.suppressNextHoldClick)return!1;if(this.suppressHoldClickUntil>0&&Date.now()>this.suppressHoldClickUntil)return this.clearPostHoldClickSuppression(),!1;if(e&&this.suppressHoldClickActionId!==null){if(e.getAttribute("data-gg-action")!==this.suppressHoldClickActionId)return!1}return!0}armPostHoldClickSuppression(e,t){if(this.clearPostHoldClickSuppression(),this.suppressNextHoldClick=!0,this.suppressHoldClickActionId=e.getAttribute("data-gg-action"),this.suppressHoldClickUntil=Date.now()+Ct,this.postHoldCleanup=t??null,typeof document>"u")return;let n=typeof window<"u"?window:document.defaultView,i=()=>{if(document.removeEventListener("pointerup",o,!0),document.removeEventListener("pointercancel",o,!0),document.removeEventListener("visibilitychange",s),n?.removeEventListener("blur",r),this.holdReleaseCleanup===i)this.holdReleaseCleanup=null},r=()=>{this.clearPostHoldClickSuppression()},s=()=>{if(document.visibilityState==="hidden")this.clearPostHoldClickSuppression()},o=(d)=>{if(i(),this.clearSuppressHoldClickTimer!==null)clearTimeout(this.clearSuppressHoldClickTimer);let l=d.type==="pointercancel"||d.pointerType==="mouse"?jt:Yt;this.suppressHoldClickUntil=Date.now()+l,this.clearSuppressHoldClickTimer=setTimeout(()=>{this.clearSuppressHoldClickTimer=null,this.clearPostHoldClickSuppression()},l)};this.holdReleaseCleanup=i,document.addEventListener("pointerup",o,!0),document.addEventListener("pointercancel",o,!0),document.addEventListener("visibilitychange",s),n?.addEventListener("blur",r),this.clearSuppressHoldClickTimer=setTimeout(()=>{this.clearSuppressHoldClickTimer=null,this.clearPostHoldClickSuppression()},Ct)}attachLongPressHandlers(e,t,n){let i={timer:void 0,x:0,y:0,fired:!1},r=typeof document<"u"?document:null,s=typeof window<"u"?window:r?.defaultView??null,o=!1,d=()=>{if(!o)return;o=!1,s?.removeEventListener("blur",h),r?.removeEventListener("visibilitychange",h)},l=()=>{if(o)return;o=!0,s?.addEventListener("blur",h),r?.addEventListener("visibilitychange",h)},h=()=>{if(d(),i.timer!==void 0)clearTimeout(i.timer),i.timer=void 0;if(e.classList.remove("is-holding"),this.activeHoldCancel===h)this.activeHoldCancel=null};e.addEventListener("pointerdown",(a)=>{if(e.disabled||this.latestState?.activeRun)return;if(!a.isPrimary)return;if(a.pointerType==="mouse"&&a.button!==0)return;this.clearActiveHold(),this.clearPostHoldClickSuppression(),h(),i.fired=!1,i.x=a.clientX,i.y=a.clientY,e.classList.add("is-holding"),this.activeHoldCancel=h,l(),i.timer=setTimeout(()=>{if(i.timer=void 0,d(),e.classList.remove("is-holding"),this.activeHoldCancel===h)this.activeHoldCancel=null;i.fired=!0,this.armPostHoldClickSuppression(e,()=>{i.fired=!1}),n.onHold()},Xt)}),e.addEventListener("pointermove",(a)=>{if(i.timer===void 0)return;let u=a.clientX-i.x,v=a.clientY-i.y;if(Math.hypot(u,v)>qt)h()}),e.addEventListener("pointerup",h),e.addEventListener("pointercancel",h),e.addEventListener("pointerleave",(a)=>{if(a.pointerType==="touch")return;h()}),e.addEventListener("contextmenu",(a)=>{if(i.timer!==void 0||i.fired||this.isHoldClickSuppressed(e))a.preventDefault(),a.stopPropagation()}),e.addEventListener("click",(a)=>{if(i.fired||this.isHoldClickSuppressed(e)){i.fired=!1,this.clearPostHoldClickSuppression(),a.preventDefault(),a.stopPropagation();return}a.preventDefault(),a.stopPropagation();let u=this.latestState?.activeRun;if(t!=="input_recovery"&&u?.actionId===t)this.handlers.onAbortAction(u.runId);else n.onClick(a)}),e.addEventListener("keydown",(a)=>{if(e.disabled||this.latestState?.activeRun)return;if(n.onShortcutKeyDown(a))a.preventDefault(),a.stopPropagation()})}attachSwipeHoldHandlers(e){this.attachLongPressHandlers(e,"guided_swipe",{onClick:(t)=>{this.handlers.onTriggerAction("guided_swipe",{backgroundSwipe:Boolean(t.ctrlKey||t.metaKey)})},onHold:()=>{this.handlers.onTriggerAction("guided_swipe",{backgroundSwipe:!0})},onShortcutKeyDown:(t)=>{if((t.ctrlKey||t.metaKey)&&(t.key==="Enter"||t.key===" "))return this.handlers.onTriggerAction("guided_swipe",{backgroundSwipe:!0}),!0;return!1}})}attachContinueHoldHandlers(e){this.attachLongPressHandlers(e,"guided_continue",{onClick:(t)=>{if(this.continueMenu!==null&&this.continueMenu.anchorBtn===e){this.closeContinueMenu({restoreFocus:!0});return}if(this.closeContinueMenu({restoreFocus:!1}),t.ctrlKey||t.metaKey){this.openContinueMenu(e);return}this.handlers.onTriggerAction("guided_continue")},onHold:()=>{this.openContinueMenu(e)},onShortcutKeyDown:(t)=>{if(t.shiftKey&&t.key==="F10"||t.altKey&&t.key==="ArrowUp"||(t.ctrlKey||t.metaKey)&&t.key==="Enter")return this.openContinueMenu(e),!0;return!1}})}openContinueMenu(e){if(this.destroyed||typeof document>"u"||!document.body)return;this.closeContinueMenu({restoreFocus:!1});let t=document.createElement("div");t.className="gg-dropup-menu",t.setAttribute("role","menu"),t.setAttribute("aria-label","Guided Continue options");let n=[{id:"remove_last_continue",label:"Remove the last continue",icon:je.remove_last_continue,onSelect:()=>this.handlers.onRemoveLastContinue()},{id:"regenerate_last_continue",label:"Regenerate last continue",icon:je.regenerate_last_continue,onSelect:()=>this.handlers.onRegenerateLastContinue()}],i=[];for(let s of n){let o=document.createElement("button");o.type="button",o.className="gg-dropup-item",o.setAttribute("role","menuitem"),o.setAttribute("data-gg-menu-action",s.id),o.tabIndex=-1,o.innerHTML=`${s.icon}<span>${s.label}</span>`,o.addEventListener("click",(d)=>{d.preventDefault(),d.stopPropagation(),this.closeContinueMenu({restoreFocus:!1}),s.onSelect()}),i.push(o),t.append(o)}document.body.append(t),e.setAttribute("aria-expanded","true"),this.positionContinueMenu(t,e);let r=this.attachDropupMenuLifecycle({menuEl:t,anchorBtn:e,items:i});this.continueMenu={kind:"continue",menuEl:t,anchorBtn:e,items:i,cleanup:r},i[0]?.focus()}attachDropupMenuLifecycle(e){let{menuEl:t,anchorBtn:n,items:i,onBackKey:r}=e,s=Date.now(),o=(y)=>{let x=i.filter((M)=>!M.disabled),A=x.indexOf(document.activeElement);if(y.key==="ArrowDown"){if(y.preventDefault(),y.stopPropagation(),x.length===0)return;let M=A===-1?0:(A+1)%x.length;x[M]?.focus()}else if(y.key==="ArrowUp"){if(y.preventDefault(),y.stopPropagation(),x.length===0)return;let M=A<=0?x.length-1:A-1;x[M]?.focus()}else if(y.key==="Home")y.preventDefault(),y.stopPropagation(),x[0]?.focus();else if(y.key==="End")y.preventDefault(),y.stopPropagation(),x[x.length-1]?.focus();else if(r&&(y.key==="ArrowLeft"||y.key==="Backspace")&&r())y.preventDefault(),y.stopPropagation();else if(y.key==="Escape"||y.key==="Tab")y.preventDefault(),y.stopPropagation(),this.closeContinueMenu({restoreFocus:!0})},d=(y)=>{if(y.key==="Escape")y.preventDefault(),y.stopPropagation(),this.closeContinueMenu({restoreFocus:!0})},l=(y)=>{if(Date.now()-s<It)return;let x=y.target;if(x&&(t.contains(x)||x===n||n.contains(x)))return;this.closeContinueMenu({restoreFocus:!1})},h=(y)=>{if(this.isHoldClickSuppressed(n))return;if(Date.now()-s<It)return;let x=y.target;if(x&&(t.contains(x)||x===n||n.contains(x)))return;this.closeContinueMenu({restoreFocus:!1})},a=typeof window<"u"?window:document.defaultView,u=a?.visualViewport??null,v=a?.innerWidth,c=a?.innerHeight,g=null,b=()=>{if(typeof requestAnimationFrame==="function"){if(g!==null)return;g=requestAnimationFrame(()=>{if(g=null,this.destroyed||!n.isConnected||n.disabled||!t.isConnected)return;this.positionContinueMenu(t,n)})}else this.positionContinueMenu(t,n)},I=(y)=>{if(!n.isConnected||n.disabled||!t.isConnected){this.closeContinueMenu({restoreFocus:!1});return}let x=a?.innerWidth,A=a?.innerHeight,M=x!==v||A!==c;if(v=x,c=A,!y&&!u&&!M){this.closeContinueMenu({restoreFocus:!1});return}b()},S=()=>{I(!1)},C=()=>{I(!0)},w=(y)=>{let x=y.target;if(x&&t.contains(x))return;this.closeContinueMenu({restoreFocus:!1})};return t.addEventListener("keydown",o),document.addEventListener("keydown",d,!0),document.addEventListener("pointerdown",l,!0),document.addEventListener("click",h,!0),document.addEventListener("scroll",w,{capture:!0,passive:!0}),a?.addEventListener("resize",S),u?.addEventListener("resize",C),()=>{if(g!==null){if(typeof cancelAnimationFrame==="function")cancelAnimationFrame(g);g=null}t.removeEventListener("keydown",o),document.removeEventListener("keydown",d,!0),document.removeEventListener("pointerdown",l,!0),document.removeEventListener("click",h,!0),document.removeEventListener("scroll",w,{capture:!0}),a?.removeEventListener("resize",S),u?.removeEventListener("resize",C),t.remove()}}positionContinueMenu(e,t){let n=e.querySelector(".gg-dropup-history-list"),i=n?e.querySelector(".gg-dropup-header"):null;if(e.style.maxHeight)e.style.maxHeight="";if(e.style.overflowY)e.style.overflowY="";if(n&&n.style.maxHeight)n.style.maxHeight="";let r=t.getBoundingClientRect(),s=typeof window<"u"?window:document.defaultView,o=typeof getComputedStyle==="function"?getComputedStyle:s?.getComputedStyle?.bind(s),d=o&&document.body?o(document.body):null,l=d?parseFloat(d.zoom):NaN,h=d&&typeof d.getPropertyValue==="function"?parseFloat(d.getPropertyValue("scale")):NaN,a=d&&typeof d.getPropertyValue==="function"?parseFloat(d.getPropertyValue("--lumiverse-ui-scale")):NaN,u=Number.isFinite(l)&&l>0&&l!==1?l:Number.isFinite(h)&&h>0&&h!==1?h:Number.isFinite(a)&&a>0&&a!==1?a:1,v=s&&typeof s.innerWidth==="number"?s.innerWidth:document.documentElement?.clientWidth||1024,c=s&&typeof s.innerHeight==="number"?s.innerHeight:document.documentElement?.clientHeight||768,g=s?.visualViewport,b=g&&typeof g.width==="number"&&Number.isFinite(g.width)&&g.width>0&&g.width<v?g.width:v,I=g&&typeof g.height==="number"&&Number.isFinite(g.height)&&g.height>0&&g.height<c?g.height:c,{offsetWidth:S,offsetHeight:C}=e,w=n?n.offsetHeight:0,y=i?i.offsetHeight:0,x=S*u,A=C*u,M=6,N=8,H=Math.max(N,b-x-N),L=Math.max(N,Math.min(r.left,H)),k=r.top,X=I-r.bottom,K=A+M*u+N,P=k<K&&X>k,z="",j="",te;if(P){let G=Math.max(N/u,r.bottom/u+M);z=`${G}px`,te=Math.max(0,I-G*u-N)}else j=`${(I-r.top)/u+M}px`,te=Math.max(0,k-M*u-N);let de=Math.max(0,Math.floor(te/u)),q=null;if(n){let G=w>0&&C>=w?C-w:(y||32)+12;q=Math.min(220,Math.max(0,de-G))}if(e.style.left=`${L/u}px`,e.style.top=z,e.style.bottom=j,e.style.maxHeight=`${de}px`,e.style.overflowY="auto",n&&q!==null)n.style.maxHeight=`${q}px`}closeContinueMenu(e){let t=this.continueMenu;if(!t)return;if(this.continueMenu=null,t.anchorBtn.setAttribute("aria-expanded","false"),t.cleanup(),e.restoreFocus&&t.anchorBtn.isConnected&&!t.anchorBtn.disabled)t.anchorBtn.focus()}syncRecoveryButton(e,t){let{btn:n}=e,i=t.recovery.length>0,r=Boolean(t.activeRun),s=wt(t.recovery);if(n.classList.toggle("is-dimmed",r),n.disabled=r,n.setAttribute("aria-label",i?"Restore last input":"Clear current input"),!r)n.setAttribute("aria-haspopup","menu"),n.setAttribute("aria-expanded","false"),n.setAttribute("aria-keyshortcuts","Shift+F10 Alt+ArrowUp Control+Enter Meta+Enter");else n.removeAttribute("aria-haspopup"),n.removeAttribute("aria-expanded"),n.removeAttribute("aria-keyshortcuts");n.title=i?`Restore last cleared input${s}`:"Input Recovery — clear current input"}attachRecoveryHoldHandlers(e){this.attachLongPressHandlers(e,"input_recovery",{onClick:(t)=>{if(this.continueMenu!==null&&this.continueMenu.anchorBtn===e){this.closeContinueMenu({restoreFocus:!0});return}if(this.closeContinueMenu({restoreFocus:!1}),t.ctrlKey||t.metaKey){this.openRecoveryMenu(e);return}this.handlers.onRestoreLatest()},onHold:()=>{this.openRecoveryMenu(e)},onShortcutKeyDown:(t)=>{if(t.shiftKey&&t.key==="F10"||t.altKey&&t.key==="ArrowUp"||(t.ctrlKey||t.metaKey)&&t.key==="Enter")return this.openRecoveryMenu(e),!0;return!1}})}openRecoveryMenu(e){if(this.destroyed||typeof document>"u"||!document.body)return;this.closeContinueMenu({restoreFocus:!1});let t=document.createElement("div");t.className="gg-dropup-menu",t.setAttribute("role","menu"),t.setAttribute("aria-label","Input Recovery options");let n=[],i=!1,r=()=>this.latestRecovery.map((u)=>({id:u.id,text:u.text,actionId:u.actionId})),s=r(),o=()=>{if(s.length!==this.latestRecovery.length)return!0;for(let u=0;u<s.length;u+=1){let v=s[u],c=this.latestRecovery[u];if(v.id!==c.id||v.text!==c.text||v.actionId!==c.actionId)return!0}return!1},d=(u=!0)=>{i=!1,s=r(),n.length=0,t.replaceChildren(),t.setAttribute("aria-label","Input Recovery options");let v=this.latestRecovery.length===0,c=[{id:"history",label:"History",icon:Ye.history,disabled:!1,onSelect:()=>{l()}},{id:"clear_history",label:"Clear History",icon:Ye.clear_history,disabled:v,onSelect:()=>{if(this.latestRecovery.length===0)return;this.closeContinueMenu({restoreFocus:!1}),this.handlers.onClearRecovery?.()}}];for(let g of c){let b=document.createElement("button");if(b.type="button",b.className="gg-dropup-item",b.setAttribute("role","menuitem"),b.setAttribute("data-gg-menu-action",g.id),b.tabIndex=-1,g.disabled)b.disabled=!0,b.setAttribute("aria-disabled","true"),b.style.opacity="0.45",b.style.cursor="not-allowed";b.innerHTML=`${g.icon}<span>${g.label}</span>`,b.addEventListener("click",(I)=>{if(I.preventDefault(),I.stopPropagation(),g.disabled)return;g.onSelect()}),n.push(b),t.append(b)}if(t.isConnected){if(this.positionContinueMenu(t,e),u)n[0]?.focus()}},l=(u=!0)=>{i=!0,s=r(),n.length=0,t.replaceChildren(),t.setAttribute("aria-label","Input Recovery History");let v=document.createElement("div");v.className="gg-dropup-header",v.style.flexShrink="0";let c=document.createElement("button");c.type="button",c.className="gg-dropup-back",c.setAttribute("data-gg-menu-action","back"),c.setAttribute("aria-label","Back to Input Recovery options"),c.setAttribute("aria-keyshortcuts","ArrowLeft Backspace"),c.tabIndex=-1,c.textContent="← Back",c.addEventListener("click",(I)=>{I.preventDefault(),I.stopPropagation(),d()});let g=document.createElement("span");g.className="gg-dropup-title",g.textContent=`History (${this.latestRecovery.length})`,v.append(c,g),t.append(v),n.push(c);let b=document.createElement("div");if(b.className="gg-dropup-history-list",b.style.minHeight="0",this.latestRecovery.length===0){let I=document.createElement("div");I.className="gg-dropup-empty",I.setAttribute("role","status"),I.textContent="No saved inputs yet.",b.append(I),t.append(b)}else{for(let I of this.latestRecovery){let S=ye[I.actionId]?.label??I.actionId,C=Se(I.text,56),w=document.createElement("button");w.type="button",w.className="gg-dropup-item gg-dropup-history-item",w.setAttribute("role","menuitem"),w.setAttribute("data-gg-menu-action","restore_recovery_entry"),w.setAttribute("data-gg-recovery-id",I.id),w.setAttribute("aria-label",`Restore ${S} draft: ${Se(I.text,40)}`),w.title=I.text,w.tabIndex=-1;let y=document.createElement("span");y.className="gg-dropup-history-tag",y.textContent=S;let x=document.createElement("span");x.className="gg-dropup-history-snippet",x.textContent=C,w.append(y,x),w.addEventListener("click",(A)=>{if(A.preventDefault(),A.stopPropagation(),this.closeContinueMenu({restoreFocus:!1}),this.handlers.onRestoreEntry)this.handlers.onRestoreEntry(I);else this.handlers.onRestoreLatest()}),n.push(w),b.append(w)}t.append(b)}if(t.isConnected){if(this.positionContinueMenu(t,e),u)(this.latestRecovery.length>0?n[1]??n[0]:n[0])?.focus()}},h=()=>{if(!o())return;let u=typeof document<"u"?document.activeElement:null,v=Boolean(u&&t.contains(u)),c=v?u.getAttribute?.("data-gg-recovery-id"):null,g=v?u.getAttribute?.("data-gg-menu-action"):null;if(i)l(!1);else d(!1);if(v)((c?n.find((I)=>!I.disabled&&I.getAttribute("data-gg-recovery-id")===c):void 0)??(g?n.find((I)=>!I.disabled&&I.getAttribute("data-gg-menu-action")===g):void 0)??n.find((I)=>!I.disabled))?.focus()};d(),document.body.append(t),e.setAttribute("aria-expanded","true"),this.positionContinueMenu(t,e);let a=this.attachDropupMenuLifecycle({menuEl:t,anchorBtn:e,items:n,onBackKey:()=>{if(!i)return!1;return d(),!0}});this.continueMenu={kind:"recovery",menuEl:t,anchorBtn:e,items:n,cleanup:a,refreshRecovery:h},n[0]?.focus()}applyPlacement(e,t){if(this.toolbarEl.style.display=t?"inline-flex":"none",e==="below_bar"){if(!this.toolbarMountRoot)this.toolbarMountRoot=this.ctx.ui.mount("chat_toolbar");if(this.resetHostElement(this.actionsMountRoot,!0),this.toolbarMountRoot.classList.remove(...Ze),this.toolbarMountRoot.classList.add("gg-actions-host--row"),this.toolbarMountRoot.style.display=t?"flex":"none",this.toolbarEl.parentElement!==this.toolbarMountRoot)this.toolbarMountRoot.replaceChildren(this.toolbarEl);return}if(this.toolbarMountRoot)this.resetHostElement(this.toolbarMountRoot,!0);if(this.actionsMountRoot.classList.remove(...Ze),this.actionsMountRoot.classList.add("gg-actions-host"),e==="before_native")this.actionsMountRoot.classList.add("is-before-native");else if(e==="right")this.actionsMountRoot.classList.add("is-right");if(this.actionsMountRoot.style.display=t?"inline-flex":"none",this.toolbarEl.parentElement!==this.actionsMountRoot)this.actionsMountRoot.replaceChildren(this.toolbarEl)}resetHostElement(e,t){if(e.classList.remove(...Ze),e.style.display="none",t)e.replaceChildren()}destroy(){if(this.destroyed)return;if(this.destroyed=!0,this.closeContinueMenu({restoreFocus:!1}),this.clearActiveHold(),this.clearPostHoldClickSuppression(),this.toolbarEl.removeEventListener("keydown",this.onKeyDown),this.toolbarEl.removeEventListener("focusin",this.onFocusIn),this.buttons=[],this.buttonPool.clear(),this.latestState=null,this.activeActionId=null,this.lastRenderSignature=null,this.lastChatId=void 0,this.toolbarEl.replaceChildren(),this.resetHostElement(this.actionsMountRoot,!0),this.toolbarMountRoot)this.resetHostElement(this.toolbarMountRoot,!0)}}var xt=[0,50,150];function Z(e){return Boolean(e)&&typeof e==="object"&&!Array.isArray(e)}function Zt(e){if(!Z(e)||typeof e.id!=="string")return null;let t={id:e.id};if(typeof e.chat_id==="string")t.chat_id=e.chat_id;if(typeof e.swipe_id==="number")t.swipe_id=e.swipe_id;if(Z(e.extra))t.extra=e.extra;return t}function Jt(e,t,n){return Boolean(e&&e.id===n&&(typeof e.chat_id!=="string"||e.chat_id===t)&&typeof e.swipe_id==="number"&&Z(e.extra)&&Object.keys(e.extra).length>0)}function St(e){let t=Array.isArray(e)?e:Z(e)&&Array.isArray(e.data)?e.data:Z(e)&&Array.isArray(e.items)?e.items:[],n=[];for(let i of t)if(Z(i)&&typeof i.id==="string")n.push(i);return n}function At(e,t,n){if(t>=n)return!0;if(Z(e)&&typeof e.total==="number"&&e.total>t)return!0;return!1}function Qt(e){let n=(e instanceof Error?e.message:typeof e==="string"?e:"").toUpperCase();return n.includes("PERMISSION_DENIED")||n.includes("SPINDLE_FRONTEND_INACTIVE")||n.includes("STALE_GENERATION")||n.includes("NOT FOUND")||n.includes("404")||n.includes("403")||n.includes("401")}class Qe{ctx;pending=new Map;scheduledKeys=new Set;inFlightByMessage=new Map;inFlightTailReads=new Map;retryTimers=new Map;nextRevision=0;destroyed=!1;constructor(e){this.ctx=e}makeKey(e,t,n){return`${e}:${t}:${n}`}setPendingEntry(e,t){if(this.pending.has(e))this.pending.delete(e);else if(this.pending.size>=100){let n=this.pending.keys().next().value;if(n!==void 0)this.pending.delete(n),this.scheduledKeys.delete(n),this.clearRetryTimer(n)}this.pending.set(e,t)}handleMetricsEvent(e){if(this.destroyed)return;if(typeof e.chatId!=="string"||!e.chatId||typeof e.messageId!=="string"||!e.messageId||typeof e.swipeId!=="number"||!Number.isInteger(e.swipeId)||e.swipeId<0)return;if(e.tokenCount===void 0&&e.generationMetrics===void 0)return;let t=this.makeKey(e.chatId,e.messageId,e.swipeId),n=this.pending.get(t),i={key:t,chatId:e.chatId,messageId:e.messageId,swipeId:e.swipeId,tokenCount:e.tokenCount!==void 0?e.tokenCount:n?.tokenCount,generationMetrics:e.generationMetrics!==void 0?e.generationMetrics:n?.generationMetrics,lastKnownSwipeId:n?.lastKnownSwipeId,pendingFallback:n?.pendingFallback??null,revision:++this.nextRevision,attempts:0};this.setPendingEntry(t,i),this.clearRetryTimer(t),this.enqueueFlush(t)}onMessageEvent(e){if(this.destroyed||this.pending.size===0)return;let t=Z(e)?e:null,n=t&&Z(t.message)?t.message:null,i=typeof n?.id==="string"?n.id:typeof t?.messageId==="string"?t.messageId:null;if(!i)return;let r=typeof t?.chatId==="string"?t.chatId:typeof n?.chat_id==="string"?n.chat_id:null,s=typeof t?.action==="string"?t.action:null,o=s==="deleted"&&typeof t?.swipeId==="number"?t.swipeId:null,d=typeof n?.swipe_id==="number"?n.swipe_id:s!=="deleted"&&typeof t?.swipeId==="number"?t.swipeId:void 0,l=Zt(n);if(o!==null){let h=[];for(let[a,u]of[...this.pending.entries()]){if(u.messageId!==i)continue;if(r&&u.chatId!==r)continue;if(u.swipeId===o)this.pending.delete(a),this.scheduledKeys.delete(a),this.clearRetryTimer(a);else if(u.swipeId>o){this.pending.delete(a),this.scheduledKeys.delete(a),this.clearRetryTimer(a);let v=u.swipeId-1;h.push({...u,swipeId:v,lastKnownSwipeId:void 0,pendingFallback:null,key:this.makeKey(u.chatId,u.messageId,v),revision:++this.nextRevision})}}for(let a of h){let u=this.pending.get(a.key);if(!u||a.revision>u.revision)this.scheduledKeys.delete(a.key),this.clearRetryTimer(a.key),this.setPendingEntry(a.key,a)}}for(let[h,a]of[...this.pending.entries()]){if(a.messageId!==i)continue;if(r&&a.chatId!==r)continue;if(d!==void 0&&d!==a.swipeId){a.lastKnownSwipeId=d,a.pendingFallback=null;continue}if(d===a.swipeId)a.lastKnownSwipeId=d;a.attempts=0,this.enqueueFlush(h,l)}}onChatChanged(e){if(this.destroyed||this.pending.size===0)return;let t=typeof e==="string"&&e.length>0?e:this.safeGetActiveChatId();if(!t)return;for(let[n,i]of[...this.pending.entries()]){if(i.chatId!==t)continue;if(i.lastKnownSwipeId!==void 0&&i.lastKnownSwipeId!==i.swipeId)continue;i.attempts=0,this.enqueueFlush(n)}}onChatDeleted(e){if(this.destroyed||!e||this.pending.size===0)return;for(let[t,n]of[...this.pending.entries()]){if(n.chatId!==e)continue;this.pending.delete(t),this.scheduledKeys.delete(t),this.clearRetryTimer(t)}}onMessageDeleted(e){if(this.destroyed||this.pending.size===0)return;let t=Z(e)?e:null,n=t&&Z(t.message)?t.message:null,i=typeof n?.id==="string"?n.id:typeof t?.messageId==="string"?t.messageId:typeof t?.id==="string"?t.id:null;if(!i)return;let r=typeof t?.chatId==="string"?t.chatId:typeof t?.chat_id==="string"?t.chat_id:typeof n?.chat_id==="string"?n.chat_id:null;for(let[s,o]of[...this.pending.entries()]){if(o.messageId!==i)continue;if(r&&o.chatId!==r)continue;this.pending.delete(s),this.scheduledKeys.delete(s),this.clearRetryTimer(s)}}destroy(){if(this.destroyed)return;this.destroyed=!0,this.pending.clear(),this.scheduledKeys.clear(),this.inFlightByMessage.clear(),this.inFlightTailReads.clear();for(let e of this.retryTimers.values())clearTimeout(e);this.retryTimers.clear()}enqueueFlush(e,t=null){if(this.destroyed)return;let n=this.pending.get(e);if(!n)return;if(t!==null)n.pendingFallback=t;if(this.scheduledKeys.has(e))return;this.scheduledKeys.add(e);let i=`${n.chatId}:${n.messageId}`,s=(this.inFlightByMessage.get(i)??Promise.resolve()).catch(()=>{return}).then(async()=>{if(this.scheduledKeys.delete(e),this.destroyed)return;await this.flushKey(e,t)}).catch(()=>{return}).finally(()=>{if(this.inFlightByMessage.get(i)===s)this.inFlightByMessage.delete(i)});this.inFlightByMessage.set(i,s)}fetchTailPage(e,t,n){let i=`${t}:${n}`,r=this.inFlightTailReads.get(i);if(r)return r;let s;try{s=Promise.resolve(e(t,{limit:n,tail:!0}))}catch(d){return Promise.reject(d)}let o=s.finally(()=>{if(this.inFlightTailReads.get(i)===o)this.inFlightTailReads.delete(i)});return this.inFlightTailReads.set(i,o),o}async flushKey(e,t){if(this.destroyed)return;let n=this.pending.get(e);if(!n)return;let i=n.pendingFallback??t;n.pendingFallback=null;let r={...n},s=this.resolveUpdateMessage();if(!s){this.deleteIfSameRevision(e,r.revision);return}let o=null;if(Jt(i,r.chatId,r.messageId))o=i;let d=o?null:this.resolveGetSingleMessage(),l=o?null:this.resolveGetMessages();if(!o&&d)try{let u=await d(r.messageId);if(this.destroyed)return;if(Z(u)&&typeof u.id==="string"&&u.id===r.messageId&&(typeof u.chat_id!=="string"||u.chat_id===r.chatId))o=u}catch(u){if(this.destroyed)return;if(!l){this.handleFlushFailure(e,r,u);return}}if(!o&&l){let u;try{u=await this.fetchTailPage(l,r.chatId,50)}catch(c){if(this.destroyed)return;this.handleFlushFailure(e,r,c);return}if(this.destroyed)return;let v=St(u);if(o=v.find((c)=>c.id===r.messageId)??null,!o){if(!At(u,v.length,50)){this.deleteIfSameRevision(e,r.revision);return}try{let g=await this.fetchTailPage(l,r.chatId,200);if(this.destroyed)return;let b=St(g);if(o=b.find((I)=>I.id===r.messageId)??null,!o&&!At(g,b.length,200)){this.deleteIfSameRevision(e,r.revision);return}}catch(g){if(this.destroyed)return;this.handleFlushFailure(e,r,g);return}if(!o)return}}else if(!o&&i&&i.id===r.messageId&&(typeof i.chat_id!=="string"||i.chat_id===r.chatId))o=i;if(!o)return;let h=this.pending.get(e);if(!h||h.revision!==r.revision)return;if(typeof o.swipe_id!=="number")return;if(o.swipe_id!==r.swipeId){h.lastKnownSwipeId=o.swipe_id;return}let a={...Z(o.extra)?o.extra:{}};if(r.tokenCount!==void 0)a.tokenCount=r.tokenCount;if(r.generationMetrics!==void 0)a.generationMetrics=r.generationMetrics;try{await s(r.chatId,r.messageId,{extra:a})}catch(u){if(this.destroyed)return;this.handleFlushFailure(e,r,u);return}if(this.destroyed)return;this.deleteIfSameRevision(e,r.revision)}handleFlushFailure(e,t,n){let i=this.pending.get(e);if(!i||i.revision!==t.revision)return;if(Qt(n)||t.attempts>=xt.length){this.pending.delete(e);return}let r=xt[t.attempts]??150;i.attempts=t.attempts+1,this.scheduleRetry(e,r)}deleteIfSameRevision(e,t){let n=this.pending.get(e);if(n&&n.revision===t)this.pending.delete(e)}scheduleRetry(e,t){if(this.destroyed||this.retryTimers.has(e))return;let n=setTimeout(()=>{if(this.retryTimers.delete(e),this.destroyed)return;this.enqueueFlush(e)},t);this.retryTimers.set(e,n)}clearRetryTimer(e){let t=this.retryTimers.get(e);if(t!==void 0)clearTimeout(t),this.retryTimers.delete(e)}resolveGetMessages(){try{let e=this.ctx.domain?.chats;if(typeof e?.getMessages==="function")return e.getMessages.bind(e);let t=this.ctx.chats;if(typeof t?.getMessages==="function")return t.getMessages.bind(t)}catch{}return null}resolveGetSingleMessage(){try{let e=this.ctx.messages;if(typeof e?.get==="function")return e.get.bind(e)}catch{}return null}resolveUpdateMessage(){try{let e=this.ctx.chats;if(typeof e?.updateMessage==="function")return e.updateMessage.bind(e)}catch{}return null}safeGetActiveChatId(){try{return this.ctx.getActiveChat?.().chatId??null}catch{return null}}}var en=[{value:"system",label:"System"},{value:"user",label:"User"},{value:"assistant",label:"Assistant"}],tn=_e.map((e)=>({value:e.value,label:e.label,sublabel:e.sublabel})),nn=ft.map((e)=>({value:e.value,label:e.label,sublabel:e.sublabel}));class nt{ctx;handlers;tab;handles=[];currentSettings=null;expandedSections=new Set;debounceTimers=new Map;orderStateTags=new Map;rootEl=null;headerEl=null;noticeEl=null;recoveryUi=null;pendingView=null;pendingFocusRestore=null;pendingGeneralFocusRestore=null;pointerActiveInDrawer=!1;pointerReleaseCleanup=null;pointerFallbackTimer=null;pendingViewFlushTimer=null;tabConnectionCleanups=new Set;noticeText="";noticeKind="info";recoveryBusy=!1;destroyed=!1;onFocusOut;onPointerDownInDrawer;constructor(e,t){this.ctx=e;this.handlers=t;this.tab=e.ui.registerDrawerTab({id:"guided-generations-settings",title:"Guided Generations",shortName:"Guided",description:"Configure input-bar guided action buttons and per-option API connection profiles & presets.",keywords:["guided","continue","regenerate","swipe","impersonate","recovery","preset","profile"],iconSvg:bt});let n=()=>{if(this.pointerFallbackTimer!==null)clearTimeout(this.pointerFallbackTimer),this.pointerFallbackTimer=null;if(this.pointerReleaseCleanup){let i=this.pointerReleaseCleanup;this.pointerReleaseCleanup=null,i()}};this.onPointerDownInDrawer=()=>{if(this.destroyed||this.pointerActiveInDrawer)return;if(this.pointerActiveInDrawer=!0,n(),typeof document>"u"){this.pointerActiveInDrawer=!1;return}let i=typeof window<"u"?window:document.defaultView,r=()=>{if(n(),this.pendingViewFlushTimer!==null)clearTimeout(this.pendingViewFlushTimer);this.pendingViewFlushTimer=setTimeout(()=>{this.pendingViewFlushTimer=null,this.pointerActiveInDrawer=!1,this.flushPendingViewIfIdle()},0)},s=()=>{n(),this.pointerActiveInDrawer=!1,this.flushPendingViewIfIdle()};document.addEventListener("pointerup",r,!0),document.addEventListener("pointercancel",r,!0),document.addEventListener("mouseup",r,!0),i?.addEventListener("blur",s),this.pointerReleaseCleanup=()=>{document.removeEventListener("pointerup",r,!0),document.removeEventListener("pointercancel",r,!0),document.removeEventListener("mouseup",r,!0),i?.removeEventListener("blur",s)},this.pointerFallbackTimer=setTimeout(()=>{n(),this.pointerActiveInDrawer=!1,this.flushPendingViewIfIdle()},3000)},this.onFocusOut=(i)=>{if(this.destroyed)return;let r=i.relatedTarget;if(this.debounceTimers.size>0&&r!==i.target)this.flushPendingSaves();if(!(Ge(r)&&this.tab.root.contains(r)&&Rt(r))&&this.pendingView)if(this.pointerActiveInDrawer||rn(this.tab.root,r)){if(!this.pointerActiveInDrawer)this.scheduleDeferredPendingViewFlush()}else queueMicrotask(()=>{this.flushPendingViewIfIdle()})},this.tab.root.addEventListener("pointerdown",this.onPointerDownInDrawer),this.tab.root.addEventListener("mousedown",this.onPointerDownInDrawer),this.tab.root.addEventListener("focusout",this.onFocusOut)}scheduleDeferredPendingViewFlush(){if(this.destroyed||this.pendingViewFlushTimer!==null)return;this.pendingViewFlushTimer=setTimeout(()=>{this.pendingViewFlushTimer=null,this.flushPendingViewIfIdle()},0)}flushPendingViewIfIdle(){if(this.destroyed||this.pointerActiveInDrawer)return;if(this.pendingView&&!this.isEditingDrawerInput()){let e=this.currentSettings?{...this.pendingView,settings:this.currentSettings}:this.pendingView;this.pendingView=null,this.render(e,{force:!0})}}onActivate(e){return this.tab.onActivate(e)}isTabConnected(){if(this.destroyed)return!1;if(this.tab.root?.isConnected)return!0;try{let e=this.ctx.ui?.getTabLocation?.(this.tab.tabId);if(e&&e.kind!=="main-drawer")return!0}catch{}try{let e=this.ctx.ui?.events?.getDrawerState?.();if(e?.open&&e.tabId===this.tab.tabId)return!0}catch{}return!1}observeTabConnection(e){if(this.destroyed||typeof IntersectionObserver!=="function")return()=>{};let t=!0,n=()=>{if(!t)return;t=!1,this.tabConnectionCleanups.delete(n),i.disconnect()},i=new IntersectionObserver((r)=>{if(!t||this.destroyed){n();return}if(r.some((s)=>s.isIntersecting)||this.isTabConnected())n(),e()},{threshold:0});return this.tabConnectionCleanups.add(n),i.observe(this.tab.root),n}setNotice(e,t="info"){this.noticeText=e,this.noticeKind=t,this.syncNoticeElement()}syncNoticeElement(){if(this.destroyed||!this.rootEl||!this.headerEl)return;if(!this.noticeText){this.noticeEl?.remove(),this.noticeEl=null;return}if(!this.noticeEl)this.noticeEl=document.createElement("div"),this.headerEl.after(this.noticeEl);if(this.noticeEl.className=`gg-notice${this.noticeKind==="error"?" is-error":this.noticeKind==="warn"?" is-warn":""}`,this.noticeKind==="error"||this.noticeKind==="warn")this.noticeEl.setAttribute("role","alert"),this.noticeEl.setAttribute("aria-live","assertive");else this.noticeEl.setAttribute("role","status"),this.noticeEl.setAttribute("aria-live","polite");this.noticeEl.textContent=this.noticeText}setRecoveryBusy(e){if(this.destroyed)return;if(this.recoveryBusy=e,!this.recoveryUi)return;if(this.recoveryUi.clearBtn.disabled=e||this.recoveryUi.recoveryCount===0,this.recoveryUi.listEl)for(let t of this.recoveryUi.listEl.querySelectorAll("button"))t.disabled=e}updateRecovery(e,t){if(this.destroyed)return;if(this.pendingView)this.pendingView={...this.pendingView,recovery:[...e]};if(!this.recoveryUi)return;let n=t?.inputRecovery.maxEntries??this.currentSettings?.inputRecovery.maxEntries??10;this.recoveryUi.maxEntries=n,this.recoveryUi.recoveryCount=e.length,this.recoveryUi.setBadge(e.length>0?String(e.length):"",e.length===0),this.recoveryUi.countLabel.textContent=e.length>0?`Saved inputs (${e.length}/${n}):`:"No saved inputs yet.",this.recoveryUi.clearBtn.disabled=this.recoveryBusy||e.length===0,this.syncRecoveryList(e)}isEditingDrawerInput(){if(this.debounceTimers.size>0)return!0;let e=typeof document<"u"?document.activeElement:null;return Boolean(Ge(e)&&this.tab.root.contains(e)&&Rt(e))}captureOrderButtonFocus(){let e=typeof document<"u"?document.activeElement:null;if(!Ge(e)||!this.tab.root.contains(e))return;if(!this.pendingFocusRestore&&e.tagName==="BUTTON"){let t=e,n=t.dataset.ggMove;if(n==="up"||n==="down"){let r=t.closest("[data-gg-order-id]")?.getAttribute("data-gg-order-id");if(r){this.pendingFocusRestore={optionId:r,button:n};return}}}if(!this.pendingFocusRestore&&!this.pendingGeneralFocusRestore){let t=e.getAttribute("data-gg-focus-key")??void 0,n=e.getAttribute("aria-label")??void 0;if(t||n)this.pendingGeneralFocusRestore={focusKey:t,tagName:e.tagName,ariaLabel:n}}}render(e,t){if(this.destroyed)return;if(!t?.force&&this.rootEl!==null&&this.currentSettings!==null&&this.isEditingDrawerInput()){if(e)this.pendingView=e,this.updateRecovery(e.recovery,e.settings);return}if(this.pendingView=null,this.pendingViewFlushTimer!==null)clearTimeout(this.pendingViewFlushTimer),this.pendingViewFlushTimer=null;this.captureOrderButtonFocus();let n=e;if(t?.force&&this.debounceTimers.size>0){if(this.flushPendingSaves(),n&&this.currentSettings)n={...n,settings:this.currentSettings}}else this.cancelPendingSaves();this.clearComponentHandles(),this.orderStateTags.clear(),this.recoveryUi=null,this.noticeEl=null,this.currentSettings=n?.settings??null;let i=document.createElement("div");i.className="gg-drawer",this.rootEl=i,this.tab.root.replaceChildren(i);let r=document.createElement("header");r.className="gg-header",this.headerEl=r;let s=document.createElement("div"),o=document.createElement("h2");o.textContent="Guided Generations";let d=document.createElement("p");d.className="gg-muted",d.textContent="Enabled options appear on the composer's top action bar alongside native buttons. Each option uses its own connection profile, model, and preset without modifying your active chat.",s.append(o,d);let l=document.createElement("button");if(l.type="button",l.className="gg-btn-sm",l.dataset.ggFocusKey="refresh",l.textContent="Refresh",l.addEventListener("click",()=>{this.flushPendingSaves(),this.handlers.onRefresh()}),r.append(s,l),i.append(r),this.syncNoticeElement(),!n){let g=document.createElement("p");g.className="gg-muted",g.textContent="Loading Guided Generations settings…",i.append(g),this.restoreCapturedFocus(i);return}let h=[];if(!n.permissions.generation)h.push("generation");if(!n.permissions.chats)h.push("chats");if(!n.permissions.chat_mutation)h.push("chat_mutation");if(!n.permissions.presets)h.push("presets");if(h.length>0){let g=document.createElement("div");g.className="gg-notice is-warn",g.setAttribute("role","alert"),g.setAttribute("aria-live","assertive"),g.textContent=`Missing extension permissions (${h.join(", ")}). Grant all permissions in Extension Manager so actions and dropdowns work properly.`,i.append(g)}let a=[],u=[];if(n.permissions.interceptor===!1)a.push("interceptor"),u.push("preset-aware guidance placement (pre-history, in-history, before/after post-history) and swipe turn matching fall back to basic heuristic placement");if(n.permissions.regex_scripts===!1)a.push("regex_scripts"),u.push("Lumiverse regex scripts are skipped on guidance prompts and generated/impersonated outputs");if(a.length>0){let g=document.createElement("div");g.className="gg-notice is-warn",g.setAttribute("role","alert"),g.setAttribute("aria-live","assertive"),g.textContent=`Optional permissions not granted (${a.join(", ")}): ${u.join("; ")}. Grant them in Extension Manager for full functionality.`,i.append(g)}if(n.catalogWarnings&&n.catalogWarnings.length>0){let g=document.createElement("div");g.className="gg-notice is-warn",g.setAttribute("role","alert"),g.setAttribute("aria-live","assertive"),g.textContent=n.catalogWarnings.join(" "),i.append(g)}let v=ln(n.connections),c=dn(n.presets);this.renderToolbarLayoutSection(i,n.settings);for(let g of Fe)this.renderActionSection(i,n.settings,g,n.connections,v,c,en);this.renderRecoverySection(i,n.settings,n.recovery),this.restoreCapturedFocus(i)}restoreCapturedFocus(e){if(this.pendingFocusRestore){let t=this.pendingFocusRestore;this.pendingFocusRestore=null,this.pendingGeneralFocusRestore=null;let n=e.querySelector(`[data-gg-order-id="${t.optionId}"]`),i=n?.querySelector(`button[data-gg-move="${t.button}"]`),r=n?.querySelector(`button[data-gg-move="${t.button==="up"?"down":"up"}"]`);(i&&!i.disabled?i:r&&!r.disabled?r:null)?.focus();return}if(this.pendingGeneralFocusRestore){let t=this.pendingGeneralFocusRestore;this.pendingGeneralFocusRestore=null;let n=null;if(t.focusKey)n=Tt(e,"data-gg-focus-key",t.focusKey);if(!n&&t.ariaLabel)n=Tt(e,"aria-label",t.ariaLabel,t.tagName);if(n&&!n.disabled)n.focus()}}createCollapsibleCard(e,t,n,i,r=!1,s){let o=document.createElement("section");if(o.className="gg-card",this.expandedSections.has(t))o.classList.add("is-expanded");let d=document.createElement("button");d.type="button",d.className="gg-card-header",d.dataset.ggFocusKey=`card-header:${t}`,d.setAttribute("aria-expanded",String(this.expandedSections.has(t)));let l=document.createElement("span");l.className="gg-card-header-left";let h=document.createElement("span");h.className="gg-card-chevron",h.setAttribute("aria-hidden","true"),h.textContent="▸";let a=document.createElement("span");a.textContent=n,l.append(h,a);let u=document.createElement("span");if(u.className=`gg-card-badge${r?" is-muted":""}`,i!==void 0)u.textContent=i;else u.style.display="none";d.append(l,u);let v=document.createElement("div");v.className="gg-card-body-wrap";let c=`gg-card-body-${t}`;v.id=c,d.setAttribute("aria-controls",c);let g=document.createElement("div");return g.className="gg-section-body",v.append(g),d.addEventListener("click",()=>{let b=!o.classList.contains("is-expanded");if(o.classList.toggle("is-expanded",b),d.setAttribute("aria-expanded",String(b)),b)this.expandedSections.add(t);else this.expandedSections.delete(t);s?.(b)}),o.append(d,v),e.append(o),{body:g,setBadge(b,I=!1){u.textContent=b,u.className=`gg-card-badge${I?" is-muted":""}`,u.style.display=b?"":"none"}}}renderToolbarLayoutSection(e,t){let n=Pe(t.toolbarPlacement),i=_e.find((b)=>b.value===n)??_e[0],r=this.createCollapsibleCard(e,"toolbar_layout","Toolbar Position & Order",i.shortLabel,!1),s=r.body,o=document.createElement("p");o.className="gg-muted",o.textContent="Choose where the Guided Generations buttons appear on the composer bar and customize their left-to-right order.",s.append(o);let d=(b,I)=>{let C={...this.currentSettings??t,...b};if(this.currentSettings=C,b.toolbarPlacement!==void 0){let w=_e.find((y)=>y.value===b.toolbarPlacement);if(w)r.setBadge(w.shortLabel,!1)}this.handlers.onSaveSettings(C,I)},l=se("Bar Placement");s.append(l.wrap),this.handles.push(this.ctx.components.mountSelect(l.slot,{options:tn,value:n,ariaLabel:"Toolbar Bar Placement",onChange:(b)=>{d({toolbarPlacement:Pe(b)},{rebuildDrawer:!1})}}));let h=se("Button Order (left to right)"),a=document.createElement("div");a.className="gg-order-list";let u=Be(t.buttonOrder);u.forEach((b,I)=>{let S=document.createElement("div");S.className="gg-order-item",S.setAttribute("data-gg-order-id",b);let C=document.createElement("div");C.className="gg-order-item-left";let w=document.createElement("span");w.className="gg-order-item-icon",w.setAttribute("aria-hidden","true"),w.innerHTML=Le[b];let y=b==="input_recovery"?"Input Recovery":ye[b].label,x=b==="input_recovery"?t.inputRecovery.enabled:Boolean(t.actions[b]?.enabled),A=document.createElement("span");A.className="gg-order-item-label",A.textContent=y;let M=document.createElement("span");M.className="gg-order-item-state",M.textContent=x?"Visible":"Hidden",this.orderStateTags.set(b,M),C.append(w,A,M);let N=document.createElement("div");N.className="gg-order-item-controls";let H=(X)=>{let K=I+X;if(K<0||K>=u.length)return;this.flushPendingSaves();let P=[...u],[z]=P.splice(I,1);if(!z)return;P.splice(K,0,z);let j=X===-1?K===0?"down":"up":K===P.length-1?"up":"down";this.pendingFocusRestore={optionId:z,button:j},d({buttonOrder:P},{rebuildDrawer:!0})},L=document.createElement("button");L.type="button",L.className="gg-icon-btn-sm",L.dataset.ggMove="up",L.textContent="↑",L.title=`Move ${y} left / up`,L.setAttribute("aria-label",`Move ${y} up`),L.disabled=I===0,L.addEventListener("click",()=>H(-1));let k=document.createElement("button");k.type="button",k.className="gg-icon-btn-sm",k.dataset.ggMove="down",k.textContent="↓",k.title=`Move ${y} right / down`,k.setAttribute("aria-label",`Move ${y} down`),k.disabled=I===u.length-1,k.addEventListener("click",()=>H(1)),N.append(L,k),S.append(C,N),a.append(S)});let v=document.createElement("div");v.className="gg-row";let c=document.createElement("span");c.className="gg-muted",c.textContent="Restore default button order & alignment";let g=document.createElement("button");g.type="button",g.className="gg-btn-sm",g.dataset.ggFocusKey="reset-layout",g.textContent="Reset layout",g.addEventListener("click",()=>{this.flushPendingSaves(),d({toolbarPlacement:"after_native",buttonOrder:[...qe]},{rebuildDrawer:!0})}),v.append(c,g),h.slot.append(a),s.append(h.wrap,v)}renderActionSection(e,t,n,i,r,s,o){let d=ye[n],l=t.actions[n],h=l.connectionId,a=this.expandedSections.has(n),u=null,v=this.createCollapsibleCard(e,n,d.label,l.enabled?"Visible":"Hidden",!l.enabled,(R)=>{if(R&&!a)a=!0,u?.update({connection:et(h)})}),c=v.body,g=document.createElement("p");g.className="gg-muted",g.textContent=d.description,c.append(g);let b=(R,V={rebuildDrawer:!1})=>{let J=this.currentSettings??t,ke={...J,actions:{...J.actions,[n]:{...J.actions[n],...R}}};if(this.currentSettings=ke,R.enabled!==void 0)v.setBadge(R.enabled?"Visible":"Hidden",!R.enabled),this.updateOrderStateTag(n,R.enabled);this.handlers.onSaveSettings(ke,V)},I=document.createElement("div");I.className="gg-row";let S=document.createElement("span");S.className="gg-field-label",S.textContent="Show button on input bar";let C=document.createElement("div");I.append(S,C),c.append(I),this.handles.push(this.ctx.components.mountSwitch(C,{checked:l.enabled,size:"sm",ariaLabel:`Show ${d.label} button on input bar`,onChange:(R)=>b({enabled:R},{rebuildDrawer:!1})}));let w=document.createElement("div");w.className="gg-row";let y=document.createElement("span");y.className="gg-field-label",y.textContent="Clear input bar when triggered";let x=document.createElement("div");w.append(y,x),c.append(w),this.handles.push(this.ctx.components.mountSwitch(x,{checked:l.clearInputOnRun,size:"sm",ariaLabel:`Clear input bar when running ${d.label}`,onChange:(R)=>b({clearInputOnRun:R})}));let A=document.createElement("div");A.className="gg-row";let M=document.createElement("span");M.className="gg-field-label",M.textContent="Apply Lumiverse regex scripts";let N=document.createElement("div");A.append(M,N),c.append(A),this.handles.push(this.ctx.components.mountSwitch(N,{checked:l.applyRegex??gt,size:"sm",ariaLabel:`Apply Lumiverse regex scripts for ${d.label}`,onChange:(R)=>b({applyRegex:R})}));let H=on(this.ctx),L=se("API Connection Profile");c.append(L.wrap),this.handles.push(this.ctx.components.mountSelect(L.slot,{options:r,value:l.connectionId??"",ariaLabel:`${d.label} API Connection Profile`,onChange:(R)=>{let V=R||null;h=V,b({connectionId:V}),u?.update(a?{connection:et(V),placeholder:tt(V,i,H)}:{placeholder:tt(V,i,H)})}}));let k=`gg-${n}-model`,X=se("Model (blank = connection profile model)",k);if(c.append(X.wrap),typeof this.ctx.components.mountModelCombobox==="function")u=this.ctx.components.mountModelCombobox(X.slot,{value:l.model??"",connection:a?et(h):void 0,appearance:"standard",autoRefreshOnFocus:!0,placeholder:tt(h,i,H),onChange:(R)=>{this.scheduleDebouncedSave(`${n}:model`,()=>{b({model:R.trim()||null})})}}),this.attachSlotInputAttributes(X.slot,k,`${d.label} Model`),this.handles.push(u);let K=se("Preset");c.append(K.wrap),this.handles.push(this.ctx.components.mountSelect(K.slot,{options:s,value:l.presetId??"",ariaLabel:`${d.label} Preset`,onChange:(R)=>b({presetId:R||null})}));let P=se("Guidance Injection Role");c.append(P.wrap),this.handles.push(this.ctx.components.mountSelect(P.slot,{options:o,value:l.injectionRole,ariaLabel:`${d.label} Guidance Injection Role`,onChange:(R)=>b({injectionRole:R})}));let z=Xe(l.guidancePosition),j=mt(l.guidanceDepth),te=null,de=`gg-${n}-guidance-depth`,q=se("In-History Depth (0–999)",de),G=(R)=>{let V=R==="in_history";q.wrap.style.display=V?"":"none",te?.setDisabled(!V)},ne=se("Guidance Position");c.append(ne.wrap,q.wrap),this.handles.push(this.ctx.components.mountSelect(ne.slot,{options:nn,value:z,ariaLabel:`${d.label} Guidance Position`,onChange:(R)=>{let V=Xe(R);b({guidancePosition:V}),G(V)}})),te=this.mountBoundedIntegerField({slot:q.slot,fieldId:de,ariaLabel:`${d.label} In-history depth`,debounceKey:`${n}:depth`,min:0,max:999,defaultValue:pt,placeholder:"0",initialValue:j,disabled:z!=="in_history",onCommit:(R)=>{b({guidanceDepth:R})}}),G(z);let oe=se("Guidance Template (supports {{input}} and Lumiverse macros like {{char}}, {{user}}; leave blank for raw input)");c.append(oe.wrap),this.handles.push(this.ctx.components.mountTextArea(oe.slot,{value:l.instructionTemplate,rows:2,placeholder:"{{input}}",ariaLabel:`${d.label} Guidance Template`,onChange:(R)=>{this.scheduleDebouncedSave(`${n}:template`,()=>{b({instructionTemplate:R})})}}))}mountBoundedIntegerField(e){let t=(l)=>{if(typeof l==="number"&&Number.isFinite(l))return Math.max(e.min,Math.min(e.max,Math.floor(l)));return Math.max(e.min,Math.min(e.max,Math.floor(e.defaultValue)))},n=t(e.initialValue),i=!1,r=!1,s=null,o=null,d=(l)=>{if(r)return;if(l===null){i=!0,this.cancelPendingSaveKey(e.debounceKey);return}i=!1;let h=t(l);n=h,this.scheduleDebouncedSave(e.debounceKey,()=>{e.onCommit(h)})};if(typeof this.ctx.components.mountNumericInput==="function")s=this.ctx.components.mountNumericInput(e.slot,{value:n,min:e.min,max:e.max,step:1,integer:!0,allowEmpty:!0,placeholder:e.placeholder,disabled:Boolean(e.disabled),ariaLabel:e.ariaLabel,onChange:d}),this.attachSlotInputAttributes(e.slot,e.fieldId,e.ariaLabel),e.slot.addEventListener("focusout",(l)=>{let h=l.relatedTarget;if(h&&e.slot.contains(h))return;if(i||s?.getValue()===null){i=!1;let a=t(e.defaultValue);if(a!==n)n=a,e.onCommit(a)}else this.flushPendingSaveKey(e.debounceKey);if(s&&s.getValue()!==n){r=!0;try{s.update({value:n})}finally{r=!1}}}),this.handles.push(s);else{let l=document.createElement("input");l.type="number",l.id=e.fieldId,l.className="gg-input-sm",l.min=String(e.min),l.max=String(e.max),l.step="1",l.placeholder=e.placeholder,l.value=String(n),l.disabled=Boolean(e.disabled),l.setAttribute("aria-label",e.ariaLabel),l.addEventListener("input",()=>{let h=l.value.trim(),a=h===""?null:Number(h);d(a!==null&&Number.isFinite(a)?a:null)}),l.addEventListener("blur",()=>{if(i||l.value.trim()===""){i=!1;let h=t(e.defaultValue);if(h!==n)n=h,e.onCommit(h)}else this.flushPendingSaveKey(e.debounceKey);l.value=String(n)}),o=l,e.slot.append(l)}return{setDisabled:(l)=>{if(s){r=!0;try{s.update({disabled:l})}finally{r=!1}}if(o)o.disabled=l}}}updateOrderStateTag(e,t){let n=this.orderStateTags.get(e);if(n)n.textContent=t?"Visible":"Hidden"}renderRecoverySection(e,t,n){let i=this.createCollapsibleCard(e,"input_recovery","Input Recovery",n.length>0?String(n.length):void 0,n.length===0),r=i.body,s=document.createElement("p");s.className="gg-muted",s.textContent="Automatically saves composer input cleared or replaced by guided actions so you can restore it in one click. When no saved inputs exist, clicking Input Recovery clears the current input.",r.append(s);let o=document.createElement("div");o.className="gg-row";let d=document.createElement("span");d.className="gg-field-label",d.textContent="Enable Input Recovery & toolbar button";let l=document.createElement("div");o.append(d,l),r.append(o),this.handles.push(this.ctx.components.mountSwitch(l,{checked:t.inputRecovery.enabled,size:"sm",ariaLabel:"Show Input Recovery button on input bar",onChange:(g)=>{let b=this.currentSettings??t,I={...b,inputRecovery:{...b.inputRecovery,enabled:g}};this.currentSettings=I,this.updateOrderStateTag("input_recovery",g),this.handlers.onSaveSettings(I,{rebuildDrawer:!1})}}));let h="gg-recovery-max-entries",a=se("Max saved drafts (1–50)",h);r.append(a.wrap),this.mountBoundedIntegerField({slot:a.slot,fieldId:h,ariaLabel:"Max saved drafts",debounceKey:"recovery:maxEntries",min:1,max:50,defaultValue:10,placeholder:"10",initialValue:t.inputRecovery.maxEntries,onCommit:(g)=>{let b=this.currentSettings??t,I={...b,inputRecovery:{...b.inputRecovery,maxEntries:g}};if(this.currentSettings=I,this.recoveryUi)this.recoveryUi.maxEntries=g,this.recoveryUi.countLabel.textContent=this.recoveryUi.recoveryCount>0?`Saved inputs (${this.recoveryUi.recoveryCount}/${g}):`:"No saved inputs yet.";this.handlers.onSaveSettings(I,{rebuildDrawer:!1})}});let u=document.createElement("div");u.className="gg-row";let v=document.createElement("span");v.className="gg-muted",v.textContent=n.length>0?`Saved inputs (${n.length}/${t.inputRecovery.maxEntries}):`:"No saved inputs yet.";let c=document.createElement("button");c.type="button",c.className="gg-btn-sm",c.dataset.ggFocusKey="clear-recovery",c.textContent="Clear History",c.disabled=this.recoveryBusy||n.length===0,c.addEventListener("click",()=>{this.handlers.onClearRecovery()}),u.append(v,c),r.append(u),this.recoveryUi={setBadge:i.setBadge,countLabel:v,clearBtn:c,body:r,listEl:null,entries:[],maxEntries:t.inputRecovery.maxEntries,recoveryCount:n.length},this.syncRecoveryList(n)}syncRecoveryList(e){let t=this.recoveryUi;if(!t)return;if(e.length===0){if(t.entries=[],t.listEl)t.listEl.remove(),t.listEl=null;return}if(t.listEl&&t.entries.length===e.length&&t.entries.every((r,s)=>{let o=e[s];return r.id===o.id&&r.text===o.text&&r.actionId===o.actionId}))return;t.entries=[...e];let n=t.listEl;if(!n)n=document.createElement("div"),n.className="gg-recovery-list",n.addEventListener("click",(r)=>{let o=r.target?.closest("button[data-gg-recovery-index]");if(!o||o.disabled)return;let d=Number(o.dataset.ggRecoveryIndex),l=Number.isInteger(d)?this.recoveryUi?.entries[d]:void 0;if(l)this.handlers.onRestoreEntry(l)}),t.listEl=n,t.body.append(n);let i=document.createDocumentFragment();e.forEach((r,s)=>{let o=document.createElement("div");o.className="gg-recovery-item";let d=document.createElement("div");d.className="gg-recovery-meta";let l=ye[r.actionId]?.label??r.actionId,h=document.createElement("span");h.className="gg-recovery-tag",h.textContent=l;let a=document.createElement("span");a.className="gg-recovery-snippet",a.textContent=Se(r.text),a.title=r.text,d.append(h,a);let u=document.createElement("button");u.type="button",u.className="gg-btn-sm",u.dataset.ggRecoveryIndex=String(s),u.textContent="Restore",u.disabled=this.recoveryBusy,u.setAttribute("aria-label",`Restore ${l} draft: ${Se(r.text,40)}`),o.append(d,u),i.append(o)}),n.replaceChildren(i)}attachSlotInputAttributes(e,t,n){let i=()=>{let s=e.querySelector("input");if(!s)return!1;if(!s.id)s.id=t;if(!s.getAttribute("aria-label"))s.setAttribute("aria-label",n);return!0};if(i()||typeof MutationObserver!=="function")return;let r=new MutationObserver(()=>{if(i())r.disconnect()});r.observe(e,{childList:!0,subtree:!0}),this.handles.push({destroy:()=>r.disconnect()})}scheduleDebouncedSave(e,t,n=250){let i=this.debounceTimers.get(e);if(i)clearTimeout(i.timer);let r=()=>{if(this.destroyed)return;t()},s=setTimeout(()=>{this.debounceTimers.delete(e),r(),this.flushPendingViewIfIdle()},n);this.debounceTimers.set(e,{timer:s,flush:r})}flushPendingSaves(){if(this.destroyed||this.debounceTimers.size===0)return;let e=Array.from(this.debounceTimers.entries());this.debounceTimers.clear();for(let[,t]of e)clearTimeout(t.timer),t.flush()}flushPendingSaveKey(e){if(this.destroyed)return;let t=this.debounceTimers.get(e);if(!t)return;this.debounceTimers.delete(e),clearTimeout(t.timer),t.flush()}cancelPendingSaveKey(e){let t=this.debounceTimers.get(e);if(!t)return;this.debounceTimers.delete(e),clearTimeout(t.timer)}cancelPendingSaves(){for(let e of this.debounceTimers.values())clearTimeout(e.timer);this.debounceTimers.clear()}clearComponentHandles(){for(let e of this.handles)e.destroy();this.handles=[]}destroy(){if(this.flushPendingSaves(),this.destroyed=!0,this.pendingView=null,this.pendingFocusRestore=null,this.pendingGeneralFocusRestore=null,this.pointerActiveInDrawer=!1,this.pointerFallbackTimer!==null)clearTimeout(this.pointerFallbackTimer),this.pointerFallbackTimer=null;if(this.pendingViewFlushTimer!==null)clearTimeout(this.pendingViewFlushTimer),this.pendingViewFlushTimer=null;if(this.pointerReleaseCleanup){let e=this.pointerReleaseCleanup;this.pointerReleaseCleanup=null,e()}for(let e of[...this.tabConnectionCleanups])e();this.tabConnectionCleanups.clear(),this.rootEl=null,this.headerEl=null,this.noticeEl=null,this.recoveryUi=null,this.orderStateTags.clear(),this.tab.root.removeEventListener("pointerdown",this.onPointerDownInDrawer),this.tab.root.removeEventListener("mousedown",this.onPointerDownInDrawer),this.tab.root.removeEventListener("focusout",this.onFocusOut),this.cancelPendingSaves(),this.clearComponentHandles(),this.tab.root.replaceChildren(),this.tab.destroy()}}function Ge(e){return Boolean(e&&typeof e==="object"&&e.nodeType===1)}function Rt(e){let t=e.tagName;return t==="INPUT"||t==="TEXTAREA"||t==="SELECT"||e.isContentEditable}function rn(e,t){if(!Ge(t)||!e.contains(t))return!1;return Boolean(t.closest('button, [role="button"], [role="switch"], [role="menuitem"], [role="option"], summary, a[href]'))}function sn(e){if(typeof CSS<"u"&&typeof CSS.escape==="function")return CSS.escape(e);return e.replace(/\\/g,"\\\\").replace(/"/g,"\\\"")}function Tt(e,t,n,i){let r=i?i.toLowerCase():"";try{let s=sn(n);return e.querySelector(`${r}[${t}="${s}"]`)}catch{for(let s of e.querySelectorAll(`${r}[${t}]`))if(s.getAttribute(t)===n)return s;return null}}function on(e){return e.connections?.getActive?.()?.activeProfileId??null}function et(e){return e?{kind:"llm",id:e}:{kind:"llm"}}function tt(e,t,n){let r=(e?t.find((s)=>s.id===e):(n?t.find((s)=>s.id===n):void 0)??t.find((s)=>s.isDefault)??t[0])?.model?.trim();return r?`Use connection model (${r})`:"Leave blank for connection model"}var an=0;function se(e,t){let n=document.createElement("div");n.className="gg-field";let i=document.createElement("label");if(i.className="gg-field-label",i.id=`gg-field-label-${++an}`,t)i.htmlFor=t;i.textContent=e;let r=document.createElement("div");return n.append(i,r),{wrap:n,slot:r,label:i}}function ln(e){return[{value:"",label:"Use Active Connection",sublabel:"Inherits whichever connection profile is currently active"},...e.map((t)=>({value:t.id,label:t.name,sublabel:t.model?`${t.provider} · ${t.model}`:t.provider}))]}function dn(e){return[{value:"",label:"Use Active Preset",sublabel:"Inherits the active chat or connection preset"},...e.map((t)=>({value:t.id,label:t.name}))]}var cn=new Set(["guided_response","guided_regenerate","guided_swipe","guided_continue"]),Mt=new Set(["guided_response","guided_regenerate"]),un=new Set(["guided_continue","guided_swipe"]);function _t(e){return Boolean(e)&&typeof e==="object"&&!Array.isArray(e)}class it{ctx;disposers=[];runStateById=new Map;currentRun=null;viewedSwipeId=void 0;swipeInitialized=!1;contentSeen=!1;mountedEl=null;mountedTarget=null;mountedPosition=null;mountedIsMessageContent=null;mountedMessageId=null;streamAfterMount=null;optimisticStreamEl=null;rafId=null;rafTimerId=null;rowObserver=null;observedRow=null;rafRetries=0;retryMode=null;destroyed=!1;constructor(e){this.ctx=e;if(typeof this.ctx.events?.on==="function"){let t=()=>{if(!this.destroyed)this.rafRetries=0,this.syncCurrent()};this.disposers.push(this.ctx.events.on("MESSAGE_SWIPED",(n)=>{this.onMessageEvent(n,"MESSAGE_SWIPED")}),this.ctx.events.on("MESSAGE_EDITED",(n)=>{this.onMessageEvent(n,"MESSAGE_EDITED")}),this.ctx.events.on("MESSAGE_SENT",(n)=>{this.onMessageEvent(n,"MESSAGE_SENT")}),this.ctx.events.on("CHAT_CHANGED",t),this.ctx.events.on("CHAT_SWITCHED",t))}}sync(e){if(this.destroyed)return;let t=this.currentRun;if(t)this.saveRunState(t.runId);if(t?.runId!==e?.runId){let n=e?this.runStateById.get(e.runId):void 0;if(n)this.contentSeen=n.contentSeen,this.viewedSwipeId=n.viewedSwipeId,this.swipeInitialized=n.swipeInitialized;else this.contentSeen=!1,this.viewedSwipeId=void 0,this.swipeInitialized=!1;this.resetRetry()}else if(t?.messageId!==e?.messageId)this.resetRetry();if(this.currentRun=e,e&&!this.swipeInitialized&&e.swipeId!==void 0)this.viewedSwipeId=e.backgroundSwipe?void 0:e.swipeId,this.swipeInitialized=!0;if(e)this.saveRunState(e.runId);this.syncCurrent()}destroy(){if(this.destroyed)return;this.destroyed=!0,this.resetRetry(),this.unmount(),this.streamAfterMount=null,this.currentRun=null,this.runStateById.clear();for(let e of this.disposers)try{e()}catch{}this.disposers.length=0}saveRunState(e){if(!e)return;if(this.runStateById.has(e))this.runStateById.delete(e);if(this.runStateById.set(e,{viewedSwipeId:this.viewedSwipeId,swipeInitialized:this.swipeInitialized,contentSeen:this.contentSeen}),this.runStateById.size>32){let t=this.runStateById.keys().next().value;if(t!==void 0)this.runStateById.delete(t)}}onMessageEvent(e,t){if(this.destroyed||!this.currentRun?.messageId)return;let n=_t(e)?e:null,i=n&&_t(n.message)?n.message:null,r=typeof i?.id==="string"?i.id:typeof n?.messageId==="string"?n.messageId:void 0;if(r!==void 0&&r!==this.currentRun.messageId)return;if(r===this.currentRun.messageId){let s=this.viewedSwipeId,o=this.swipeInitialized,d=this.contentSeen,l=typeof i?.swipe_id==="number"?i.swipe_id:typeof n?.swipeId==="number"?n.swipeId:void 0;if(l!==void 0)this.viewedSwipeId=l,this.swipeInitialized=!0;if(typeof i?.content==="string"&&i.content.length>0&&(this.currentRun.swipeId==null||this.viewedSwipeId===this.currentRun.swipeId||this.viewedSwipeId===void 0))this.contentSeen=!0;if(this.viewedSwipeId!==s||this.swipeInitialized!==o||this.contentSeen!==d)this.saveRunState(this.currentRun.runId);if(t==="MESSAGE_SWIPED")this.rafRetries=0}this.syncCurrent()}syncCurrent(){if(this.destroyed)return;let e=this.currentRun,t=this.resolveDisplayPlan(e);if(t.kind==="none"){this.resetRetry(),this.unmount();return}if(t.kind==="stream_after"){this.resetRetry(),this.unmountRow(),this.mountOptimisticStreamAfter();return}if(typeof this.ctx.dom?.findMessageElement!=="function"||typeof this.ctx.dom?.inject!=="function"){if(t.allowStreamAfterFallback)this.mountOptimisticStreamAfter();return}if(this.mountedEl&&this.mountedTarget&&this.mountedPosition&&this.mountedIsMessageContent===!0&&this.mountedMessageId===t.messageId&&this.mountedEl.isConnected&&this.mountedTarget.isConnected&&this.isMountedAt(this.mountedEl,this.mountedTarget,this.mountedPosition)){this.unmountOptimisticStreamAfter(),this.resetRetry();return}let n=this.resolveTarget(t.messageId,t.actionId);if(!n){if(this.unmountRow(),t.allowStreamAfterFallback)this.mountOptimisticStreamAfter();else this.unmountOptimisticStreamAfter();if(t.retryRowIfMissing)this.ensureRetryMode("row"),this.scheduleRetry();else this.resetRetry();return}let i=Boolean(e?.hasContentOutput||this.contentSeen);if(this.unmountOptimisticStreamAfter(),this.mountedEl&&this.mountedTarget===n.element&&this.mountedPosition===n.position&&this.mountedIsMessageContent===n.isMessageContent&&this.mountedMessageId===t.messageId&&this.isMountedAt(this.mountedEl,n.element,n.position)){if(!n.isMessageContent&&i)this.ensureRetryMode("content"),this.scheduleRetry(n.row);else this.resetRetry();return}this.unmountRow();let r=n.isMessageContent?'<div class="gg-streaming-indicator gg-streaming-indicator--after" role="status" aria-label="Generating response"><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span></div>':'<div class="gg-streaming-indicator" role="status" aria-label="Generating response"><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span></div>';if(this.mountedEl=this.ctx.dom.inject(n.element,r,n.position),this.mountedTarget=n.element,this.mountedPosition=n.position,this.mountedIsMessageContent=n.isMessageContent,this.mountedMessageId=t.messageId,!n.isMessageContent&&i)this.ensureRetryMode("content"),this.scheduleRetry(n.row);else this.resetRetry()}resolveDisplayPlan(e){if(!e||this.destroyed)return{kind:"none"};if(!cn.has(e.actionId))return{kind:"none"};let t=this.safeGetActiveChatId();if(!t||e.chatId!==t)return{kind:"none"};if(typeof e.messageId==="string"&&e.messageId.length>0){if(e.actionId==="guided_swipe"){if(typeof e.swipeId!=="number"||this.viewedSwipeId!==e.swipeId)return{kind:"none"}}else if(e.swipeId!=null&&this.viewedSwipeId!==e.swipeId)return{kind:"none"};return{kind:"row",messageId:e.messageId,actionId:e.actionId,allowStreamAfterFallback:Mt.has(e.actionId),retryRowIfMissing:!0}}if(e.actionId==="guided_swipe"&&e.backgroundSwipe)return{kind:"none"};if(Mt.has(e.actionId))return{kind:"stream_after"};if(un.has(e.actionId)){if(typeof this.ctx.messages?.getLatestMessageId==="function"){let i=this.safeGetLatestMessageId();if(!i)return{kind:"none"};return{kind:"row",messageId:i,actionId:e.actionId,allowStreamAfterFallback:!0,retryRowIfMissing:!1}}return{kind:"stream_after"}}return{kind:"none"}}safeGetLatestMessageId(){try{let e=this.ctx.messages?.getLatestMessageId?.();return typeof e==="string"&&e.length>0?e:null}catch{return null}}getStreamAfterMount(){if(this.destroyed)return null;if(this.streamAfterMount)return this.streamAfterMount;if(typeof this.ctx.ui?.mount!=="function")return null;try{return this.streamAfterMount=this.ctx.ui.mount("chat_stream_after"),this.streamAfterMount}catch{return null}}mountOptimisticStreamAfter(){if(this.destroyed)return;let e=this.getStreamAfterMount();if(!e)return;if(this.optimisticStreamEl&&this.optimisticStreamEl.parentNode===e)return;if(this.unmountOptimisticStreamAfter(),typeof document>"u")return;let t=document.createElement("div");t.innerHTML='<div class="gg-streaming-indicator gg-streaming-indicator--optimistic" data-gg-optimistic-indicator="true" role="status" aria-label="Generating response"><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span></div>';let n=t.firstElementChild;if(!n)return;e.append(n),this.optimisticStreamEl=n}unmountOptimisticStreamAfter(){let e=this.optimisticStreamEl;if(this.optimisticStreamEl=null,!e)return;try{e.remove()}catch{}}safeGetActiveChatId(){try{return this.ctx.getActiveChat?.().chatId??null}catch{return null}}isMountedAt(e,t,n){if(n==="afterend")return t.parentNode!==null&&t.nextElementSibling===e;if(n==="beforebegin")return t.parentNode!==null&&t.previousElementSibling===e;return t.contains(e)}resolveTarget(e,t){if(typeof this.ctx.dom?.findMessageElement!=="function")return null;let n=this.ctx.dom.findMessageElement(e);if(!n)return null;let i=n.querySelector('[data-component="MessageContent"]');if(i)return{row:n,element:i,position:"afterend",isMessageContent:!0};if(t==="guided_continue")return this.resolveContinueFallbackTarget(n);let r=n.querySelector('[data-spindle-mount="message_body_before"]');if(r)return{row:n,element:r,position:"beforeend",isMessageContent:!1};let s=n.querySelector('[data-spindle-mount="message_body_after"]');if(s)return{row:n,element:s,position:"beforeend",isMessageContent:!1};let o=n.querySelector('[data-component="BubbleMessage"] > div > div:last-child');if(o)return{row:n,element:o,position:"beforeend",isMessageContent:!1};if(typeof n.matches==="function"&&n.matches('[data-component="BubbleMessage"]')){let l=n.firstElementChild?.lastElementChild;return l?{row:n,element:l,position:"beforeend",isMessageContent:!1}:null}let d=n.querySelector('[data-component="MinimalMessage"] > div');if(d)return{row:n,element:d,position:"beforeend",isMessageContent:!1};if(typeof n.matches==="function"&&n.matches('[data-component="MinimalMessage"]')){let l=n.firstElementChild;return l?{row:n,element:l,position:"beforeend",isMessageContent:!1}:null}return null}resolveContinueFallbackTarget(e){let t=e.querySelector('[data-spindle-mount="message_body_after"]');if(t)return{row:e,element:t,position:"beforeend",isMessageContent:!1};let n=e.querySelector('[data-spindle-mount="message_body_before"]');if(n)return{row:e,element:n,position:"beforeend",isMessageContent:!1};let i=e.querySelector('[data-component="BubbleMessage"] [class*="content"]');if(i)return{row:e,element:i,position:"beforeend",isMessageContent:!1};if(typeof e.matches==="function"&&e.matches('[data-component="BubbleMessage"]')){let o=e.querySelector('[class*="content"]')??e.firstElementChild?.lastElementChild;if(o)return{row:e,element:o,position:"beforeend",isMessageContent:!1}}let r=e.querySelector('[data-component="BubbleMessage"] > div > div:last-child');if(r)return{row:e,element:r,position:"beforeend",isMessageContent:!1};let s=e.querySelector('[data-component="MinimalMessage"] > div');if(s)return{row:e,element:s,position:"beforeend",isMessageContent:!1};if(typeof e.matches==="function"&&e.matches('[data-component="MinimalMessage"]')&&e.firstElementChild)return{row:e,element:e.firstElementChild,position:"beforeend",isMessageContent:!1};return{row:e,element:e,position:"beforeend",isMessageContent:!1}}ensureRetryMode(e){if(this.retryMode!==e)this.cancelRetry(),this.rafRetries=0,this.retryMode=e}resetRetry(){this.cancelRetry(),this.rafRetries=0,this.retryMode=null}unmountRow(){let e=this.mountedEl;if(this.mountedEl=null,this.mountedTarget=null,this.mountedPosition=null,this.mountedIsMessageContent=null,this.mountedMessageId=null,this.disconnectRowObserver(),!e)return;try{if(typeof this.ctx.dom?.uninject==="function")this.ctx.dom.uninject(e);else e.remove()}catch{}}unmount(){this.unmountRow(),this.unmountOptimisticStreamAfter()}scheduleRetry(e){if(this.destroyed||this.rafId!==null||this.rafTimerId!==null)return;if(this.rowObserver!==null){if(e&&this.observedRow===e)return;this.disconnectRowObserver()}if(this.rafRetries<2){this.rafRetries+=1;let i=typeof globalThis.requestAnimationFrame==="function"?globalThis.requestAnimationFrame.bind(globalThis):void 0;if(i)this.rafId=i(()=>{if(this.rafId=null,!this.destroyed)this.syncCurrent()});else this.rafTimerId=setTimeout(()=>{if(this.rafTimerId=null,!this.destroyed)this.syncCurrent()},16);return}if(this.retryMode==="content"&&e&&typeof globalThis.MutationObserver==="function"){let i=new globalThis.MutationObserver((r)=>{if(this.destroyed||this.retryMode!=="content"){this.disconnectRowObserver();return}let s=!1;for(let o of r){for(let d=0;d<o.addedNodes.length;d+=1)if(o.addedNodes[d]?.nodeType===1){s=!0;break}if(s)break}if(s)this.syncCurrent()});i.observe(e,{childList:!0,subtree:!0}),this.rowObserver=i,this.observedRow=e;return}if(this.rafRetries>=10)return;let t=this.rafRetries-2;this.rafRetries+=1;let n=Math.min(500,32*2**t);this.rafTimerId=setTimeout(()=>{if(this.rafTimerId=null,!this.destroyed)this.syncCurrent()},n)}disconnectRowObserver(){if(this.rowObserver){try{this.rowObserver.disconnect()}catch{}this.rowObserver=null}this.observedRow=null}cancelRetry(){if(this.rafId!==null){if(typeof globalThis.cancelAnimationFrame==="function")globalThis.cancelAnimationFrame(this.rafId);this.rafId=null}if(this.rafTimerId!==null)clearTimeout(this.rafTimerId),this.rafTimerId=null;this.disconnectRowObserver()}}var Pt=`
.gg-actions-host {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  min-width: 0;
}

.gg-actions-host.is-before-native {
  order: -1;
}

.gg-actions-host.is-right {
  margin-left: auto;
}

.gg-actions-host--row {
  display: flex;
  align-items: center;
  max-width: 100%;
  flex-wrap: wrap;
}

.gg-actions-host .gg-toolbar,
.gg-actions-host--row .gg-toolbar {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  max-width: 100%;
  flex-wrap: nowrap;
}

.gg-actions-host--row .gg-toolbar {
  flex-wrap: wrap;
}

.gg-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 30px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: var(--lcs-radius-xs, 6px);
  background: transparent;
  color: var(--lumiverse-text-dim, rgba(230, 230, 240, 0.45));
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  touch-action: manipulation;
  transition:
    color var(--lcs-transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1)),
    background var(--lcs-transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1)),
    transform 90ms ease;
}

.gg-btn:hover:not(:disabled) {
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.06));
  color: var(--lumiverse-text, rgba(230, 230, 240, 0.92));
}

.gg-btn:active:not(:disabled) {
  transform: scale(0.95);
}

.gg-btn.is-holding {
  background: rgba(139, 92, 246, 0.22);
  color: var(--lumiverse-primary, #c4b5fd);
  box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.35);
  transform: scale(0.92);
}

.gg-btn.is-running {
  background: rgba(239, 68, 68, 0.2);
  color: #fecaca;
  box-shadow: 0 0 0 1px rgba(248, 113, 113, 0.35);
}

.gg-btn.is-running::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  border: 2px solid rgba(248, 113, 113, 0.45);
  pointer-events: none;
  will-change: transform, opacity;
  animation: gg-pulse 1.3s ease-in-out infinite;
}

.gg-btn.is-dimmed,
.gg-btn:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.gg-btn svg {
  width: 14px;
  height: 14px;
  pointer-events: none;
  display: block;
}

@media (max-width: 768px) {
  .gg-btn {
    width: 28px;
  }
}

@keyframes gg-pulse {
  0%, 100% {
    transform: scale(1);
    opacity: 0.75;
  }
  50% {
    transform: scale(1.22);
    opacity: 0;
  }
}

/* Settings Drawer */
.gg-drawer {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  color: var(--lumiverse-text, var(--text-primary, #e5e7eb));
  font-size: 13px;
}

.gg-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.gg-header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.gg-muted {
  margin: 4px 0 0;
  color: var(--lumiverse-text-dim, var(--text-secondary, rgba(229, 231, 235, 0.68)));
  font-size: 12px;
  line-height: 1.4;
}

.gg-notice {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(59, 130, 246, 0.38);
  background: rgba(59, 130, 246, 0.12);
  font-size: 12px;
  line-height: 1.4;
}

.gg-notice.is-error {
  border-color: rgba(239, 68, 68, 0.5);
  background: rgba(239, 68, 68, 0.14);
  color: #fecaca;
}

.gg-notice.is-warn {
  border-color: rgba(245, 158, 11, 0.48);
  background: rgba(245, 158, 11, 0.14);
  color: #fde68a;
}

.gg-section-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 12px 12px;
}

.gg-card {
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.12));
  border-radius: 10px;
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.03));
  overflow: visible;
}

.gg-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  border-radius: 10px;
}

.gg-card-header:hover {
  background: var(--lumiverse-fill-hover, rgba(255, 255, 255, 0.06));
}

.gg-card-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.gg-card-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  transition: transform 140ms ease;
  opacity: 0.72;
}

.gg-card.is-expanded .gg-card-chevron {
  transform: rotate(90deg);
}

.gg-card-badge {
  font-size: 11px;
  font-weight: 500;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(139, 92, 246, 0.16);
  color: var(--lumiverse-primary, #c4b5fd);
}

.gg-card-badge.is-muted {
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.08));
  color: var(--lumiverse-text-dim, var(--text-secondary, rgba(229, 231, 235, 0.65)));
}

.gg-card-body-wrap {
  border-top: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.08));
}

.gg-card:not(.is-expanded) .gg-card-body-wrap {
  display: none;
}

.gg-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.gg-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.gg-field-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--lumiverse-text, var(--text-secondary, rgba(229, 231, 235, 0.85)));
}

.gg-btn-sm {
  padding: 5px 10px;
  border-radius: 7px;
  border: 1px solid var(--lumiverse-border, var(--border-color, rgba(255, 255, 255, 0.16)));
  background: var(--lumiverse-fill, var(--surface-elevated, rgba(255, 255, 255, 0.08)));
  color: inherit;
  font-size: 12px;
  cursor: pointer;
}

.gg-btn-sm:hover:not(:disabled) {
  background: var(--lumiverse-fill-hover, var(--surface-hover, rgba(255, 255, 255, 0.15)));
}

.gg-btn-sm:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.gg-input-sm {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border-radius: 7px;
  border: 1px solid var(--lumiverse-border, var(--border-color, rgba(255, 255, 255, 0.16)));
  background: var(--lumiverse-fill, var(--surface-elevated, rgba(255, 255, 255, 0.06)));
  color: inherit;
  font: inherit;
  font-size: 12.5px;
}

.gg-input-sm:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.gg-recovery-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 220px;
  overflow-y: auto;
}

.gg-recovery-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 7px;
  border: 1px solid var(--lumiverse-border, var(--border-color, rgba(255, 255, 255, 0.1)));
  background: var(--lumiverse-fill-subtle, rgba(0, 0, 0, 0.16));
}

.gg-recovery-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.gg-recovery-tag {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--lumiverse-text-dim, var(--text-secondary, rgba(229, 231, 235, 0.6)));
}

.gg-recovery-snippet {
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gg-order-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.gg-order-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 7px;
  border: 1px solid var(--lumiverse-border, var(--border-color, rgba(255, 255, 255, 0.1)));
  background: var(--lumiverse-fill-subtle, rgba(0, 0, 0, 0.16));
}

.gg-order-item-left {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.gg-order-item-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  color: var(--lumiverse-text-dim, var(--text-secondary, rgba(229, 231, 235, 0.78)));
}

.gg-order-item-icon svg {
  width: 14px;
  height: 14px;
  display: block;
}

.gg-order-item-label {
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gg-order-item-state {
  font-size: 10.5px;
  color: var(--lumiverse-text-dim, var(--text-secondary, rgba(229, 231, 235, 0.55)));
}

.gg-order-item-controls {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.gg-icon-btn-sm {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border, var(--border-color, rgba(255, 255, 255, 0.14)));
  background: var(--lumiverse-fill, var(--surface-elevated, rgba(255, 255, 255, 0.06)));
  color: inherit;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}

.gg-icon-btn-sm:hover:not(:disabled) {
  background: var(--lumiverse-fill-hover, var(--surface-hover, rgba(255, 255, 255, 0.14)));
}

.gg-icon-btn-sm:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* Guided Continue Drop-Up Menu (portaled to document.body) */
.gg-dropup-menu {
  position: fixed;
  z-index: 11000;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 210px;
  max-width: calc((100vw - 16px) / var(--lumiverse-ui-scale, 1));
  padding: 4px;
  border-radius: var(--lcs-radius-md, 10px);
  border: 1px solid var(--lumiverse-border, var(--border-color, rgba(255, 255, 255, 0.14)));
  background: var(--lumiverse-bg-deep, var(--bg-secondary, #18181f));
  color: var(--lumiverse-text, var(--text-primary, #e5e7eb));
  box-shadow:
    0 10px 28px rgba(0, 0, 0, 0.45),
    0 2px 8px rgba(0, 0, 0, 0.25);
  box-sizing: border-box;
}

.gg-dropup-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 36px;
  padding: 7px 10px;
  border: none;
  border-radius: var(--lcs-radius-xs, 6px);
  background: transparent;
  color: var(--lumiverse-text, var(--text-primary, #e5e7eb));
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.25;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  touch-action: manipulation;
  transition:
    background 120ms ease,
    color 120ms ease;
}

.gg-dropup-item:hover {
  background: var(--lumiverse-fill, var(--bg-hover, rgba(255, 255, 255, 0.08)));
}

.gg-dropup-item:focus-visible {
  background: var(--lumiverse-fill, var(--bg-hover, rgba(255, 255, 255, 0.08)));
  outline: 2px solid var(--lumiverse-primary, var(--accent-primary, #8b5cf6));
  outline-offset: -2px;
}

.gg-dropup-item svg {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  pointer-events: none;
  display: block;
  color: var(--lumiverse-primary, var(--accent-primary, currentColor));
}

.gg-dropup-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 4px 6px 6px;
  border-bottom: 1px solid var(--lumiverse-border, var(--border-color, rgba(255, 255, 255, 0.1)));
  margin-bottom: 2px;
}

.gg-dropup-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 7px;
  border: none;
  border-radius: var(--lcs-radius-xs, 6px);
  background: transparent;
  color: var(--lumiverse-text-dim, var(--text-secondary, rgba(229, 231, 235, 0.75)));
  font: inherit;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  touch-action: manipulation;
}

.gg-dropup-back:hover {
  background: var(--lumiverse-fill, var(--bg-hover, rgba(255, 255, 255, 0.08)));
  color: var(--lumiverse-text, var(--text-primary, #e5e7eb));
}

.gg-dropup-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--lumiverse-text-dim, var(--text-secondary, rgba(229, 231, 235, 0.6)));
  padding-right: 4px;
}

.gg-dropup-history-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 220px;
  overflow-y: auto;
}

.gg-dropup-history-item {
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 220px;
  max-width: 300px;
}

.gg-dropup-history-tag {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--lumiverse-text-dim, var(--text-secondary, rgba(229, 231, 235, 0.6)));
}

.gg-dropup-history-snippet {
  font-size: 12.5px;
  width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gg-dropup-empty {
  padding: 10px 12px;
  font-size: 12px;
  color: var(--lumiverse-text-dim, var(--text-secondary, rgba(229, 231, 235, 0.65)));
  text-align: center;
}


/* Streaming Indicator */
.gg-streaming-indicator {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 0;
}

.gg-streaming-indicator--after {
  margin-top: 4px;
}

.gg-streaming-indicator--optimistic {
  padding: 8px 16px;
}

.gg-streaming-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--lumiverse-primary, rgba(147, 112, 219, 0.9));
  animation: gg-streaming-bounce 1.2s ease-in-out infinite;
}

.gg-streaming-dot:nth-child(2) {
  animation-delay: 0.15s;
}

.gg-streaming-dot:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes gg-streaming-bounce {
  0%, 100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  30% {
    transform: translateY(-5px);
    opacity: 1;
  }
}

/* Floating Chat Heads */
.gg-chat-heads-root {
  position: fixed;
  z-index: 10950;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 6px;
  overflow: visible;
  transform: translate(-50%, -50%);
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  touch-action: none;
  cursor: grab;
}

.gg-chat-heads-root.is-dragging {
  cursor: grabbing;
}

.gg-chat-heads-root.is-dragging .gg-chat-head {
  cursor: grabbing;
}

.gg-chat-heads-root.is-dragging .gg-chat-head:active {
  transform: none;
}

.gg-chat-head-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  touch-action: none;
}

.gg-chat-head-dismiss {
  position: absolute;
  top: -4px;
  left: -4px;
  width: 18px;
  height: 18px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.25));
  background: var(--lumiverse-bg-deep, #18181f);
  color: var(--lumiverse-text, #e5e7eb);
  font-size: 11px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  touch-action: manipulation;
  opacity: 0;
  transform: scale(0.85);
  transition: opacity 140ms ease, transform 140ms ease, background 140ms ease;
  z-index: 1;
}

.gg-chat-head-item:hover .gg-chat-head-dismiss,
.gg-chat-head-item:focus-within .gg-chat-head-dismiss {
  opacity: 1;
  transform: scale(1);
}

.gg-chat-head-dismiss:hover {
  background: var(--lumiverse-danger, #ef4444);
  border-color: rgba(255, 255, 255, 0.4);
  color: #fff;
}

@media (hover: none), (pointer: coarse) {
  .gg-chat-head-dismiss {
    opacity: 1;
    transform: scale(1);
    width: 22px;
    height: 22px;
    top: -5px;
    left: -5px;
    font-size: 12px;
  }
}

.gg-chat-head {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  padding: 0;
  border-radius: 50%;
  border: 2px solid var(--lumiverse-border, rgba(255, 255, 255, 0.22));
  background: var(--lumiverse-bg-deep, var(--bg-secondary, #18181f));
  color: var(--lumiverse-text, var(--text-primary, #e5e7eb));
  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.45),
    0 2px 6px rgba(0, 0, 0, 0.28);
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  touch-action: none;
  transition:
    transform 140ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease;
}

.gg-chat-head:hover {
  transform: scale(1.06);
}

.gg-chat-head:active {
  transform: scale(0.96);
}

.gg-chat-head.is-running {
  border-color: var(--lumiverse-warning, #f59e0b);
  box-shadow:
    0 0 0 3px rgba(245, 158, 11, 0.24),
    0 8px 24px rgba(0, 0, 0, 0.45);
}

.gg-chat-head.is-running::after {
  content: "";
  position: absolute;
  inset: -2px;
  border-radius: 50%;
  border: 2px solid rgba(139, 92, 246, 0.45);
  pointer-events: none;
  will-change: transform, opacity;
  animation: gg-chat-head-pulse 1.5s ease-in-out infinite;
}

.gg-chat-head.is-streaming {
  border-color: var(--lumiverse-primary, #8b5cf6);
  box-shadow:
    0 0 0 3px rgba(139, 92, 246, 0.28),
    0 8px 24px rgba(0, 0, 0, 0.45);
}

.gg-chat-head.is-completed {
  border-color: var(--lumiverse-success, #22c55e);
  box-shadow:
    0 0 0 3px rgba(34, 197, 94, 0.3),
    0 8px 24px rgba(0, 0, 0, 0.45);
}

.gg-chat-head-avatar {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  pointer-events: none;
  -webkit-user-drag: none;
  display: block;
}

.gg-chat-head-initials {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--lumiverse-text, #e5e7eb);
  pointer-events: none;
}

.gg-chat-head-badge {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 2px solid var(--lumiverse-bg-deep, #18181f);
  background: var(--lumiverse-warning, #f59e0b);
  pointer-events: none;
}

.gg-chat-head.is-streaming .gg-chat-head-badge {
  background: var(--lumiverse-primary, #8b5cf6);
}

.gg-chat-head.is-completed .gg-chat-head-badge {
  background: var(--lumiverse-success, #22c55e);
}

.gg-chat-head-pip {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 2px solid var(--lumiverse-bg-deep, #18181f);
  background: var(--lumiverse-danger, #ef4444);
  pointer-events: none;
}

@keyframes gg-chat-head-pulse {
  0%, 100% {
    transform: scale(1);
    opacity: 0.75;
  }
  50% {
    transform: scale(1.16);
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .gg-btn,
  .gg-btn.is-running::after,
  .gg-chat-head,
  .gg-chat-head.is-running::after,
  .gg-chat-head-dismiss,
  .gg-card-chevron,
  .gg-dropup-item {
    animation: none !important;
    transition: none !important;
  }
}
`;var kt="pending:",hn=200;function rt(e){return typeof e==="string"&&e.startsWith(kt)}function Ue(e){return Boolean(e)&&typeof e==="object"&&!Array.isArray(e)}function le(e,t){if(Object.is(e,t))return!0;if(typeof e!==typeof t||e===null||t===null)return!1;if(typeof e!=="object")return!1;if(Array.isArray(e)||Array.isArray(t)){if(!Array.isArray(e)||!Array.isArray(t)||e.length!==t.length)return!1;for(let o=0;o<e.length;o+=1)if(!le(e[o],t[o]))return!1;return!0}let n=e,i=t,r=Object.keys(n),s=Object.keys(i);if(r.length!==s.length)return!1;for(let o of r){if(!Object.prototype.hasOwnProperty.call(i,o))return!1;if(!le(n[o],i[o]))return!1}return!0}function st(e){if(!Ue(e))return null;if(typeof e.chatId==="string"&&e.chatId)return e.chatId;if(Ue(e.chat)&&typeof e.chat.id==="string")return e.chat.id;return null}function pn(e){let t=st(e);if(t)return t;if(Ue(e)&&typeof e.id==="string"&&e.id)return e.id;return null}function Lt(e,t){if(!Array.isArray(t)||t.length===0)return e;return{...e,connections:t.map((n)=>({id:n.id,name:n.name,provider:n.provider??"",model:n.model??"",isDefault:Boolean(n.is_default)}))}}async function gn(e,t){if(e.connections.length>0||!t.connections?.list)return e;try{let n=t.connections.list();if(n&&typeof n.then==="function"){let i=await n;return Lt(e,i)}return Lt(e,n)}catch{return e}}function Fn(e){let t=e,n=t.dom.addStyle(Pt),i=[],r=!1,s=0,o=0,d=0,l=0,h=0,a=0,u=!1,v=new Set,c=null,g=!1,b=!1,I=null,S=null,C=new Map,w=new Map,y=new Map,x=[0,20,50,100,200],A,M=null,N=0,H,L=null,k=null,X=!1,K=!1,P=!0,z=!1,j=null,te=!1,de=t.getActiveChat().chatId;function q(p,m){if(w.has(p))w.delete(p);else if(w.size>=hn){let f=w.keys().next().value;if(f!==void 0)w.delete(f)}w.set(p,m)}try{L=t.ui.mount("chat_composer_above")}catch{L=null}function G(p){if(!p)return null;return C.get(p)??(S?.chatId===p?S:null)}function ne(p){if(!p)return!1;return Boolean(G(p))||v.has(p)}function oe(){let p=t.getActiveChat().chatId;if(p&&C.has(p)){S=C.get(p);return}let m=null;for(let f of C.values())if(!m||f.startedAt>=m.startedAt)m=f;S=m}function R(p,m,f){let E={runId:`${kt}${++o}`,actionId:p,chatId:m,startedAt:Date.now(),...f?.backgroundSwipe?{backgroundSwipe:!0}:{}};if(h+=1,q(m,h),C.set(m,E),oe(),c)c={...c,activeRun:S};let _=t.getActiveChat().chatId;return me.sync(G(_)),ie(),E}function V(p,m){let f=C.get(p);if(!f||f.runId!==m)return!1;if(h+=1,q(p,h),C.delete(p),oe(),c)c={...c,activeRun:S};if(!r){let E=t.getActiveChat().chatId;me.sync(G(E)),ie()}return!0}function J(){if(A!==void 0)clearTimeout(A),A=void 0;M=null,N=0}function ke(p){if(r)return;if(M!==p)J(),M=p,N=0;if(A!==void 0)return;let m=x[N];if(m===void 0)return;N+=1,A=setTimeout(()=>{if(A=void 0,r)return;Ve(p,{fromRetry:!0})},m)}function Ve(p,m={}){if(r||!p)return;let f=y.get(p);if(f===void 0){if(M===p)J();return}let E=ce();if(t.getActiveChat().chatId!==p){if(M===p)J();return}if(!ue(E)||E.chatId!==p){if(!m.fromRetry)J();ke(p);return}if(J(),E.text.trim().length>0)return;if(Ee(f,E))y.delete(p),Ie(E)}function ce(){if(r)return null;try{return t.composer?.getState?.()??null}catch{return null}}function ue(p){return Boolean(p)&&p.mounted!==!1}function Ee(p,m){if(r)return!1;let f=m!==void 0?m:ce();if(!ue(f))return!1;try{return t.composer.setText(p),!0}catch{return!1}}function Ie(p){if(r)return!1;let m=p!==void 0?p:ce();if(!ue(m))return!1;try{return t.composer.focus(),!0}catch{return!1}}let Ce=new Map;function he(p,m,f=30000){if(r)return Promise.reject(Error("Extension unloaded."));let E=`gg-${++s}-${Date.now().toString(36)}`;return new Promise((_,T)=>{let O=setTimeout(()=>{Ce.delete(E),T(Error(`Timed out waiting for ${p}.`))},f);Ce.set(E,{resolve:(B)=>_(B),reject:T,timer:O}),t.sendToBackend({type:"gg:rpc",requestId:E,action:p,input:m})})}function F(p,m="info",f=5000){if(r)return;if(U.setNotice(p,m),H)clearTimeout(H),H=void 0;if(L)if(!p)L.replaceChildren();else{let E=document.createElement("div");if(E.className=`gg-notice${m==="error"?" is-error":m==="warn"?" is-warn":""}`,m==="error"||m==="warn")E.setAttribute("role","alert"),E.setAttribute("aria-live","assertive");else E.setAttribute("role","status"),E.setAttribute("aria-live","polite");E.style.margin="4px 12px",E.textContent=p,L.replaceChildren(E)}if(p&&f>0)H=setTimeout(()=>{if(H=void 0,r)return;U.setNotice("","info"),L?.replaceChildren()},f)}function ge(){if(H)clearTimeout(H),H=void 0;if(r)return;U.setNotice("","info"),L?.replaceChildren()}function fe(){if(r)return;let{chatId:p}=t.getActiveChat();U.setRecoveryBusy(ne(p))}function Ke(){if(I)I(),I=null}function ie(){if(r||!c)return;let{chatId:p}=t.getActiveChat();at.render({settings:c.settings,activeRun:G(p),recovery:c.recovery,hasActiveChat:Boolean(p),chatId:p}),fe()}async function pe(p={}){if(r)return;if(!g&&U.isTabConnected())g=!0,Ke(),U.render(c);let m=g&&U.isTabConnected(),f=p.includeCatalogs!==void 0?Boolean(p.includeCatalogs):g&&(!b||m);if(k&&(!f||X))return K=!0,P=P&&Boolean(p.onlyIfChanged),z=z||f,k;let E;return E=(async()=>{let _=++d,T=l,O=h;try{let B=await he("get_bootstrap",{includeCatalogs:f});if(r||_!==d)return;let W=f?await gn(B,t):B;if(r||_!==d)return;let we=c&&l!==T?c.settings:W.settings,Q=new Map,De=W.activeRuns;if(Array.isArray(De)){for(let D of De)if(D&&typeof D.chatId==="string"&&D.chatId.length>0)Q.set(D.chatId,D)}if(W.activeRun&&typeof W.activeRun.chatId==="string"&&W.activeRun.chatId.length>0)Q.set(W.activeRun.chatId,W.activeRun);let Re=new Map;for(let[D,ee]of C.entries())if(rt(ee.runId)&&v.has(D))Re.set(D,ee);if(h===O){C.clear();for(let[D,ee]of Q.entries())C.set(D,ee)}else if(a<=O){for(let D of[...C.keys()])if((w.get(D)??0)<=O){let ee=Q.get(D);if(ee)C.set(D,ee);else C.delete(D)}for(let[D,ee]of Q.entries())if(!C.has(D)&&(w.get(D)??0)<=O)C.set(D,ee)}for(let[D,ee]of Re.entries())if(!C.has(D)&&v.has(D))C.set(D,ee);oe();let xe=S,Y=c,ae={...W,settings:we,activeRun:xe,...!f&&b&&Y!==null?{connections:Y.connections,presets:Y.presets,catalogWarnings:Y.catalogWarnings}:{}},Ft=f&&!b;if(f)b=!0;let Bt=g&&Boolean(p.onlyIfChanged)&&!Ft&&Y!==null&&le(Y.settings,ae.settings)&&le(Y.connections,ae.connections)&&le(Y.presets,ae.presets)&&le(Y.permissions,ae.permissions)&&le(Y.catalogWarnings??[],ae.catalogWarnings??[]);c=ae,S=xe;let ct=t.getActiveChat().chatId;if(me.sync(G(ct)),Ae.syncRuns(Array.from(C.values()).filter((D)=>!rt(D.runId)),ct),g){if(!Bt)U.render(c);else if(!le(Y.recovery,ae.recovery))U.updateRecovery(c.recovery,c.settings)}ie()}catch(B){if(r)return;let W=B instanceof Error?B.message:String(B);F(W,"error")}finally{if(k===E){if(k=null,X=!1,K&&!r){let B=P,W=z;K=!1,P=!0,z=!1,pe({onlyIfChanged:B,includeCatalogs:W})}}}})(),k=E,X=f,E}async function Ht(p,m){if(r||u)return;let f=t.getActiveChat().chatId;if(f&&(G(f)||v.has(f)))return;u=!0;let E=f;if(E)v.add(E),fe();try{if(!c)await pe();if(u=!1,r||!c)return;let{chatId:_}=t.getActiveChat();if(!_){F("Open a chat before triggering a guided action.","warn");return}if(E!==_){if(E)v.delete(E);if(v.has(_))return;E=_,v.add(E),fe()}if(G(_))return;let T=ce();if(!ue(T)){F("Composer is unavailable right now. Open the message input bar and try again.","warn");return}if(T.chatId!==null&&T.chatId!==_){F("Active chat changed; please try again.","warn");return}let O=T.text,B=c.settings.actions[p];if(p==="guided_response"&&!O.trim()){F("Type guidance in the input box before clicking Guided Response.","warn"),Ie();return}ge(),y.delete(_);let W=Boolean(O.trim())&&(B.clearInputOnRun||p==="guided_impersonate");if(W&&!Ee("")){F("Composer is unavailable right now.","warn");return}let we=t.connections?.getActive?.()?.activeProfileId??null,Q=p==="guided_swipe"&&Boolean(m?.backgroundSwipe),De={actionId:p,chatId:_,activeConnectionId:we,inputText:O,...Q?{backgroundSwipe:!0}:{}},Re=R(p,_,{backgroundSwipe:Q});try{if(await he("run_action",De,300000),r)return}catch(xe){if(V(_,Re.runId),r)return;if(W&&!G(_)){let Ne=ce(),ae=t.getActiveChat().chatId;if(ue(Ne)&&Ne.chatId===_&&ae===_&&!Ne.text)Ee(O)}let Y=xe instanceof Error?xe.message:String(xe);F(Y,"error",7000)}finally{V(_,Re.runId)}}finally{if(u=!1,E)v.delete(E);fe()}}function ze(p){let m=t.getActiveChat().chatId;if(r||!c)return;if(ne(m)){F("Wait for the active guided generation to finish before restoring input.","warn");return}let f=ce();if(!ue(f)){F("Composer is unavailable right now — cannot restore input.","warn");return}if(f.chatId!==null&&f.chatId!==m){F("Active chat changed; please try again.","warn");return}if(!Ee(p.text)){F("Composer is unavailable right now — cannot restore input.","warn");return}Ie(),ge()}function Dt(){let p=t.getActiveChat().chatId;if(r||!c||ne(p))return;if(!c.settings.inputRecovery.enabled)return;let m=ce();if(!ue(m)){F("Composer is unavailable right now — cannot clear input.","warn");return}if(m.chatId!==null&&m.chatId!==p){F("Active chat changed; please try again.","warn");return}if(!m.text){Ie(),ge();return}if(!Ee("")){F("Composer is unavailable right now — cannot clear input.","warn");return}Ie(),ge()}async function Nt(){if(r||u)return;let{chatId:p}=t.getActiveChat();if(!p){F("Open a chat before removing the last continue.","warn");return}if(ne(p))return;v.add(p),fe(),y.delete(p);try{ge(),await he("remove_last_continue",{chatId:p})}catch(m){if(r)return;let f=m instanceof Error?m.message:String(m);F(f,"warn",7000)}finally{v.delete(p),fe()}}async function Ot(){if(r||u)return;let{chatId:p}=t.getActiveChat();if(!p){F("Open a chat before regenerating the last continue.","warn");return}if(ne(p))return;v.add(p),y.delete(p);let m=null;try{ge(),m=R("guided_continue",p);let f=t.connections?.getActive?.()?.activeProfileId??null;await he("regenerate_last_continue",{chatId:p,activeConnectionId:f},300000)}catch(f){if(m)V(p,m.runId);if(r)return;let E=f instanceof Error?f.message:String(f);F(E,"error",7000)}finally{if(m)V(p,m.runId);v.delete(p),fe()}}async function ot(){let p=t.getActiveChat().chatId;if(r)return;if(ne(p)){F("Wait for the active guided generation to finish before clearing input recovery history.","warn");return}try{let m=await he("clear_recovery");if(r)return;if(c){if(c={...c,recovery:m},ie(),g)U.updateRecovery(c.recovery,c.settings)}}catch(m){if(r)return;F(m instanceof Error?m.message:String(m),"error")}}let me=new it(t),Ae=new We(t),ve=new Qe(t),at=new Je(t,{onTriggerAction:(p,m)=>{Ht(p,m)},onAbortAction:(p)=>{if(r)return;if(rt(p)){let m=t.getActiveChat().chatId,E=((m?C.get(m):void 0)??Array.from(C.values()).find((_)=>_.runId===p))?.chatId??m;if(E)V(E,p),he("abort_action",{chatId:E}).catch(()=>{return});return}he("abort_action",{runId:p}).catch(()=>{return})},onRestoreLatest:()=>{let p=t.getActiveChat().chatId;if(r||!c||ne(p))return;let m=Et(c.recovery);if(m)ze(m);else Dt()},onRestoreEntry:(p)=>{ze(p)},onClearRecovery:()=>{ot()},onRemoveLastContinue:()=>{Nt()},onRegenerateLastContinue:()=>{Ot()}}),U=new nt(t,{onRefresh:()=>{if(r)return;ge(),pe({includeCatalogs:!0})},onSaveSettings:async(p,m)=>{if(r||!c)return;let f=++l;if(c={...c,settings:p},ie(),m?.rebuildDrawer)U.render(c,{force:!0});try{let E=await he("save_settings",p);if(r||!c||f!==l)return;let _=le(E,c.settings);if(c={...c,settings:E},!_){if(ie(),m?.rebuildDrawer)U.render(c)}}catch(E){if(r)return;if(F(`Failed saving settings: ${E instanceof Error?E.message:String(E)}`,"error"),f===l)pe()}},onRestoreEntry:(p)=>ze(p),onClearRecovery:()=>ot()});g=U.isTabConnected();function lt(){if(r)return;if(Ke(),!g)g=!0,U.render(c);pe({onlyIfChanged:b,includeCatalogs:!0})}if(!g)I=U.observeTabConnection(()=>{lt()}),i.push(()=>{Ke()});function He(p){if(r)return;let m=t.getActiveChat().chatId,f=p!==void 0?p:m,E=`${m??""}\x00${f??""}`;if(E===j)return;if(j=E,de=m,!te)te=!0,queueMicrotask(()=>{te=!1,j=null});J(),oe(),me.sync(G(m)),Ae.onChatChanged(m),ie(),Ve(m),ve.onChatChanged(f)}if(i.push(U.onActivate(()=>{lt()})),i.push(t.onBackendMessage((p)=>{if(r)return;let m=Ue(p)?p:{};if(m.type==="gg:reply"&&typeof m.requestId==="string"){let E=Ce.get(m.requestId);if(!E)return;if(Ce.delete(m.requestId),clearTimeout(E.timer),typeof m.error==="string"&&m.error)E.reject(Error(m.error));else E.resolve(m.result);return}let f=m;switch(f.type){case"gg:status":{h+=1;let E=t.getActiveChat().chatId,_=G(E),T=typeof f.chatId==="string"&&f.chatId.length>0?f.chatId:void 0,O=Boolean(f.done)||Boolean(f.aborted)||Boolean(f.error),B=T?C.get(T):void 0,W=f.run?C.get(f.run.chatId):void 0;if(f.run){if(T&&f.run.chatId!==T&&O){if(C.delete(T),q(T,h),B!==void 0&&B.actionId!=="guided_impersonate"||f.aborted||f.error)y.delete(T)}if(!O||T!==void 0&&f.run.chatId!==T){if(W?.runId!==f.run.runId)y.delete(f.run.chatId);C.set(f.run.chatId,f.run),q(f.run.chatId,h)}else if(C.delete(f.run.chatId),q(f.run.chatId,h),f.run.actionId!=="guided_impersonate"||f.aborted||f.error)y.delete(f.run.chatId)}else if(T){if(C.delete(T),q(T,h),B!==void 0&&B.actionId!=="guided_impersonate"||f.aborted||f.error)y.delete(T)}else if(C.clear(),a=h,O)y.clear();if(oe(),c)c={...c,activeRun:S};let we=G(E),Q=_!==we||E!==null&&(T===E||f.run?.chatId===E)||!T&&!f.run;if(Q)me.sync(we);if(Ae.handleStatusEvent(f,E),Q)ie();if(f.error)F(f.error,"error",7000);return}case"gg:impersonate-chunk":{if(typeof f.text==="string"){let E=f.chatId,T=(typeof E==="string"?E:null)??(C.size===1?Array.from(C.values())[0].chatId:S?.chatId??null),O=t.getActiveChat().chatId;if(T!==null&&T!==O){if(f.done&&!f.aborted&&f.text.length>0)y.set(T,f.text);return}let B=ce();if(!ue(B)||!O||B.chatId!==O){if(f.done&&!f.aborted&&f.text.length>0&&T){if(y.set(T,f.text),T===O)Ve(O)}return}if(Ee(f.text,B)){if(y.delete(O),f.done)Ie(B)}else if(f.done&&!f.aborted&&f.text.length>0)y.set(O,f.text)}return}case"gg:recovery-updated":{if(c&&Array.isArray(f.recovery)){if(c={...c,recovery:f.recovery},ie(),g)U.updateRecovery(c.recovery,c.settings)}return}case"gg:changed":{pe({onlyIfChanged:!0});return}case"gg:generation_metrics":{if(typeof f.chatId==="string"&&typeof f.messageId==="string"&&typeof f.swipeId==="number")ve.handleMetricsEvent(f);return}}})),i.push(t.events.on("CHAT_SWITCHED",(p)=>{He(st(p)??t.getActiveChat().chatId)})),i.push(t.events.on("CHAT_CHANGED",(p)=>{He(st(p)??t.getActiveChat().chatId)})),i.push(t.events.on("CHAT_DELETED",(p)=>{if(r)return;let m=pn(p);if(!m)return;if(h+=1,q(m,h),C.delete(m),y.delete(m),M===m)J();v.delete(m),oe();let f=t.getActiveChat().chatId;me.sync(G(f)),Ae.onChatDeleted(m),ve.onChatDeleted(m),ie()})),i.push(t.events.on("MESSAGE_SWIPED",(p)=>{if(!r)ve.onMessageEvent(p)})),i.push(t.events.on("MESSAGE_EDITED",(p)=>{if(!r)ve.onMessageEvent(p)})),i.push(t.events.on("MESSAGE_DELETED",(p)=>{if(!r)ve.onMessageDeleted(p)})),t.connections?.subscribe)i.push(t.connections.subscribe(()=>{if(!r&&g)if(U.isTabConnected()||!b)pe({onlyIfChanged:!0,includeCatalogs:!0});else b=!1}));let dt=!1;try{if(t.state)i.push(t.state.subscribe("chat.active",()=>{if(t.getActiveChat().chatId===de)return;He()})),dt=!0}catch{}if(!dt){let p=t.getActiveChat().chatId,m=setInterval(()=>{if(r)return;let f=t.getActiveChat().chatId;if(f!==p)p=f,He(f)},600);i.push(()=>clearInterval(m))}return t.ready(),pe(),()=>{try{U.flushPendingSaves()}catch{}if(r=!0,k=null,X=!1,K=!1,J(),H)clearTimeout(H),H=void 0;for(let p of i)try{p()}catch{}i.length=0;for(let p of Ce.values())clearTimeout(p.timer),p.reject(Error("Guided Generations unloaded."));Ce.clear(),v.clear(),C.clear(),w.clear(),y.clear();try{ve.destroy()}catch{}try{Ae.destroy()}catch{}try{me.destroy()}catch{}try{at.destroy()}catch{}try{U.destroy()}catch{}try{L?.replaceChildren()}catch{}try{n()}catch{}}}export{Fn as setup};
