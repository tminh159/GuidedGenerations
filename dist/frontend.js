var Pt={xPct:94,yPct:22};function Ve(e){return Boolean(e)&&typeof e==="object"&&!Array.isArray(e)}function Me(e,t,n){if(!Number.isFinite(e))return t;if(t>n)return(t+n)/2;return Math.max(t,Math.min(n,e))}function qe(e,t=2,n=98){return Me(e,t,n)}function cn(e){return Boolean(e)&&(typeof e==="object"||typeof e==="function")&&typeof e.then==="function"}function un(e){if(!Ve(e))return null;if(typeof e.chatId==="string"&&e.chatId)return e.chatId;if(typeof e.id==="string"&&e.id)return e.id;if(Ve(e.chat)&&typeof e.chat.id==="string"&&e.chat.id)return e.chat.id;return null}function Lt(e){let t=e.trim();if(!t)return"GG";let n=t.split(/[\s_-]+/).filter(Boolean);if(n.length>=2)return`${n[0][0]??""}${n[1][0]??""}`.toUpperCase();return t.slice(0,2).toUpperCase()}function rt(e){return`/api/v1/characters/${encodeURIComponent(e)}/avatar?thumb=1`}function Ue(e){if(typeof e!=="string")return;let t=e.trim();if(!t)return;if(t.startsWith("/")&&!t.startsWith("//"))return t;if(/^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(t))return t;try{let n=new URL(t);if(n.protocol==="http:"||n.protocol==="https:")return t}catch{}return}function hn(e,t,n=0){return!(e.right+n<=t.left||e.left>=t.right+n||e.bottom+n<=t.top||e.top>=t.bottom+n)}class st{ctx;heads=new Map;headItemRefs=new Map;characterCache=new Map;pendingCharacterFetches=new Set;disposers=[];rootEl=null;resizeCleanup=null;dragCleanup=null;suppressClickTimer=null;suppressNextClick=!1;isDragging=!1;pos;destroyed=!1;constructor(e){this.ctx=e;if(this.pos=this.loadPosition(),typeof this.ctx.events?.on==="function")try{this.disposers.push(this.ctx.events.on("CHAT_DELETED",(t)=>{this.onChatDeleted(un(t))}))}catch{}}syncRuns(e,t){if(this.destroyed)return;let n=t!==void 0?t:this.safeGetActiveChatId();if(n){if(this.heads.get(n)?.status==="completed")this.heads.delete(n)}let i=new Map;for(let r of e){let s=r;if(s&&typeof s.chatId==="string"&&s.chatId.length>0)i.set(s.chatId,s)}for(let[r,s]of[...this.heads.entries()]){if(s.status==="completed")continue;if(!i.has(r))this.heads.delete(r)}for(let[,r]of i.entries())this.upsertFromActiveRun(r,n);this.render(n)}handleStatusEvent(e,t){if(this.destroyed)return;let n=t!==void 0?t:this.safeGetActiveChatId(),i=typeof e.chatId==="string"&&e.chatId.length>0?e.chatId:void 0,r=e.run??null,s=Boolean(e.done)||Boolean(e.aborted)||Boolean(e.error);if(i&&(s||!r||r.chatId!==i))this.finalizeChatRun(i,{aborted:Boolean(e.aborted),hasError:Boolean(e.error)},n);let o=i===void 0&&s&&Boolean(e.error);if(r&&typeof r.chatId==="string"&&r.chatId.length>0){if(!s||o||i!==void 0&&r.chatId!==i)this.upsertFromActiveRun(r,n);else if(!i&&s)this.finalizeChatRun(r.chatId,{aborted:Boolean(e.aborted),hasError:Boolean(e.error)},n)}else if(!i&&!o){for(let[d,l]of[...this.heads.entries()])if(l.status==="running"||l.status==="streaming")this.finalizeChatRun(d,{aborted:Boolean(e.aborted),hasError:Boolean(e.error)},n)}this.render(n)}onChatChanged(e){if(this.destroyed)return;let t=e!==void 0?e:this.safeGetActiveChatId();if(t){if(this.heads.get(t)?.status==="completed")this.heads.delete(t)}this.render(t)}onChatDeleted(e){if(this.destroyed||!e)return;if(this.heads.delete(e))this.render()}destroy(){if(this.destroyed)return;this.destroyed=!0,this.clearDragSession(),this.clearResizeListener(),this.clearSuppressClickTimer(),this.suppressNextClick=!1;for(let e of this.disposers)try{e()}catch{}if(this.disposers.length=0,this.heads.clear(),this.headItemRefs.clear(),this.characterCache.clear(),this.pendingCharacterFetches.clear(),this.rootEl)this.rootEl.remove(),this.rootEl=null}getCachedCharacter(e){let t=this.characterCache.get(e);if(t!==void 0)this.characterCache.delete(e),this.characterCache.set(e,t);return t}setCachedCharacter(e,t){if(this.characterCache.has(e))this.characterCache.delete(e);else if(this.characterCache.size>=200){let n=this.characterCache.keys().next().value;if(n!==void 0)this.characterCache.delete(n)}this.characterCache.set(e,t)}upsertFromActiveRun(e,t){let n=this.heads.get(e.chatId),i=t===e.chatId?this.safeGetActiveChat():null,r=(typeof e.characterId==="string"&&e.characterId.length>0?e.characterId:void 0)??n?.characterId??(typeof i?.characterId==="string"&&i.characterId.length>0?i.characterId:void 0),s=r?this.getCachedCharacter(r):void 0,o=(typeof e.characterName==="string"&&e.characterName.trim().length>0?e.characterName.trim():void 0)??n?.characterName??s?.name,d=Ue(e.avatarUrl)??Ue(n?.avatarUrl)??Ue(s?.avatarUrl)??(r?rt(r):void 0),l=e.hasContentOutput?"streaming":"running",h={chatId:e.chatId,runId:e.runId,status:l,startedAt:e.startedAt,...r?{characterId:r}:{},...o?{characterName:o}:{},...d?{avatarUrl:d}:{},...n?.avatarFailed&&n.avatarUrl===d?{avatarFailed:!0}:{}};if(this.heads.set(e.chatId,h),r&&!o&&!this.characterCache.has(r))this.resolveCharacterMeta(r)}finalizeChatRun(e,t,n){let i=this.heads.get(e);if(t.aborted||t.hasError||n===e){this.heads.delete(e);return}if(i)this.heads.set(e,{...i,status:"completed"});else this.heads.set(e,{chatId:e,runId:`gg-completed-${e}`,status:"completed",startedAt:Date.now()})}async resolveCharacterMeta(e){if(this.destroyed||!e)return;if(this.pendingCharacterFetches.has(e)||this.characterCache.has(e))return;let t=this.ctx.characters;if(typeof t?.get!=="function")return;this.pendingCharacterFetches.add(e);try{let n=await Promise.resolve(t.get(e));if(this.destroyed)return;if(!Ve(n)){this.setCachedCharacter(e,{});return}let i=typeof n.name==="string"&&n.name.trim().length>0?n.name.trim():void 0,r=rt(e),s=Ue(n.avatarUrl)??Ue(n.avatar_url),o=s??r;this.setCachedCharacter(e,{...i?{name:i}:{},avatarUrl:o});let d=!1;for(let l of this.heads.values()){if(l.characterId!==e)continue;if(i&&!l.characterName)l.characterName=i,d=!0;if(s&&(!l.avatarUrl||l.avatarUrl===r)){if(l.avatarUrl!==s)l.avatarUrl=s,delete l.avatarFailed,d=!0}else if(o&&!l.avatarUrl)l.avatarUrl=o,d=!0}if(d)this.render()}catch{if(!this.destroyed)this.setCachedCharacter(e,{})}finally{this.pendingCharacterFetches.delete(e)}}render(e){if(this.destroyed)return;if(typeof document>"u"||!document.body)return;let t=e!==void 0?e:this.safeGetActiveChatId(),{nativeChatIds:n,nativeContainer:i}=this.heads.size>0?this.scanNativeChatHeads():{nativeChatIds:new Set,nativeContainer:null},r=[];for(let h of this.heads.values()){if(h.chatId===t)continue;if(n.has(h.chatId))continue;r.push(h)}if(r.length===0){if(this.clearDragSession(),this.clearResizeListener(),this.headItemRefs.clear(),this.rootEl)this.rootEl.remove(),this.rootEl=null;return}let s=!this.isDragging,o=this.getViewportSize(),d=s&&i?this.resolveNativeBounds(i,o.vw,o.vh):null;if(!this.rootEl)this.rootEl=document.createElement("div"),this.rootEl.className="gg-chat-heads-root",this.rootEl.setAttribute("data-gg-chat-heads-root","true"),this.attachDragHandlers(this.rootEl),this.ensureResizeListener();let l=new Set(r.map((h)=>h.chatId));for(let[h,c]of[...this.headItemRefs.entries()])if(!l.has(h))c.item.remove(),this.headItemRefs.delete(h);for(let h=0;h<r.length;h+=1){let c=r[h],g=this.headItemRefs.get(c.chatId);if(g)this.updateHeadItem(g,c);else g=this.buildHeadItem(c),this.headItemRefs.set(c.chatId,g);if(this.rootEl.children[h]!==g.item)this.rootEl.insertBefore(g.item,this.rootEl.children[h]??null)}if(this.applyRootPosition(this.rootEl,r.length,{avoidNative:s,nativeBox:d,viewport:o}),!this.rootEl.isConnected)document.body.append(this.rootEl)}buildHeadItem(e){let t=e.chatId,n=document.createElement("div");n.className="gg-chat-head-item";let i=document.createElement("button");i.type="button",i.className="gg-chat-head",i.setAttribute("data-gg-chat-head","true"),i.setAttribute("data-chat-id",t);let r=document.createElement("span");r.className="gg-chat-head-badge",r.setAttribute("aria-hidden","true"),i.append(r),i.addEventListener("contextmenu",(o)=>{if(o.preventDefault(),o.stopPropagation(),!this.isDragging&&this.heads.get(t)?.status==="completed")this.dismissCompletedHead(t)}),i.addEventListener("click",(o)=>{if(o.preventDefault(),o.stopPropagation(),this.suppressNextClick){this.suppressNextClick=!1,this.clearSuppressClickTimer();return}this.navigateToChat(t,()=>{if(this.destroyed)return;if(this.heads.get(t)?.status==="completed")this.heads.delete(t),this.render()})}),n.append(i);let s={item:n,btn:i,badge:r,img:null,initials:null,pip:null,dismissBtn:null};return this.updateHeadItem(s,e),s}updateHeadItem(e,t){let{item:n,btn:i,badge:r}=e;if(e.lastStatus!==t.status)i.classList.toggle("is-running",t.status==="running"||t.status==="streaming"),i.classList.toggle("is-streaming",t.status==="streaming"),i.classList.toggle("is-completed",t.status==="completed"),i.setAttribute("data-status",t.status);let s=t.characterName||t.chatId,o=t.status==="completed"?"Generation completed — click to open chat":t.status==="streaming"?"Streaming response in background — click to open chat":"Generating response in background — click to open chat",d=`${s}: ${o}`;if(e.lastLabel!==d)i.setAttribute("aria-label",d),i.title=d,e.lastLabel=d;let l=t.avatarUrl??(t.characterId?rt(t.characterId):void 0),h=Boolean(t.avatarFailed);if(e.lastAvatarUrl!==l||e.lastAvatarFailed!==h||e.lastDisplayName!==s||!e.img&&!e.initials){if(l&&!h){if(e.initials)e.initials.remove(),e.initials=null;if(e.img){if(e.img.getAttribute("src")!==l)e.img.src=l;e.img.alt=s}else{let c=document.createElement("img");c.className="gg-chat-head-avatar",c.src=l,c.alt=s,c.draggable=!1,c.addEventListener("error",()=>{if(this.destroyed)return;let g=this.heads.get(t.chatId);if(g)g.avatarFailed=!0;if(c.isConnected){let b=this.heads.get(t.chatId)?.characterName||t.chatId,u=document.createElement("span");u.className="gg-chat-head-initials",u.textContent=Lt(b),c.replaceWith(u);let p=this.headItemRefs.get(t.chatId);if(p&&p.img===c)p.img=null,p.initials=u,p.lastAvatarFailed=!0}}),i.insertBefore(c,r),e.img=c}}else{if(e.img)e.img.remove(),e.img=null;let c=Lt(s);if(e.initials)e.initials.textContent=c;else{let g=document.createElement("span");g.className="gg-chat-head-initials",g.textContent=c,i.insertBefore(g,r),e.initials=g}}e.lastAvatarUrl=l,e.lastAvatarFailed=h}if(t.status==="completed"){if(!e.pip){let c=document.createElement("span");c.className="gg-chat-head-pip",c.setAttribute("aria-hidden","true"),i.append(c),e.pip=c}}else if(e.pip)e.pip.remove(),e.pip=null;if(t.status==="completed")if(e.dismissBtn){if(e.lastDisplayName!==s)e.dismissBtn.setAttribute("aria-label",`Dismiss ${s}`)}else{let c=document.createElement("button");c.type="button",c.className="gg-chat-head-dismiss",c.setAttribute("data-gg-chat-head-dismiss","true"),c.setAttribute("aria-label",`Dismiss ${s}`),c.title="Dismiss",c.textContent="×",c.addEventListener("click",(g)=>{g.preventDefault(),g.stopPropagation(),this.dismissCompletedHead(t.chatId)}),n.append(c),e.dismissBtn=c}else if(e.dismissBtn)e.dismissBtn.remove(),e.dismissBtn=null;e.lastStatus=t.status,e.lastDisplayName=s}dismissCompletedHead(e){if(this.destroyed)return;if(this.heads.get(e)?.status==="completed")this.heads.delete(e),this.render()}scanNativeChatHeads(){let e=new Set,t=null;if(typeof document>"u"||!document.body)return{nativeChatIds:e,nativeContainer:t};let n=document.body.querySelectorAll("[data-head-idx][data-chat-id]:not([data-gg-chat-head]), [data-chat-head][data-chat-id]:not([data-gg-chat-head]), body > * > [data-chat-id]:not([data-gg-chat-head])"),i=new Map;for(let r of n){if(r.hasAttribute("data-gg-chat-head"))continue;if(this.rootEl?.contains(r)||r.closest("[data-gg-chat-heads-root]"))continue;let s=r.getAttribute("data-chat-id");if(!s)continue;if(r.hasAttribute("data-head-idx")||r.hasAttribute("data-chat-head")){if(e.add(s),!t){let l=r.parentElement;t=!l||l===document.body?r:l}continue}let d=r.parentElement;if(d&&d.parentElement===document.body){let l=i.get(d);if(l===void 0){let h=typeof d.className==="string"?d.className:"";l=/ChatHeads/i.test(h)||d.querySelector("[data-head-idx]")!==null,i.set(d,l)}if(l)e.add(s)}}return{nativeChatIds:e,nativeContainer:t}}findNativeChatHeadsContainer(){return this.scanNativeChatHeads().nativeContainer}getViewportSize(){let e=typeof window<"u"?window:typeof document<"u"?document.defaultView:null,t=e&&typeof e.innerWidth==="number"&&e.innerWidth>0?e.innerWidth:(typeof document<"u"?document.documentElement?.clientWidth:0)||1024,n=e&&typeof e.innerHeight==="number"&&e.innerHeight>0?e.innerHeight:(typeof document<"u"?document.documentElement?.clientHeight:0)||768;return{vw:t,vh:n}}getStackDimensions(e,t){let n=Math.max(1,e),i=60,r=n*48+Math.max(0,n-1)*10+12,s=Math.max(60,t-24);return{width:60,height:Math.min(r,s)}}clampCenterPos(e,t,n){let{vw:i,vh:r}=n??this.getViewportSize(),{width:s,height:o}=this.getStackDimensions(t,r),d=12+s/2,l=i-12-s/2,h=12+o/2,c=r-12-o/2,g=Me(e.xPct/100*i,d,l),b=Me(e.yPct/100*r,h,c);return{xPct:g/i*100,yPct:b/r*100}}resolveNativeBounds(e,t,n){try{let u=e.getBoundingClientRect?.();if(u&&u.width>0&&u.height>0)return{left:u.left,top:u.top,right:u.right,bottom:u.bottom}}catch{}let i=e.querySelectorAll("[data-head-idx], [data-chat-head]"),r=Math.max(1,i.length),s=e.style?.flexDirection==="row",o=s?r*48+Math.max(0,r-1)*8+12:60,d=s?60:r*48+Math.max(0,r-1)*8+12,l=parseFloat(e.style?.left??""),h=parseFloat(e.style?.top??"");if(Number.isFinite(l)&&Number.isFinite(h)&&l>=0&&h>=0)return{left:l,top:h,right:l+o,bottom:h+d};let c=this.readNativeStoredPosition();if(c){let u,p;if(c.xPct<0||c.yPct<0)u=t-o-12,p=Math.round((n-d)/2);else if(c.xPct<=1&&c.yPct<=1)u=Me(c.xPct*t,12,t-o-12),p=Me(c.yPct*n,12,n-d-12);else u=Me(c.xPct/100*t,12,t-o-12),p=Me(c.yPct/100*n,12,n-d-12);return{left:u,top:p,right:u+o,bottom:p+d}}let g=t-o-12,b=Math.round((n-d)/2);return{left:g,top:b,right:g+o,bottom:b+d}}readNativeStoredPosition(){try{let t=this.getStorage()?.getItem("lumiverse:chatHeadsPos");if(!t)return null;let n=JSON.parse(t);if(Ve(n)&&typeof n.xPct==="number"&&Number.isFinite(n.xPct)&&typeof n.yPct==="number"&&Number.isFinite(n.yPct))return{xPct:n.xPct,yPct:n.yPct}}catch{}return null}attachDragHandlers(e){e.addEventListener("click",()=>{if(this.suppressNextClick)this.suppressNextClick=!1,this.clearSuppressClickTimer()}),e.addEventListener("pointerdown",(t)=>{if(this.destroyed)return;if(t.pointerType==="mouse"&&t.button!==0)return;if(typeof document>"u")return;let n=t.target;if(n?.closest?.("[data-gg-chat-head-dismiss]"))return;if(this.isDragging)return;this.clearSuppressClickTimer(),this.suppressNextClick=!1,this.clearDragSession();let{pointerId:i,clientX:r,clientY:s}=t,o=this.getViewportSize(),d=this.rootEl?.children.length||this.heads.size||1,l=parseFloat(e.style.left),h=parseFloat(e.style.top),c=Number.isFinite(l)&&Number.isFinite(h)?{xPct:l,yPct:h}:this.clampCenterPos(this.pos,d,o),g=!1,b=!1,u=null,p=null,y=0,I=0,w=!1,E=()=>{if(u!==null)clearTimeout(u),u=null},S=()=>{if(p!==null){if(typeof cancelAnimationFrame==="function")cancelAnimationFrame(p);p=null}},A=()=>{if(!w||this.destroyed)return;if(w=!1,this.pos=this.clampCenterPos({xPct:c.xPct+y/o.vw*100,yPct:c.yPct+I/o.vh*100},d,o),this.rootEl)this.applyRootPosition(this.rootEl,d,{avoidNative:!1,viewport:o})},D=(k)=>{if(k.pointerId!==i)return;let G=k.clientX-r,Q=k.clientY-s;if(!g&&Math.hypot(G,Q)>6){g=!0,E(),this.isDragging=!0,this.suppressNextClick=!0,e.classList.add("is-dragging");try{e.setPointerCapture?.(i)}catch{}}if(!g)return;if(y=G,I=Q,w=!0,typeof requestAnimationFrame==="function"){if(p===null)p=requestAnimationFrame(()=>{if(p=null,b||this.destroyed)return;A()})}else A()},T=()=>{if(b)return;if(b=!0,E(),S(),g&&w)A();this.clearDragSession(),e.classList.remove("is-dragging");try{if(e.hasPointerCapture?.(i))e.releasePointerCapture?.(i)}catch{}if(g){if(this.savePosition(this.pos),this.rootEl){let k=this.rootEl.children.length||this.heads.size||1;this.applyRootPosition(this.rootEl,k)}this.clearSuppressClickTimer(),this.suppressClickTimer=setTimeout(()=>{this.suppressClickTimer=null,this.suppressNextClick=!1},350)}},C=n?.closest?.("[data-gg-chat-head]")?.getAttribute("data-chat-id")??null;if(t.pointerType==="touch"&&C&&this.heads.get(C)?.status==="completed")u=setTimeout(()=>{if(u=null,g||b||this.destroyed)return;if(this.heads.get(C)?.status!=="completed")return;this.suppressNextClick=!0,this.clearSuppressClickTimer(),this.suppressClickTimer=setTimeout(()=>{this.suppressClickTimer=null,this.suppressNextClick=!1},350),T(),this.dismissCompletedHead(C)},450);let O=(k)=>{if(k.pointerId!==i)return;T()},L=(k)=>{if(k.pointerId!==i)return;if(k.target!==e)return;T()},N=()=>{T()},j=(k)=>{if(g&&k.cancelable)k.preventDefault()},q=typeof window<"u"?window:document.defaultView;if(document.addEventListener("pointermove",D,!0),document.addEventListener("pointerup",O,!0),document.addEventListener("pointercancel",O,!0),t.pointerType==="touch")document.addEventListener("touchmove",j,{capture:!0,passive:!1});e.addEventListener("lostpointercapture",L),q?.addEventListener("blur",N),this.dragCleanup=()=>{if(E(),S(),document.removeEventListener("pointermove",D,!0),document.removeEventListener("pointerup",O,!0),document.removeEventListener("pointercancel",O,!0),t.pointerType==="touch")document.removeEventListener("touchmove",j,!0);e.removeEventListener("lostpointercapture",L),q?.removeEventListener("blur",N)}})}clearDragSession(){if(this.isDragging=!1,this.rootEl?.classList.remove("is-dragging"),this.dragCleanup){let e=this.dragCleanup;this.dragCleanup=null,e()}}clearSuppressClickTimer(){if(this.suppressClickTimer!==null)clearTimeout(this.suppressClickTimer),this.suppressClickTimer=null}ensureResizeListener(){if(this.resizeCleanup)return;let e=typeof window<"u"?window:typeof document<"u"?document.defaultView:null;if(!e)return;let t=null,n=()=>{if(this.destroyed||!this.rootEl)return;let r=this.rootEl.children.length||this.heads.size||1;this.applyRootPosition(this.rootEl,r,{avoidNative:!this.isDragging})},i=()=>{if(this.destroyed||!this.rootEl)return;if(typeof requestAnimationFrame==="function"){if(t!==null)return;t=requestAnimationFrame(()=>{t=null,n()})}else n()};e.addEventListener("resize",i),this.resizeCleanup=()=>{if(t!==null){if(typeof cancelAnimationFrame==="function")cancelAnimationFrame(t);t=null}e.removeEventListener("resize",i)}}clearResizeListener(){if(this.resizeCleanup){let e=this.resizeCleanup;this.resizeCleanup=null,e()}}applyRootPosition(e,t=this.heads.size||1,n={}){let i=n.viewport??this.getViewportSize(),{vw:r,vh:s}=i,{width:o,height:d}=this.getStackDimensions(t,s),l=this.clampCenterPos(this.pos,t,i),h=l.xPct/100*r,c=l.yPct/100*s;if(n.avoidNative!==!1){let u=n.nativeBox!==void 0?n.nativeBox:(()=>{let p=this.findNativeChatHeadsContainer();return p?this.resolveNativeBounds(p,r,s):null})();if(u){let p=12+o/2,y=r-12-o/2,I=12+d/2,w=s-12-d/2,E={left:h-o/2,top:c-d/2,right:h+o/2,bottom:c+d/2};if(hn(E,u,8)){let S=u.bottom+8+d/2,A=u.top-8-d/2,D=u.left-8-o/2,T=u.right+8+o/2;if(S>=I&&S<=w)c=S;else if(A>=I&&A<=w)c=A;else if(D>=p&&D<=y)h=D;else if(T>=p&&T<=y)h=T}}}let g=qe(h/r*100,0,100),b=qe(c/s*100,0,100);e.style.left=`${g}%`,e.style.top=`${b}%`}getStorage(){try{return typeof localStorage<"u"?localStorage:typeof window<"u"?window.localStorage:null}catch{return null}}loadPosition(){try{let e=this.getStorage()?.getItem("gg:chatHeadsPos");if(!e)return{...Pt};let t=JSON.parse(e);if(Ve(t)&&typeof t.xPct==="number"&&Number.isFinite(t.xPct)&&typeof t.yPct==="number"&&Number.isFinite(t.yPct))return{xPct:qe(t.xPct),yPct:qe(t.yPct)}}catch{}return{...Pt}}savePosition(e){try{this.getStorage()?.setItem("gg:chatHeadsPos",JSON.stringify(e))}catch{}}navigateToChat(e,t){try{let n=this.ctx.host?.surfaces;if(n&&typeof n.invoke==="function"){let i=n.invoke({kind:"route",id:"/chat/:chatId"},{chatId:e});if(cn(i)){Promise.resolve(i).then(()=>{t?.()},()=>{if(this.fallbackHistoryNavigate(e))t?.()});return}t?.();return}}catch{}if(this.fallbackHistoryNavigate(e))t?.()}fallbackHistoryNavigate(e){try{let t=typeof window<"u"?window:typeof document<"u"?document.defaultView:null;if(t?.history&&typeof t.history.pushState==="function"){t.history.pushState(null,"",`/chat/${encodeURIComponent(e)}`);let n=t.PopStateEvent??(typeof PopStateEvent<"u"?PopStateEvent:Event);return t.dispatchEvent(new n("popstate")),!0}}catch{}return!1}safeGetActiveChat(){try{return this.ctx.getActiveChat?.()??null}catch{return null}}safeGetActiveChatId(){return this.safeGetActiveChat()?.chatId??null}}var je=["guided_response","guided_continue","guided_regenerate","guided_swipe","guided_impersonate"];var kt=0,Ht=!0,Dt=[{value:"before_post_history",label:"Before Post-History (after chat history)",shortLabel:"Before Post-History",sublabel:"Places guidance right after chat history and before post-history preset blocks."},{value:"in_history",label:"In History (at depth)",shortLabel:"In History",sublabel:"Splices guidance inside chat history N messages back from the end."},{value:"pre_history",label:"Pre-History (before chat history)",shortLabel:"Pre-History",sublabel:"Places guidance after pre-history system prompts and before the first chat turn."},{value:"post_history",label:"Post-History (end of prompt)",shortLabel:"Post-History",sublabel:"Appends guidance at the very end of the assembled prompt (before any trailing prefill)."}];function ot(e,t="before_post_history"){if(e==="before_post_history"||e==="in_history"||e==="pre_history"||e==="post_history")return e;return t}function Nt(e,t=0){if(typeof e==="number"&&Number.isFinite(e))return Math.max(0,Math.min(999,Math.floor(e)));return Math.max(0,Math.min(999,Math.floor(t)))}var at=[...je,"input_recovery"],Ke=[{value:"after_native",label:"Inline (after native buttons)",shortLabel:"Inline",sublabel:"Sits directly next to Home, Regenerate, Continue, etc."},{value:"before_native",label:"Left side (before native buttons)",shortLabel:"Left",sublabel:"Placed at the start of the composer top action bar"},{value:"right",label:"Right side (top bar)",shortLabel:"Right",sublabel:"Aligned to the right side of the composer top action bar"},{value:"below_bar",label:"Separate row (below native buttons)",shortLabel:"New row",sublabel:"Shown on the dedicated extension toolbar row underneath"}];function pn(e){return typeof e==="string"&&je.includes(e)}function gn(e){return e==="input_recovery"||pn(e)}function ze(e){if(e==="after_native"||e==="before_native"||e==="right"||e==="below_bar")return e;return"after_native"}function Ye(e){let t=[],n=new Set;if(Array.isArray(e))for(let i of e){if(!gn(i)||n.has(i))continue;n.add(i),t.push(i)}for(let i of at)if(!n.has(i))n.add(i),t.push(i);return t}var _e={guided_response:{id:"guided_response",label:"Guided Response",shortLabel:"Response",description:"Steer the next AI reply using your composer text as temporary guidance without adding a user message.",tooltip:"Guided Response — steer next AI reply without sending a user message"},guided_continue:{id:"guided_continue",label:"Guided Continue",shortLabel:"Continue",description:"Continue the last AI message using optional guidance text and this option's profile & preset.",tooltip:"Guided Continue — continue last AI message (guided if input present)"},guided_regenerate:{id:"guided_regenerate",label:"Guided Regenerate",shortLabel:"Regenerate",description:"Replace the last AI message with a fresh regenerated reply using optional guidance text and this option's profile & preset.",tooltip:"Guided Regenerate — regenerate last AI reply (guided if input present)"},guided_swipe:{id:"guided_swipe",label:"Guided Swipe",shortLabel:"Swipe",description:"Generate a new swipe on the last AI message steered by your guidance text.",tooltip:"Guided Swipe — create a steered new swipe on the last AI message"},guided_impersonate:{id:"guided_impersonate",label:"Impersonation",shortLabel:"Impersonate",description:"Generate a user reply into the composer input box using your configured preset and optional outline.",tooltip:"Impersonate — draft user message into input box"}};function ue(e,t="1.85"){return`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${t}" stroke-linecap="round" stroke-linejoin="round">${e}</svg>`}var Ot=ue('<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>'),Ft=ue('<circle cx="12" cy="12" r="9"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',"1.8"),Bt='<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>',$e={guided_response:ue('<path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4Z"/>'),guided_continue:ue('<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>'),guided_regenerate:Ot,guided_swipe:ue('<path d="m9 18 6-6-6-6"/>'),guided_impersonate:ue('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),input_recovery:ue('<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>')},lt={remove_last_continue:ue('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/>'),regenerate_last_continue:Ot},dt={history:ue('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>'),clear_history:ue('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>')};function Oe(e,t=68){let n=Number.isFinite(t)?Math.max(4,Math.floor(t)):60,i=e.replace(/\s+/g," ").trim();if(i.length<=n)return i;return`${i.slice(0,n-1)}…`}function Gt(e,t){if(e.length===0)return null;if(t)return e.find((n)=>n.id===t)??e[0]??null;return e[0]??null}function Kt(e){return e[0]?.text?` ("${e[0].text.replace(/\s+/g," ").trim().slice(0,48)}")`:""}function fn(e){let t=ze(e.settings.toolbarPlacement),n=Ye(e.settings.buttonOrder),i=0;if(e.settings.actions.guided_response?.enabled)i|=1;if(e.settings.actions.guided_continue?.enabled)i|=2;if(e.settings.actions.guided_regenerate?.enabled)i|=4;if(e.settings.actions.guided_swipe?.enabled)i|=8;if(e.settings.actions.guided_impersonate?.enabled)i|=16;if(e.settings.inputRecovery.enabled)i|=32;let s=Boolean(e.settings.inputRecovery.enabled)&&e.recovery.length>0;return{placement:t,order:n,enabledMask:i,hasActiveChat:Boolean(e.hasActiveChat),hasActiveRun:Boolean(e.activeRun),isBusy:Boolean(e.isBusy||e.activeRun),activeRunId:e.activeRun?.runId??null,activeRunActionId:e.activeRun?.actionId??null,hasRecovery:s,latestRecoveryPreview:s?Kt(e.recovery):""}}function zt(e,t){if(e.placement!==t.placement||e.enabledMask!==t.enabledMask||e.hasActiveChat!==t.hasActiveChat||e.hasActiveRun!==t.hasActiveRun||e.isBusy!==t.isBusy||e.activeRunId!==t.activeRunId||e.activeRunActionId!==t.activeRunActionId||e.order.length!==t.order.length)return!1;for(let n=0;n<e.order.length;n+=1)if(e.order[n]!==t.order[n])return!1;return!0}function mn(e,t){return zt(e,t)&&e.hasRecovery===t.hasRecovery&&e.latestRecoveryPreview===t.latestRecoveryPreview}var ct=["gg-actions-host","gg-actions-host--row","is-before-native","is-right"],vn=450,bn=10,Ut=150,Vt=3000,yn=0,In=250;class ut{ctx;handlers;actionsMountRoot;toolbarMountRoot=null;toolbarEl;buttons=[];buttonPool=new Map;latestState=null;activeActionId=null;activeHoldCancel=null;suppressNextHoldClick=!1;suppressHoldClickActionId=null;suppressHoldClickUntil=0;clearSuppressHoldClickTimer=null;holdReleaseCleanup=null;postHoldCleanup=null;continueMenu=null;latestRecovery=[];lastRenderSignature=null;lastChatId=void 0;destroyed=!1;onKeyDown;onFocusIn;constructor(e,t){this.ctx=e;this.handlers=t;this.actionsMountRoot=e.ui.mount("chat_actions"),this.actionsMountRoot.classList.add("gg-actions-host"),this.toolbarEl=document.createElement("div"),this.toolbarEl.className="gg-toolbar",this.toolbarEl.setAttribute("role","toolbar"),this.toolbarEl.setAttribute("aria-label","Guided Generations actions"),this.onKeyDown=(n)=>{this.handleToolbarKeyDown(n)},this.onFocusIn=(n)=>{let i=n.target;if(!i||i.tagName!=="BUTTON"||i.disabled)return;let r=i.getAttribute("data-gg-action");if(r)this.activeActionId=r,this.applyRovingTabIndex()},this.toolbarEl.addEventListener("keydown",this.onKeyDown),this.toolbarEl.addEventListener("focusin",this.onFocusIn),this.actionsMountRoot.replaceChildren(this.toolbarEl)}render(e){if(this.destroyed)return;this.latestState=e;let t=e.chatId!==void 0&&this.lastChatId!==void 0&&e.chatId!==this.lastChatId;if(e.chatId!==void 0)this.lastChatId=e.chatId;let n=fn(e),i=n.placement==="below_bar"?this.toolbarMountRoot:this.actionsMountRoot,r=i!==null&&this.toolbarEl.parentElement===i&&this.toolbarEl.childElementCount===this.buttons.length;if(this.lastRenderSignature!==null&&r&&mn(this.lastRenderSignature,n)){if(this.latestRecovery=e.recovery,t)this.closeContinueMenu({restoreFocus:!1}),this.clearActiveHold();else if(this.continueMenu?.kind==="recovery")this.continueMenu.refreshRecovery?.();return}let s=!t&&this.continueMenu?.kind==="recovery"&&this.lastRenderSignature!==null&&r&&zt(this.lastRenderSignature,n);if(!s)this.closeContinueMenu({restoreFocus:!1}),this.clearActiveHold();this.latestRecovery=e.recovery;let o=[];for(let u of n.order)if(u==="input_recovery"?Boolean(e.settings.inputRecovery.enabled):Boolean(e.settings.actions[u]?.enabled))o.push(u);if(this.buttons.length===o.length&&this.toolbarEl.childElementCount===o.length&&this.buttons.every((u,p)=>u.getAttribute("data-gg-action")===o[p])){for(let u of o){let p=this.buttonPool.get(u);if(p)this.syncOptionButton(p,u,e)}if(this.applyRovingTabIndex(),this.applyPlacement(n.placement,o.length>0),this.lastRenderSignature=n,s)this.continueMenu?.refreshRecovery?.();return}if(s)this.closeContinueMenu({restoreFocus:!1}),this.clearActiveHold();let l=typeof document<"u"?document.activeElement:null,h=l&&this.toolbarEl.contains(l)?l.getAttribute?.("data-gg-action"):null,c=[];for(let u of o){let p=this.getOrCreateOptionButton(u);this.syncOptionButton(p,u,e),c.push(p.btn)}this.buttons=c,this.toolbarEl.replaceChildren(...c);let g=h?this.buttons.find((u)=>!u.disabled&&u.getAttribute("data-gg-action")===h):void 0;if(g&&h)this.activeActionId=h;this.applyRovingTabIndex();let b=c.length>0;if(this.applyPlacement(n.placement,b),this.lastRenderSignature=n,g)g.focus()}applyRovingTabIndex(){let e=this.buttons.filter((n)=>!n.disabled);if(e.length===0){for(let n of this.buttons)n.tabIndex=-1;return}let t=(this.activeActionId?e.find((n)=>n.getAttribute("data-gg-action")===this.activeActionId):void 0)??e[0];this.activeActionId=t.getAttribute("data-gg-action")??null;for(let n of this.buttons)n.tabIndex=n===t?0:-1}handleToolbarKeyDown(e){if(e.altKey||e.ctrlKey||e.metaKey)return;let t=e.key;if(t!=="ArrowRight"&&t!=="ArrowLeft"&&t!=="ArrowDown"&&t!=="ArrowUp"&&t!=="Home"&&t!=="End")return;let n=this.buttons.filter((d)=>!d.disabled);if(n.length===0)return;let i=typeof document<"u"?document.activeElement:null,r=n.findIndex((d)=>d===i);if(r===-1)r=n.findIndex((d)=>d.tabIndex===0);if(r===-1)r=0;let s=r;if(t==="ArrowRight"||t==="ArrowDown")s=(r+1)%n.length;else if(t==="ArrowLeft"||t==="ArrowUp")s=(r-1+n.length)%n.length;else if(t==="Home")s=0;else if(t==="End")s=n.length-1;let o=n[s];e.preventDefault(),this.activeActionId=o.getAttribute("data-gg-action")??null,this.applyRovingTabIndex(),o.focus()}getOrCreateOptionButton(e){let t=this.buttonPool.get(e);if(t)return t;let n=document.createElement("button");n.type="button",n.className="gg-btn",n.setAttribute("data-gg-action",e);let i={btn:n,iconKey:""};if(e==="input_recovery")i.iconKey="input_recovery",n.innerHTML=$e.input_recovery,this.attachRecoveryHoldHandlers(n);else if(e==="guided_swipe")this.attachSwipeHoldHandlers(n);else if(e==="guided_continue")this.attachContinueHoldHandlers(n);else n.addEventListener("click",(r)=>{r.preventDefault(),r.stopPropagation();let s=this.latestState?.activeRun;if(s?.actionId===e)this.handlers.onAbortAction(s.runId);else this.handlers.onTriggerAction(e)});return this.buttonPool.set(e,i),i}syncOptionButton(e,t,n){if(t==="input_recovery"){this.syncRecoveryButton(e,n);return}this.syncActionButton(e,t,n)}syncActionButton(e,t,n){let{btn:i}=e,r=_e[t],s=n.activeRun?.actionId===t,o=Boolean(n.activeRun)&&!s,d=Boolean(n.isBusy)&&!n.activeRun,l=!n.hasActiveChat||o||d;if(i.classList.toggle("is-running",s),i.classList.toggle("is-dimmed",l),i.disabled=l,i.setAttribute("aria-label",s?`Stop ${r.label}`:r.label),t==="guided_swipe"&&!s)i.setAttribute("aria-keyshortcuts","Control+Enter Meta+Enter"),i.removeAttribute("aria-haspopup"),i.removeAttribute("aria-expanded"),i.title="Guided Swipe — click to swipe, hold (or Ctrl+Click) to swipe in background";else if(t==="guided_continue"&&!s)i.setAttribute("aria-haspopup","menu"),i.setAttribute("aria-expanded","false"),i.setAttribute("aria-keyshortcuts","Shift+F10 Alt+ArrowUp Control+Enter Meta+Enter"),i.title="Guided Continue — click to continue, hold for continue options";else i.removeAttribute("aria-keyshortcuts"),i.removeAttribute("aria-haspopup"),i.removeAttribute("aria-expanded"),i.title=s?`Stop ${r.label}`:r.tooltip;let h=s?"stop":t;if(e.iconKey!==h)e.iconKey=h,i.innerHTML=s?Bt:$e[t]}clearActiveHold(){if(this.activeHoldCancel){let e=this.activeHoldCancel;this.activeHoldCancel=null,e()}}clearPostHoldClickSuppression(){if(this.suppressNextHoldClick=!1,this.suppressHoldClickActionId=null,this.suppressHoldClickUntil=0,this.clearSuppressHoldClickTimer!==null)clearTimeout(this.clearSuppressHoldClickTimer),this.clearSuppressHoldClickTimer=null;if(this.holdReleaseCleanup){let e=this.holdReleaseCleanup;this.holdReleaseCleanup=null,e()}if(this.postHoldCleanup){let e=this.postHoldCleanup;this.postHoldCleanup=null,e()}}isHoldClickSuppressed(e){if(!this.suppressNextHoldClick)return!1;if(this.suppressHoldClickUntil>0&&Date.now()>this.suppressHoldClickUntil)return this.clearPostHoldClickSuppression(),!1;if(e&&this.suppressHoldClickActionId!==null){if(e.getAttribute("data-gg-action")!==this.suppressHoldClickActionId)return!1}return!0}armPostHoldClickSuppression(e,t){if(this.clearPostHoldClickSuppression(),this.suppressNextHoldClick=!0,this.suppressHoldClickActionId=e.getAttribute("data-gg-action"),this.suppressHoldClickUntil=Date.now()+Vt,this.postHoldCleanup=t??null,typeof document>"u")return;let n=typeof window<"u"?window:document.defaultView,i=()=>{if(document.removeEventListener("pointerup",o,!0),document.removeEventListener("pointercancel",o,!0),document.removeEventListener("visibilitychange",s),n?.removeEventListener("blur",r),this.holdReleaseCleanup===i)this.holdReleaseCleanup=null},r=()=>{this.clearPostHoldClickSuppression()},s=()=>{if(document.visibilityState==="hidden")this.clearPostHoldClickSuppression()},o=(d)=>{if(i(),this.clearSuppressHoldClickTimer!==null)clearTimeout(this.clearSuppressHoldClickTimer);let l=d.type==="pointercancel"||d.pointerType==="mouse"?yn:In;this.suppressHoldClickUntil=Date.now()+l,this.clearSuppressHoldClickTimer=setTimeout(()=>{this.clearSuppressHoldClickTimer=null,this.clearPostHoldClickSuppression()},l)};this.holdReleaseCleanup=i,document.addEventListener("pointerup",o,!0),document.addEventListener("pointercancel",o,!0),document.addEventListener("visibilitychange",s),n?.addEventListener("blur",r),this.clearSuppressHoldClickTimer=setTimeout(()=>{this.clearSuppressHoldClickTimer=null,this.clearPostHoldClickSuppression()},Vt)}attachLongPressHandlers(e,t,n){let i={timer:void 0,x:0,y:0,fired:!1},r=typeof document<"u"?document:null,s=typeof window<"u"?window:r?.defaultView??null,o=!1,d=()=>{if(!o)return;o=!1,s?.removeEventListener("blur",h),r?.removeEventListener("visibilitychange",h)},l=()=>{if(o)return;o=!0,s?.addEventListener("blur",h),r?.addEventListener("visibilitychange",h)},h=()=>{if(d(),i.timer!==void 0)clearTimeout(i.timer),i.timer=void 0;if(e.classList.remove("is-holding"),this.activeHoldCancel===h)this.activeHoldCancel=null};e.addEventListener("pointerdown",(c)=>{if(e.disabled||this.latestState?.activeRun||this.latestState?.isBusy)return;if(!c.isPrimary)return;if(c.pointerType==="mouse"&&c.button!==0)return;this.clearActiveHold(),this.clearPostHoldClickSuppression(),h(),i.fired=!1,i.x=c.clientX,i.y=c.clientY,e.classList.add("is-holding"),this.activeHoldCancel=h,l(),i.timer=setTimeout(()=>{if(i.timer=void 0,d(),e.classList.remove("is-holding"),this.activeHoldCancel===h)this.activeHoldCancel=null;i.fired=!0,this.armPostHoldClickSuppression(e,()=>{i.fired=!1}),n.onHold()},vn)}),e.addEventListener("pointermove",(c)=>{if(i.timer===void 0)return;let g=c.clientX-i.x,b=c.clientY-i.y;if(Math.hypot(g,b)>bn)h()}),e.addEventListener("pointerup",h),e.addEventListener("pointercancel",h),e.addEventListener("pointerleave",(c)=>{if(c.pointerType==="touch")return;h()}),e.addEventListener("contextmenu",(c)=>{if(i.timer!==void 0||i.fired||this.isHoldClickSuppressed(e))c.preventDefault(),c.stopPropagation()}),e.addEventListener("click",(c)=>{if(i.fired||this.isHoldClickSuppressed(e)){i.fired=!1,this.clearPostHoldClickSuppression(),c.preventDefault(),c.stopPropagation();return}c.preventDefault(),c.stopPropagation();let g=this.latestState?.activeRun;if(t!=="input_recovery"&&g?.actionId===t)this.handlers.onAbortAction(g.runId);else n.onClick(c)}),e.addEventListener("keydown",(c)=>{if(e.disabled||this.latestState?.activeRun||this.latestState?.isBusy)return;if(n.onShortcutKeyDown(c))c.preventDefault(),c.stopPropagation()})}attachSwipeHoldHandlers(e){this.attachLongPressHandlers(e,"guided_swipe",{onClick:(t)=>{this.handlers.onTriggerAction("guided_swipe",{backgroundSwipe:Boolean(t.ctrlKey||t.metaKey)})},onHold:()=>{this.handlers.onTriggerAction("guided_swipe",{backgroundSwipe:!0})},onShortcutKeyDown:(t)=>{if((t.ctrlKey||t.metaKey)&&(t.key==="Enter"||t.key===" "))return this.handlers.onTriggerAction("guided_swipe",{backgroundSwipe:!0}),!0;return!1}})}attachContinueHoldHandlers(e){this.attachLongPressHandlers(e,"guided_continue",{onClick:(t)=>{if(this.continueMenu!==null&&this.continueMenu.anchorBtn===e){this.closeContinueMenu({restoreFocus:!0});return}if(this.closeContinueMenu({restoreFocus:!1}),t.ctrlKey||t.metaKey){this.openContinueMenu(e);return}this.handlers.onTriggerAction("guided_continue")},onHold:()=>{this.openContinueMenu(e)},onShortcutKeyDown:(t)=>{if(t.shiftKey&&t.key==="F10"||t.altKey&&t.key==="ArrowUp"||(t.ctrlKey||t.metaKey)&&t.key==="Enter")return this.openContinueMenu(e),!0;return!1}})}openContinueMenu(e){if(this.destroyed||typeof document>"u"||!document.body)return;this.closeContinueMenu({restoreFocus:!1});let t=document.createElement("div");t.className="gg-dropup-menu",t.setAttribute("role","menu"),t.setAttribute("aria-label","Guided Continue options");let n=[{id:"remove_last_continue",label:"Remove the last continue",icon:lt.remove_last_continue,onSelect:()=>this.handlers.onRemoveLastContinue()},{id:"regenerate_last_continue",label:"Regenerate last continue",icon:lt.regenerate_last_continue,onSelect:()=>this.handlers.onRegenerateLastContinue()}],i=[];for(let o of n){let d=document.createElement("button");d.type="button",d.className="gg-dropup-item",d.setAttribute("role","menuitem"),d.setAttribute("data-gg-menu-action",o.id),d.tabIndex=-1,d.innerHTML=`${o.icon}<span>${o.label}</span>`,d.addEventListener("click",(l)=>{l.preventDefault(),l.stopPropagation(),this.closeContinueMenu({restoreFocus:!1}),o.onSelect()}),i.push(d),t.append(d)}document.body.append(t),e.setAttribute("aria-expanded","true");let r=this.positionContinueMenu(t,e),s=this.attachDropupMenuLifecycle({menuEl:t,anchorBtn:e,items:i,initialAnchorRect:r});this.continueMenu={kind:"continue",menuEl:t,anchorBtn:e,items:i,cleanup:s},i[0]?.focus()}attachDropupMenuLifecycle(e){let{menuEl:t,anchorBtn:n,items:i,initialAnchorRect:r,onBackKey:s}=e,o=Date.now(),d=(x)=>{let C=i.filter((L)=>!L.disabled),O=C.indexOf(document.activeElement);if(x.key==="ArrowDown"){if(x.preventDefault(),x.stopPropagation(),C.length===0)return;let L=O===-1?0:(O+1)%C.length;C[L]?.focus()}else if(x.key==="ArrowUp"){if(x.preventDefault(),x.stopPropagation(),C.length===0)return;let L=O<=0?C.length-1:O-1;C[L]?.focus()}else if(x.key==="Home")x.preventDefault(),x.stopPropagation(),C[0]?.focus();else if(x.key==="End")x.preventDefault(),x.stopPropagation(),C[C.length-1]?.focus();else if(s&&(x.key==="ArrowLeft"||x.key==="Backspace")&&s())x.preventDefault(),x.stopPropagation();else if(x.key==="Escape"||x.key==="Tab")x.preventDefault(),x.stopPropagation(),this.closeContinueMenu({restoreFocus:!0})},l=(x)=>{if(x.key==="Escape")x.preventDefault(),x.stopPropagation(),this.closeContinueMenu({restoreFocus:!0})},h=(x)=>{if(Date.now()-o<Ut)return;let C=x.target;if(C&&(t.contains(C)||C===n||n.contains(C)))return;this.closeContinueMenu({restoreFocus:!1})},c=(x)=>{if(this.isHoldClickSuppressed(n))return;if(Date.now()-o<Ut)return;let C=x.target;if(C&&(t.contains(C)||C===n||n.contains(C)))return;this.closeContinueMenu({restoreFocus:!1})},g=typeof window<"u"?window:document.defaultView,b=g?.visualViewport??null,u=g?.innerWidth,p=g?.innerHeight,y=r,I=null,w=()=>{if(!n.isConnected)return!0;let x=n.getBoundingClientRect();return Math.abs(x.left-y.left)>0.5||Math.abs(x.top-y.top)>0.5||Math.abs(x.right-y.right)>0.5||Math.abs(x.bottom-y.bottom)>0.5},E=()=>{if(typeof requestAnimationFrame==="function"){if(I!==null)return;I=requestAnimationFrame(()=>{if(I=null,this.destroyed||!n.isConnected||n.disabled||!t.isConnected)return;y=this.positionContinueMenu(t,n)})}else y=this.positionContinueMenu(t,n)},S=(x)=>{if(!n.isConnected||n.disabled||!t.isConnected){this.closeContinueMenu({restoreFocus:!1});return}let C=g?.innerWidth,O=g?.innerHeight,L=C!==u||O!==p;if(u=C,p=O,!x&&!b&&!L){this.closeContinueMenu({restoreFocus:!1});return}E()},A=()=>{S(!1)},D=()=>{S(!0)},T=(x)=>{let C=x.target;if(C&&typeof C.nodeType==="number"&&t.contains(C))return;let O=C===null||C===document||C===g||C===document.documentElement||C===document.body,L=C!==null&&typeof C.contains==="function"&&C.contains(n);if(!O&&!L&&!w())return;this.closeContinueMenu({restoreFocus:!1})};return t.addEventListener("keydown",d),document.addEventListener("keydown",l,!0),document.addEventListener("pointerdown",h,!0),document.addEventListener("click",c,!0),document.addEventListener("scroll",T,{capture:!0,passive:!0}),g?.addEventListener("resize",A),b?.addEventListener("resize",D),()=>{if(I!==null){if(typeof cancelAnimationFrame==="function")cancelAnimationFrame(I);I=null}t.removeEventListener("keydown",d),document.removeEventListener("keydown",l,!0),document.removeEventListener("pointerdown",h,!0),document.removeEventListener("click",c,!0),document.removeEventListener("scroll",T,{capture:!0}),g?.removeEventListener("resize",A),b?.removeEventListener("resize",D),t.remove()}}positionContinueMenu(e,t){let n=e.querySelector(".gg-dropup-history-list"),i=n?e.querySelector(".gg-dropup-header"):null;if(e.style.maxHeight)e.style.maxHeight="";if(e.style.overflowY)e.style.overflowY="";if(n&&n.style.maxHeight)n.style.maxHeight="";let r=t.getBoundingClientRect(),s=typeof window<"u"?window:document.defaultView,o=typeof getComputedStyle==="function"?getComputedStyle:s?.getComputedStyle?.bind(s),d=o&&document.body?o(document.body):null,l=d?parseFloat(d.zoom):NaN,h=d&&typeof d.getPropertyValue==="function"?parseFloat(d.getPropertyValue("scale")):NaN,c=d&&typeof d.getPropertyValue==="function"?parseFloat(d.getPropertyValue("--lumiverse-ui-scale")):NaN,g=Number.isFinite(l)&&l>0&&l!==1?l:Number.isFinite(h)&&h>0&&h!==1?h:Number.isFinite(c)&&c>0&&c!==1?c:1,b=s&&typeof s.innerWidth==="number"?s.innerWidth:document.documentElement?.clientWidth||1024,u=s&&typeof s.innerHeight==="number"?s.innerHeight:document.documentElement?.clientHeight||768,p=s?.visualViewport,y=p&&typeof p.width==="number"&&Number.isFinite(p.width)&&p.width>0&&p.width<b?p.width:b,I=p&&typeof p.height==="number"&&Number.isFinite(p.height)&&p.height>0&&p.height<u?p.height:u,{offsetWidth:w,offsetHeight:E}=e,S=n?n.offsetHeight:0,A=i?i.offsetHeight:0,D=w*g,T=E*g,x=6,C=8,O=Math.max(C,y-D-C),L=Math.max(C,Math.min(r.left,O)),N=r.top,j=I-r.bottom,q=T+x*g+C,k=N<q&&j>N,G="",Q="",se;if(k){let ie=Math.max(C/g,r.bottom/g+x);G=`${ie}px`,se=Math.max(0,I-ie*g-C)}else Q=`${(I-r.top)/g+x}px`,se=Math.max(0,N-x*g-C);let le=Math.max(0,Math.floor(se/g)),ne=null;if(n){let ie=S>0&&E>=S?E-S:(A||32)+12;ne=Math.min(220,Math.max(0,le-ie))}if(e.style.left=`${L/g}px`,e.style.top=G,e.style.bottom=Q,e.style.maxHeight=`${le}px`,e.style.overflowY="auto",n&&ne!==null)n.style.maxHeight=`${ne}px`;return r}closeContinueMenu(e){let t=this.continueMenu;if(!t)return;if(this.continueMenu=null,t.anchorBtn.setAttribute("aria-expanded","false"),t.cleanup(),e.restoreFocus&&t.anchorBtn.isConnected&&!t.anchorBtn.disabled)t.anchorBtn.focus()}syncRecoveryButton(e,t){let{btn:n}=e,i=t.recovery.length>0,r=Boolean(t.activeRun||t.isBusy),s=Kt(t.recovery),o=this.continueMenu?.kind==="recovery"&&this.continueMenu.anchorBtn===n;if(n.classList.toggle("is-dimmed",r),n.disabled=r,n.setAttribute("aria-label",i?"Restore last input":"Clear current input"),!r)n.setAttribute("aria-haspopup","menu"),n.setAttribute("aria-expanded",o?"true":"false"),n.setAttribute("aria-keyshortcuts","Shift+F10 Alt+ArrowUp Control+Enter Meta+Enter");else n.removeAttribute("aria-haspopup"),n.removeAttribute("aria-expanded"),n.removeAttribute("aria-keyshortcuts");n.title=i?`Restore last cleared input${s}`:"Input Recovery — clear current input"}attachRecoveryHoldHandlers(e){this.attachLongPressHandlers(e,"input_recovery",{onClick:(t)=>{if(this.continueMenu!==null&&this.continueMenu.anchorBtn===e){this.closeContinueMenu({restoreFocus:!0});return}if(this.closeContinueMenu({restoreFocus:!1}),t.ctrlKey||t.metaKey){this.openRecoveryMenu(e);return}this.handlers.onRestoreLatest()},onHold:()=>{this.openRecoveryMenu(e)},onShortcutKeyDown:(t)=>{if(t.shiftKey&&t.key==="F10"||t.altKey&&t.key==="ArrowUp"||(t.ctrlKey||t.metaKey)&&t.key==="Enter")return this.openRecoveryMenu(e),!0;return!1}})}openRecoveryMenu(e){if(this.destroyed||typeof document>"u"||!document.body)return;this.closeContinueMenu({restoreFocus:!1});let t=document.createElement("div");t.className="gg-dropup-menu",t.setAttribute("role","menu"),t.setAttribute("aria-label","Input Recovery options");let n=[],i=!1,r=()=>this.latestRecovery.map((b)=>({id:b.id,text:b.text,actionId:b.actionId})),s=r(),o=()=>{if(s.length!==this.latestRecovery.length)return!0;for(let b=0;b<s.length;b+=1){let u=s[b],p=this.latestRecovery[b];if(u.id!==p.id||u.text!==p.text||u.actionId!==p.actionId)return!0}return!1},d=(b=!0)=>{i=!1,s=r(),n.length=0,t.replaceChildren(),t.setAttribute("aria-label","Input Recovery options");let u=this.latestRecovery.length===0,p=[{id:"history",label:"History",icon:dt.history,disabled:!1,onSelect:()=>{l()}},{id:"clear_history",label:"Clear History",icon:dt.clear_history,disabled:u,onSelect:()=>{if(this.latestRecovery.length===0)return;this.closeContinueMenu({restoreFocus:!1}),this.handlers.onClearRecovery?.()}}];for(let y of p){let I=document.createElement("button");if(I.type="button",I.className="gg-dropup-item",I.setAttribute("role","menuitem"),I.setAttribute("data-gg-menu-action",y.id),I.tabIndex=-1,y.disabled)I.disabled=!0,I.setAttribute("aria-disabled","true"),I.style.opacity="0.45",I.style.cursor="not-allowed";I.innerHTML=`${y.icon}<span>${y.label}</span>`,I.addEventListener("click",(w)=>{if(w.preventDefault(),w.stopPropagation(),y.disabled)return;y.onSelect()}),n.push(I),t.append(I)}if(t.isConnected){if(this.positionContinueMenu(t,e),b)n[0]?.focus()}},l=(b=!0)=>{i=!0,s=r(),n.length=0,t.replaceChildren(),t.setAttribute("aria-label","Input Recovery History");let u=document.createElement("div");u.className="gg-dropup-header",u.style.flexShrink="0";let p=document.createElement("button");p.type="button",p.className="gg-dropup-back",p.setAttribute("data-gg-menu-action","back"),p.setAttribute("aria-label","Back to Input Recovery options"),p.setAttribute("aria-keyshortcuts","ArrowLeft Backspace"),p.tabIndex=-1,p.textContent="← Back",p.addEventListener("click",(w)=>{w.preventDefault(),w.stopPropagation(),d()});let y=document.createElement("span");y.className="gg-dropup-title",y.textContent=`History (${this.latestRecovery.length})`,u.append(p,y),t.append(u),n.push(p);let I=document.createElement("div");if(I.className="gg-dropup-history-list",I.style.minHeight="0",this.latestRecovery.length===0){let w=document.createElement("div");w.className="gg-dropup-empty",w.setAttribute("role","status"),w.textContent="No saved inputs yet.",I.append(w),t.append(I)}else{for(let w of this.latestRecovery){let E=_e[w.actionId]?.label??w.actionId,S=Oe(w.text,56),A=document.createElement("button");A.type="button",A.className="gg-dropup-item gg-dropup-history-item",A.setAttribute("role","menuitem"),A.setAttribute("data-gg-menu-action","restore_recovery_entry"),A.setAttribute("data-gg-recovery-id",w.id),A.setAttribute("aria-label",`Restore ${E} draft: ${Oe(w.text,40)}`),A.title=w.text,A.tabIndex=-1;let D=document.createElement("span");D.className="gg-dropup-history-tag",D.textContent=E;let T=document.createElement("span");T.className="gg-dropup-history-snippet",T.textContent=S,A.append(D,T),A.addEventListener("click",(x)=>{if(x.preventDefault(),x.stopPropagation(),this.closeContinueMenu({restoreFocus:!1}),this.handlers.onRestoreEntry)this.handlers.onRestoreEntry(w);else this.handlers.onRestoreLatest()}),n.push(A),I.append(A)}t.append(I)}if(t.isConnected){if(this.positionContinueMenu(t,e),b)(this.latestRecovery.length>0?n[1]??n[0]:n[0])?.focus()}},h=()=>{if(!o())return;let b=typeof document<"u"?document.activeElement:null,u=Boolean(b&&t.contains(b)),p=u?b.getAttribute?.("data-gg-recovery-id"):null,y=u?b.getAttribute?.("data-gg-menu-action"):null;if(i)l(!1);else d(!1);if(u)((p?n.find((w)=>!w.disabled&&w.getAttribute("data-gg-recovery-id")===p):void 0)??(y?n.find((w)=>!w.disabled&&w.getAttribute("data-gg-menu-action")===y):void 0)??n.find((w)=>!w.disabled))?.focus()};d(),document.body.append(t),e.setAttribute("aria-expanded","true");let c=this.positionContinueMenu(t,e),g=this.attachDropupMenuLifecycle({menuEl:t,anchorBtn:e,items:n,initialAnchorRect:c,onBackKey:()=>{if(!i)return!1;return d(),!0}});this.continueMenu={kind:"recovery",menuEl:t,anchorBtn:e,items:n,cleanup:g,refreshRecovery:h},n[0]?.focus()}applyPlacement(e,t){if(this.toolbarEl.style.display=t?"inline-flex":"none",e==="below_bar"){if(!this.toolbarMountRoot)this.toolbarMountRoot=this.ctx.ui.mount("chat_toolbar");if(this.resetHostElement(this.actionsMountRoot,!0),this.toolbarMountRoot.classList.remove(...ct),this.toolbarMountRoot.classList.add("gg-actions-host--row"),this.toolbarMountRoot.style.display=t?"flex":"none",this.toolbarEl.parentElement!==this.toolbarMountRoot)this.toolbarMountRoot.replaceChildren(this.toolbarEl);return}if(this.toolbarMountRoot)this.resetHostElement(this.toolbarMountRoot,!0);if(this.actionsMountRoot.classList.remove(...ct),this.actionsMountRoot.classList.add("gg-actions-host"),e==="before_native")this.actionsMountRoot.classList.add("is-before-native");else if(e==="right")this.actionsMountRoot.classList.add("is-right");if(this.actionsMountRoot.style.display=t?"inline-flex":"none",this.toolbarEl.parentElement!==this.actionsMountRoot)this.actionsMountRoot.replaceChildren(this.toolbarEl)}resetHostElement(e,t){if(e.classList.remove(...ct),e.style.display="none",t)e.replaceChildren()}destroy(){if(this.destroyed)return;if(this.destroyed=!0,this.closeContinueMenu({restoreFocus:!1}),this.clearActiveHold(),this.clearPostHoldClickSuppression(),this.toolbarEl.removeEventListener("keydown",this.onKeyDown),this.toolbarEl.removeEventListener("focusin",this.onFocusIn),this.buttons=[],this.buttonPool.clear(),this.latestState=null,this.activeActionId=null,this.lastRenderSignature=null,this.lastChatId=void 0,this.toolbarEl.replaceChildren(),this.resetHostElement(this.actionsMountRoot,!0),this.toolbarMountRoot)this.resetHostElement(this.toolbarMountRoot,!0)}}var $t=[0,50,150];function te(e){return Boolean(e)&&typeof e==="object"&&!Array.isArray(e)}function En(e){if(!te(e)||typeof e.id!=="string")return null;let t={id:e.id};if(typeof e.chat_id==="string")t.chat_id=e.chat_id;if(typeof e.swipe_id==="number")t.swipe_id=e.swipe_id;if(te(e.extra))t.extra=e.extra;return t}function Cn(e,t,n){return Boolean(e&&e.id===n&&(typeof e.chat_id!=="string"||e.chat_id===t)&&typeof e.swipe_id==="number"&&te(e.extra)&&Object.keys(e.extra).length>0)}function Wt(e){let t=Array.isArray(e)?e:te(e)&&Array.isArray(e.data)?e.data:te(e)&&Array.isArray(e.items)?e.items:[],n=[];for(let i of t)if(te(i)&&typeof i.id==="string")n.push(i);return n}function Xt(e,t,n){if(t>=n)return!0;if(te(e)&&typeof e.total==="number"&&e.total>t)return!0;return!1}function wn(e){let n=(e instanceof Error?e.message:typeof e==="string"?e:"").toUpperCase();return n.includes("PERMISSION_DENIED")||n.includes("SPINDLE_FRONTEND_INACTIVE")||n.includes("STALE_GENERATION")||n.includes("NOT FOUND")||n.includes("404")||n.includes("403")||n.includes("401")}class ht{ctx;pending=new Map;scheduledKeys=new Set;inFlightByMessage=new Map;inFlightTailReads=new Map;retryTimers=new Map;nextRevision=0;destroyed=!1;constructor(e){this.ctx=e}makeKey(e,t,n){return`${e}:${t}:${n}`}setPendingEntry(e,t){if(this.pending.has(e))this.pending.delete(e);else if(this.pending.size>=100){let n=this.pending.keys().next().value;if(n!==void 0)this.pending.delete(n),this.scheduledKeys.delete(n),this.clearRetryTimer(n)}this.pending.set(e,t)}handleMetricsEvent(e){if(this.destroyed)return;if(typeof e.chatId!=="string"||!e.chatId||typeof e.messageId!=="string"||!e.messageId||typeof e.swipeId!=="number"||!Number.isInteger(e.swipeId)||e.swipeId<0)return;if(e.tokenCount===void 0&&e.generationMetrics===void 0)return;let t=this.makeKey(e.chatId,e.messageId,e.swipeId),n=this.pending.get(t),i={key:t,chatId:e.chatId,messageId:e.messageId,swipeId:e.swipeId,tokenCount:e.tokenCount!==void 0?e.tokenCount:n?.tokenCount,generationMetrics:e.generationMetrics!==void 0?e.generationMetrics:n?.generationMetrics,lastKnownSwipeId:n?.lastKnownSwipeId,pendingFallback:n?.pendingFallback??null,revision:++this.nextRevision,attempts:0};this.setPendingEntry(t,i),this.clearRetryTimer(t),this.enqueueFlush(t)}onMessageEvent(e){if(this.destroyed||this.pending.size===0)return;let t=te(e)?e:null,n=t&&te(t.message)?t.message:null,i=typeof n?.id==="string"?n.id:typeof t?.messageId==="string"?t.messageId:null;if(!i)return;let r=typeof t?.chatId==="string"?t.chatId:typeof n?.chat_id==="string"?n.chat_id:null,s=typeof t?.action==="string"?t.action:null,o=s==="deleted"&&typeof t?.swipeId==="number"?t.swipeId:null,d=typeof n?.swipe_id==="number"?n.swipe_id:s!=="deleted"&&typeof t?.swipeId==="number"?t.swipeId:void 0,l=En(n);if(o!==null){let h=[];for(let[c,g]of[...this.pending.entries()]){if(g.messageId!==i)continue;if(r&&g.chatId!==r)continue;if(g.swipeId===o)this.pending.delete(c),this.scheduledKeys.delete(c),this.clearRetryTimer(c);else if(g.swipeId>o){this.pending.delete(c),this.scheduledKeys.delete(c),this.clearRetryTimer(c);let b=g.swipeId-1;h.push({...g,swipeId:b,lastKnownSwipeId:void 0,pendingFallback:null,key:this.makeKey(g.chatId,g.messageId,b),revision:++this.nextRevision})}}for(let c of h){let g=this.pending.get(c.key);if(!g||c.revision>g.revision)this.scheduledKeys.delete(c.key),this.clearRetryTimer(c.key),this.setPendingEntry(c.key,c)}}for(let[h,c]of[...this.pending.entries()]){if(c.messageId!==i)continue;if(r&&c.chatId!==r)continue;if(d!==void 0&&d!==c.swipeId){c.lastKnownSwipeId=d,c.pendingFallback=null;continue}if(d===c.swipeId)c.lastKnownSwipeId=d;c.attempts=0,this.enqueueFlush(h,l)}}onChatChanged(e){if(this.destroyed||this.pending.size===0)return;let t=typeof e==="string"&&e.length>0?e:this.safeGetActiveChatId();if(!t)return;for(let[n,i]of[...this.pending.entries()]){if(i.chatId!==t)continue;if(i.lastKnownSwipeId!==void 0&&i.lastKnownSwipeId!==i.swipeId)continue;i.attempts=0,this.enqueueFlush(n)}}onChatDeleted(e){if(this.destroyed||!e||this.pending.size===0)return;for(let[t,n]of[...this.pending.entries()]){if(n.chatId!==e)continue;this.pending.delete(t),this.scheduledKeys.delete(t),this.clearRetryTimer(t)}}onMessageDeleted(e){if(this.destroyed||this.pending.size===0)return;let t=te(e)?e:null,n=t&&te(t.message)?t.message:null,i=typeof n?.id==="string"?n.id:typeof t?.messageId==="string"?t.messageId:typeof t?.id==="string"?t.id:null;if(!i)return;let r=typeof t?.chatId==="string"?t.chatId:typeof t?.chat_id==="string"?t.chat_id:typeof n?.chat_id==="string"?n.chat_id:null;for(let[s,o]of[...this.pending.entries()]){if(o.messageId!==i)continue;if(r&&o.chatId!==r)continue;this.pending.delete(s),this.scheduledKeys.delete(s),this.clearRetryTimer(s)}}destroy(){if(this.destroyed)return;this.destroyed=!0,this.pending.clear(),this.scheduledKeys.clear(),this.inFlightByMessage.clear(),this.inFlightTailReads.clear();for(let e of this.retryTimers.values())clearTimeout(e);this.retryTimers.clear()}enqueueFlush(e,t=null){if(this.destroyed)return;let n=this.pending.get(e);if(!n)return;if(t!==null)n.pendingFallback=t;if(this.scheduledKeys.has(e))return;this.scheduledKeys.add(e);let i=`${n.chatId}:${n.messageId}`,s=(this.inFlightByMessage.get(i)??Promise.resolve()).catch(()=>{return}).then(async()=>{if(this.scheduledKeys.delete(e),this.destroyed)return;await this.flushKey(e,t)}).catch(()=>{return}).finally(()=>{if(this.inFlightByMessage.get(i)===s)this.inFlightByMessage.delete(i)});this.inFlightByMessage.set(i,s)}fetchTailPage(e,t,n){let i=`${t}:${n}`,r=this.inFlightTailReads.get(i);if(r)return r;let s;try{s=Promise.resolve(e(t,{limit:n,tail:!0}))}catch(d){return Promise.reject(d)}let o=s.finally(()=>{if(this.inFlightTailReads.get(i)===o)this.inFlightTailReads.delete(i)});return this.inFlightTailReads.set(i,o),o}async flushKey(e,t){if(this.destroyed)return;let n=this.pending.get(e);if(!n)return;let i=n.pendingFallback??t;n.pendingFallback=null;let r={...n},s=this.resolveUpdateMessage();if(!s){this.deleteIfSameRevision(e,r.revision);return}let o=null;if(Cn(i,r.chatId,r.messageId))o=i;let d=o?null:this.resolveGetSingleMessage(),l=o?null:this.resolveGetMessages();if(!o&&d)try{let g=await d(r.messageId);if(this.destroyed)return;if(te(g)&&typeof g.id==="string"&&g.id===r.messageId&&(typeof g.chat_id!=="string"||g.chat_id===r.chatId))o=g}catch(g){if(this.destroyed)return;if(!l){this.handleFlushFailure(e,r,g);return}}if(!o&&l){let g;try{g=await this.fetchTailPage(l,r.chatId,50)}catch(u){if(this.destroyed)return;this.handleFlushFailure(e,r,u);return}if(this.destroyed)return;let b=Wt(g);if(o=b.find((u)=>u.id===r.messageId)??null,!o){if(!Xt(g,b.length,50)){this.deleteIfSameRevision(e,r.revision);return}try{let p=await this.fetchTailPage(l,r.chatId,200);if(this.destroyed)return;let y=Wt(p);if(o=y.find((I)=>I.id===r.messageId)??null,!o&&!Xt(p,y.length,200)){this.deleteIfSameRevision(e,r.revision);return}}catch(p){if(this.destroyed)return;this.handleFlushFailure(e,r,p);return}if(!o)return}}else if(!o&&i&&i.id===r.messageId&&(typeof i.chat_id!=="string"||i.chat_id===r.chatId))o=i;if(!o)return;let h=this.pending.get(e);if(!h||h.revision!==r.revision)return;if(typeof o.swipe_id!=="number")return;if(o.swipe_id!==r.swipeId){h.lastKnownSwipeId=o.swipe_id;return}let c={...te(o.extra)?o.extra:{}};if(r.tokenCount!==void 0)c.tokenCount=r.tokenCount;if(r.generationMetrics!==void 0)c.generationMetrics=r.generationMetrics;try{await s(r.chatId,r.messageId,{extra:c})}catch(g){if(this.destroyed)return;this.handleFlushFailure(e,r,g);return}if(this.destroyed)return;this.deleteIfSameRevision(e,r.revision)}handleFlushFailure(e,t,n){let i=this.pending.get(e);if(!i||i.revision!==t.revision)return;if(wn(n)||t.attempts>=$t.length){this.pending.delete(e);return}let r=$t[t.attempts]??150;i.attempts=t.attempts+1,this.scheduleRetry(e,r)}deleteIfSameRevision(e,t){let n=this.pending.get(e);if(n&&n.revision===t)this.pending.delete(e)}scheduleRetry(e,t){if(this.destroyed||this.retryTimers.has(e))return;let n=setTimeout(()=>{if(this.retryTimers.delete(e),this.destroyed)return;this.enqueueFlush(e)},t);this.retryTimers.set(e,n)}clearRetryTimer(e){let t=this.retryTimers.get(e);if(t!==void 0)clearTimeout(t),this.retryTimers.delete(e)}resolveGetMessages(){try{let e=this.ctx.domain?.chats;if(typeof e?.getMessages==="function")return e.getMessages.bind(e);let t=this.ctx.chats;if(typeof t?.getMessages==="function")return t.getMessages.bind(t)}catch{}return null}resolveGetSingleMessage(){try{let e=this.ctx.messages;if(typeof e?.get==="function")return e.get.bind(e)}catch{}return null}resolveUpdateMessage(){try{let e=this.ctx.chats;if(typeof e?.updateMessage==="function")return e.updateMessage.bind(e)}catch{}return null}safeGetActiveChatId(){try{return this.ctx.getActiveChat?.().chatId??null}catch{return null}}}var xn=[{value:"system",label:"System"},{value:"user",label:"User"},{value:"assistant",label:"Assistant"}],Rn=Ke.map((e)=>({value:e.value,label:e.label,sublabel:e.sublabel})),Sn=Dt.map((e)=>({value:e.value,label:e.label,sublabel:e.sublabel}));class ft{ctx;handlers;tab;handles=[];currentSettings=null;expandedSections=new Set;debounceTimers=new Map;orderStateTags=new Map;rootEl=null;headerEl=null;noticeEl=null;recoveryUi=null;pendingView=null;pendingFocusRestore=null;pendingGeneralFocusRestore=null;pointerActiveInDrawer=!1;pointerReleaseCleanup=null;pointerFallbackTimer=null;pendingViewFlushTimer=null;tabConnectionCleanups=new Set;noticeText="";noticeKind="info";recoveryBusy=!1;destroyed=!1;onFocusOut;onPointerDownInDrawer;constructor(e,t){this.ctx=e;this.handlers=t;this.tab=e.ui.registerDrawerTab({id:"guided-generations-settings",title:"Guided Generations",shortName:"Guided",description:"Configure input-bar guided action buttons and per-option API connection profiles & presets.",keywords:["guided","continue","regenerate","swipe","impersonate","recovery","preset","profile"],iconSvg:Ft});let n=()=>{if(this.pointerFallbackTimer!==null)clearTimeout(this.pointerFallbackTimer),this.pointerFallbackTimer=null;if(this.pointerReleaseCleanup){let i=this.pointerReleaseCleanup;this.pointerReleaseCleanup=null,i()}};this.onPointerDownInDrawer=()=>{if(this.destroyed||this.pointerActiveInDrawer)return;if(this.pointerActiveInDrawer=!0,n(),typeof document>"u"){this.pointerActiveInDrawer=!1;return}let i=typeof window<"u"?window:document.defaultView,r=()=>{if(n(),this.pendingViewFlushTimer!==null)clearTimeout(this.pendingViewFlushTimer);this.pendingViewFlushTimer=setTimeout(()=>{this.pendingViewFlushTimer=null,this.pointerActiveInDrawer=!1,this.flushPendingViewIfIdle()},0)},s=()=>{n(),this.pointerActiveInDrawer=!1,this.flushPendingViewIfIdle()};document.addEventListener("pointerup",r,!0),document.addEventListener("pointercancel",r,!0),document.addEventListener("mouseup",r,!0),i?.addEventListener("blur",s),this.pointerReleaseCleanup=()=>{document.removeEventListener("pointerup",r,!0),document.removeEventListener("pointercancel",r,!0),document.removeEventListener("mouseup",r,!0),i?.removeEventListener("blur",s)},this.pointerFallbackTimer=setTimeout(()=>{n(),this.pointerActiveInDrawer=!1,this.flushPendingViewIfIdle()},3000)},this.onFocusOut=(i)=>{if(this.destroyed)return;let r=i.relatedTarget;if(this.debounceTimers.size>0&&r!==i.target)this.flushPendingSaves();if(!(Ze(r)&&this.tab.root.contains(r)&&qt(r))&&this.pendingView)if(this.pointerActiveInDrawer||An(this.tab.root,r)){if(!this.pointerActiveInDrawer)this.scheduleDeferredPendingViewFlush()}else queueMicrotask(()=>{this.flushPendingViewIfIdle()})},this.tab.root.addEventListener("pointerdown",this.onPointerDownInDrawer),this.tab.root.addEventListener("mousedown",this.onPointerDownInDrawer),this.tab.root.addEventListener("focusout",this.onFocusOut)}scheduleDeferredPendingViewFlush(){if(this.destroyed||this.pendingViewFlushTimer!==null)return;this.pendingViewFlushTimer=setTimeout(()=>{this.pendingViewFlushTimer=null,this.flushPendingViewIfIdle()},0)}flushPendingViewIfIdle(){if(this.destroyed||this.pointerActiveInDrawer)return;if(this.pendingView&&!this.isEditingDrawerInput()){let e=this.currentSettings?{...this.pendingView,settings:this.currentSettings}:this.pendingView;this.pendingView=null,this.render(e,{force:!0})}}onActivate(e){return this.tab.onActivate(e)}isTabConnected(){if(this.destroyed)return!1;if(this.tab.root?.isConnected)return!0;try{let e=this.ctx.ui?.getTabLocation?.(this.tab.tabId);if(e&&e.kind!=="main-drawer")return!0}catch{}try{let e=this.ctx.ui?.events?.getDrawerState?.();if(e?.open&&e.tabId===this.tab.tabId)return!0}catch{}return!1}observeTabConnection(e){if(this.destroyed||typeof IntersectionObserver!=="function")return()=>{};let t=!0,n=()=>{if(!t)return;t=!1,this.tabConnectionCleanups.delete(n),i.disconnect()},i=new IntersectionObserver((r)=>{if(!t||this.destroyed){n();return}if(r.some((s)=>s.isIntersecting)||this.isTabConnected())n(),e()},{threshold:0});return this.tabConnectionCleanups.add(n),i.observe(this.tab.root),n}setNotice(e,t="info"){this.noticeText=e,this.noticeKind=t,this.syncNoticeElement()}syncNoticeElement(){if(this.destroyed||!this.rootEl||!this.headerEl)return;if(!this.noticeText){this.noticeEl?.remove(),this.noticeEl=null;return}if(!this.noticeEl)this.noticeEl=document.createElement("div"),this.headerEl.after(this.noticeEl);if(this.noticeEl.className=`gg-notice${this.noticeKind==="error"?" is-error":this.noticeKind==="warn"?" is-warn":""}`,this.noticeKind==="error"||this.noticeKind==="warn")this.noticeEl.setAttribute("role","alert"),this.noticeEl.setAttribute("aria-live","assertive");else this.noticeEl.setAttribute("role","status"),this.noticeEl.setAttribute("aria-live","polite");this.noticeEl.textContent=this.noticeText}setRecoveryBusy(e){if(this.destroyed)return;if(this.recoveryBusy=e,!this.recoveryUi)return;if(this.recoveryUi.clearBtn.disabled=e||this.recoveryUi.recoveryCount===0,this.recoveryUi.listEl)for(let t of this.recoveryUi.listEl.querySelectorAll("button"))t.disabled=e}updateRecovery(e,t){if(this.destroyed)return;if(this.pendingView)this.pendingView={...this.pendingView,recovery:[...e]};if(!this.recoveryUi)return;let n=t?.inputRecovery.maxEntries??this.currentSettings?.inputRecovery.maxEntries??10;this.recoveryUi.maxEntries=n,this.recoveryUi.recoveryCount=e.length,this.recoveryUi.setBadge(e.length>0?String(e.length):"",e.length===0),this.recoveryUi.countLabel.textContent=e.length>0?`Saved inputs (${e.length}/${n}):`:"No saved inputs yet.",this.recoveryUi.clearBtn.disabled=this.recoveryBusy||e.length===0,this.syncRecoveryList(e)}isEditingDrawerInput(){if(this.debounceTimers.size>0)return!0;if(this.tab.root.querySelector('[aria-expanded="true"]:not(.gg-card-header), [role="listbox"]')!==null)return!0;let e=typeof document<"u"?document.activeElement:null;return Boolean(Ze(e)&&this.tab.root.contains(e)&&qt(e))}captureOrderButtonFocus(){let e=typeof document<"u"?document.activeElement:null;if(!Ze(e)||!this.tab.root.contains(e))return;if(!this.pendingFocusRestore&&e.tagName==="BUTTON"){let t=e,n=t.dataset.ggMove;if(n==="up"||n==="down"){let r=t.closest("[data-gg-order-id]")?.getAttribute("data-gg-order-id");if(r){this.pendingFocusRestore={optionId:r,button:n};return}}}if(!this.pendingFocusRestore&&!this.pendingGeneralFocusRestore){let t=e.getAttribute("data-gg-focus-key")??void 0,n=e.getAttribute("aria-label")??void 0;if(t||n)this.pendingGeneralFocusRestore={focusKey:t,tagName:e.tagName,ariaLabel:n}}}render(e,t){if(this.destroyed)return;if(!t?.force&&this.rootEl!==null&&this.currentSettings!==null&&this.isEditingDrawerInput()){if(e)this.pendingView=e,this.updateRecovery(e.recovery,e.settings);return}if(this.pendingView=null,this.pendingViewFlushTimer!==null)clearTimeout(this.pendingViewFlushTimer),this.pendingViewFlushTimer=null;this.captureOrderButtonFocus();let n=e;if(t?.force&&this.debounceTimers.size>0){if(this.flushPendingSaves(),n&&this.currentSettings)n={...n,settings:this.currentSettings}}else this.cancelPendingSaves();this.clearComponentHandles(),this.orderStateTags.clear(),this.recoveryUi=null,this.noticeEl=null,this.currentSettings=n?.settings??null;let i=document.createElement("div");i.className="gg-drawer",this.rootEl=i,this.tab.root.replaceChildren(i);let r=document.createElement("header");r.className="gg-header",this.headerEl=r;let s=document.createElement("div"),o=document.createElement("h2");o.textContent="Guided Generations";let d=document.createElement("p");d.className="gg-muted",d.textContent="Enabled options appear on the composer's top action bar alongside native buttons. Each option uses its own connection profile, model, and preset without modifying your active chat.",s.append(o,d);let l=document.createElement("button");if(l.type="button",l.className="gg-btn-sm",l.dataset.ggFocusKey="refresh",l.textContent="Refresh",l.addEventListener("click",()=>{this.flushPendingSaves(),this.handlers.onRefresh()}),r.append(s,l),i.append(r),this.syncNoticeElement(),!n){let p=document.createElement("p");p.className="gg-muted",p.textContent="Loading Guided Generations settings…",i.append(p),this.restoreCapturedFocus(i);return}let h=[];if(!n.permissions.generation)h.push("generation");if(!n.permissions.chats)h.push("chats");if(!n.permissions.chat_mutation)h.push("chat_mutation");if(!n.permissions.presets)h.push("presets");if(h.length>0){let p=document.createElement("div");p.className="gg-notice is-warn",p.setAttribute("role","alert"),p.setAttribute("aria-live","assertive"),p.textContent=`Missing extension permissions (${h.join(", ")}). Grant all permissions in Extension Manager so actions and dropdowns work properly.`,i.append(p)}let c=[],g=[];if(n.permissions.interceptor===!1)c.push("interceptor"),g.push("preset-aware guidance placement (pre-history, in-history, before/after post-history) and swipe turn matching fall back to basic heuristic placement");if(n.permissions.regex_scripts===!1)c.push("regex_scripts"),g.push("Lumiverse regex scripts are skipped on guidance prompts and generated/impersonated outputs");if(c.length>0){let p=document.createElement("div");p.className="gg-notice is-warn",p.setAttribute("role","alert"),p.setAttribute("aria-live","assertive"),p.textContent=`Optional permissions not granted (${c.join(", ")}): ${g.join("; ")}. Grant them in Extension Manager for full functionality.`,i.append(p)}if(n.catalogWarnings&&n.catalogWarnings.length>0){let p=document.createElement("div");p.className="gg-notice is-warn",p.setAttribute("role","alert"),p.setAttribute("aria-live","assertive"),p.textContent=n.catalogWarnings.join(" "),i.append(p)}let b=Pn(n.connections),u=Ln(n.presets);this.renderToolbarLayoutSection(i,n.settings);for(let p of je)this.renderActionSection(i,n.settings,p,n.connections,b,u,xn);this.renderRecoverySection(i,n.settings,n.recovery),this.restoreCapturedFocus(i)}restoreCapturedFocus(e){if(this.pendingFocusRestore){let t=this.pendingFocusRestore;this.pendingFocusRestore=null,this.pendingGeneralFocusRestore=null;let n=e.querySelector(`[data-gg-order-id="${t.optionId}"]`),i=n?.querySelector(`button[data-gg-move="${t.button}"]`),r=n?.querySelector(`button[data-gg-move="${t.button==="up"?"down":"up"}"]`);(i&&!i.disabled?i:r&&!r.disabled?r:null)?.focus();return}if(this.pendingGeneralFocusRestore){let t=this.pendingGeneralFocusRestore;this.pendingGeneralFocusRestore=null;let n=null;if(t.focusKey)n=jt(e,"data-gg-focus-key",t.focusKey);if(!n&&t.ariaLabel)n=jt(e,"aria-label",t.ariaLabel,t.tagName);if(n&&!n.disabled)n.focus()}}createCollapsibleCard(e,t,n,i,r=!1,s){let o=document.createElement("section");if(o.className="gg-card",this.expandedSections.has(t))o.classList.add("is-expanded");let d=document.createElement("button");d.type="button",d.className="gg-card-header",d.dataset.ggFocusKey=`card-header:${t}`,d.setAttribute("aria-expanded",String(this.expandedSections.has(t)));let l=document.createElement("span");l.className="gg-card-header-left";let h=document.createElement("span");h.className="gg-card-chevron",h.setAttribute("aria-hidden","true"),h.textContent="▸";let c=document.createElement("span");c.textContent=n,l.append(h,c);let g=document.createElement("span");if(g.className=`gg-card-badge${r?" is-muted":""}`,i!==void 0)g.textContent=i;else g.style.display="none";d.append(l,g);let b=document.createElement("div");b.className="gg-card-body-wrap";let u=`gg-card-body-${t}`;b.id=u,d.setAttribute("aria-controls",u);let p=document.createElement("div");return p.className="gg-section-body",b.append(p),d.addEventListener("click",()=>{let y=!o.classList.contains("is-expanded");if(o.classList.toggle("is-expanded",y),d.setAttribute("aria-expanded",String(y)),y)this.expandedSections.add(t);else this.expandedSections.delete(t);s?.(y)}),o.append(d,b),e.append(o),{body:p,setBadge(y,I=!1){g.textContent=y,g.className=`gg-card-badge${I?" is-muted":""}`,g.style.display=y?"":"none"}}}renderToolbarLayoutSection(e,t){let n=ze(t.toolbarPlacement),i=Ke.find((y)=>y.value===n)??Ke[0],r=this.createCollapsibleCard(e,"toolbar_layout","Toolbar Position & Order",i.shortLabel,!1),s=r.body,o=document.createElement("p");o.className="gg-muted",o.textContent="Choose where the Guided Generations buttons appear on the composer bar and customize their left-to-right order.",s.append(o);let d=(y,I)=>{let E={...this.currentSettings??t,...y};if(this.currentSettings=E,y.toolbarPlacement!==void 0){let S=Ke.find((A)=>A.value===y.toolbarPlacement);if(S)r.setBadge(S.shortLabel,!1)}this.handlers.onSaveSettings(E,I)},l=he("Bar Placement");s.append(l.wrap),this.handles.push(this.ctx.components.mountSelect(l.slot,{options:Rn,value:n,ariaLabel:"Toolbar Bar Placement",onChange:(y)=>{d({toolbarPlacement:ze(y)},{rebuildDrawer:!1})}}));let h=he("Button Order (left to right)"),c=document.createElement("div");c.className="gg-order-list";let g=Ye(t.buttonOrder);g.forEach((y,I)=>{let w=document.createElement("div");w.className="gg-order-item",w.setAttribute("data-gg-order-id",y);let E=document.createElement("div");E.className="gg-order-item-left";let S=document.createElement("span");S.className="gg-order-item-icon",S.setAttribute("aria-hidden","true"),S.innerHTML=$e[y];let A=y==="input_recovery"?"Input Recovery":_e[y].label,D=y==="input_recovery"?t.inputRecovery.enabled:Boolean(t.actions[y]?.enabled),T=document.createElement("span");T.className="gg-order-item-label",T.textContent=A;let x=document.createElement("span");x.className="gg-order-item-state",x.textContent=D?"Visible":"Hidden",this.orderStateTags.set(y,x),E.append(S,T,x);let C=document.createElement("div");C.className="gg-order-item-controls";let O=(j)=>{let q=I+j;if(q<0||q>=g.length)return;this.flushPendingSaves();let k=[...g],[G]=k.splice(I,1);if(!G)return;k.splice(q,0,G);let Q=j===-1?q===0?"down":"up":q===k.length-1?"up":"down";this.pendingFocusRestore={optionId:G,button:Q},d({buttonOrder:k},{rebuildDrawer:!0})},L=document.createElement("button");L.type="button",L.className="gg-icon-btn-sm",L.dataset.ggMove="up",L.textContent="↑",L.title=`Move ${A} left / up`,L.setAttribute("aria-label",`Move ${A} up`),L.disabled=I===0,L.addEventListener("click",()=>O(-1));let N=document.createElement("button");N.type="button",N.className="gg-icon-btn-sm",N.dataset.ggMove="down",N.textContent="↓",N.title=`Move ${A} right / down`,N.setAttribute("aria-label",`Move ${A} down`),N.disabled=I===g.length-1,N.addEventListener("click",()=>O(1)),C.append(L,N),w.append(E,C),c.append(w)});let b=document.createElement("div");b.className="gg-row";let u=document.createElement("span");u.className="gg-muted",u.textContent="Restore default button order & alignment";let p=document.createElement("button");p.type="button",p.className="gg-btn-sm",p.dataset.ggFocusKey="reset-layout",p.textContent="Reset layout",p.addEventListener("click",()=>{this.flushPendingSaves(),d({toolbarPlacement:"after_native",buttonOrder:[...at]},{rebuildDrawer:!0})}),b.append(u,p),h.slot.append(c),s.append(h.wrap,b)}renderActionSection(e,t,n,i,r,s,o){let d=_e[n],l=t.actions[n],h=l.connectionId,c=this.expandedSections.has(n),g=null,b=this.createCollapsibleCard(e,n,d.label,l.enabled?"Visible":"Hidden",!l.enabled,(R)=>{if(R&&!c)c=!0,g?.update({connection:pt(h)})}),u=b.body,p=document.createElement("p");p.className="gg-muted",p.textContent=d.description,u.append(p);let y=(R,Y={rebuildDrawer:!1})=>{let Z=this.currentSettings??t,ke={...Z,actions:{...Z.actions,[n]:{...Z.actions[n],...R}}};if(this.currentSettings=ke,R.enabled!==void 0)b.setBadge(R.enabled?"Visible":"Hidden",!R.enabled),this.updateOrderStateTag(n,R.enabled);this.handlers.onSaveSettings(ke,Y)},I=document.createElement("div");I.className="gg-row";let w=document.createElement("span");w.className="gg-field-label",w.textContent="Show button on input bar";let E=document.createElement("div");I.append(w,E),u.append(I),this.handles.push(this.ctx.components.mountSwitch(E,{checked:l.enabled,size:"sm",ariaLabel:`Show ${d.label} button on input bar`,onChange:(R)=>y({enabled:R},{rebuildDrawer:!1})}));let S=document.createElement("div");S.className="gg-row";let A=document.createElement("span");A.className="gg-field-label",A.textContent="Clear input bar when triggered";let D=document.createElement("div");S.append(A,D),u.append(S),this.handles.push(this.ctx.components.mountSwitch(D,{checked:l.clearInputOnRun,size:"sm",ariaLabel:`Clear input bar when running ${d.label}`,onChange:(R)=>y({clearInputOnRun:R})}));let T=document.createElement("div");T.className="gg-row";let x=document.createElement("span");x.className="gg-field-label",x.textContent="Apply Lumiverse regex scripts";let C=document.createElement("div");T.append(x,C),u.append(T),this.handles.push(this.ctx.components.mountSwitch(C,{checked:l.applyRegex??Ht,size:"sm",ariaLabel:`Apply Lumiverse regex scripts for ${d.label}`,onChange:(R)=>y({applyRegex:R})}));let O=Mn(this.ctx),L=he("API Connection Profile");u.append(L.wrap),this.handles.push(this.ctx.components.mountSelect(L.slot,{options:r,value:l.connectionId??"",ariaLabel:`${d.label} API Connection Profile`,onChange:(R)=>{let Y=R||null;h=Y,y({connectionId:Y}),g?.update(c?{connection:pt(Y),placeholder:gt(Y,i,O)}:{placeholder:gt(Y,i,O)})}}));let N=`gg-${n}-model`,j=he("Model (blank = connection profile model)",N);if(u.append(j.wrap),typeof this.ctx.components.mountModelCombobox==="function")g=this.ctx.components.mountModelCombobox(j.slot,{value:l.model??"",connection:c?pt(h):void 0,appearance:"standard",autoRefreshOnFocus:!0,placeholder:gt(h,i,O),onChange:(R)=>{this.scheduleDebouncedSave(`${n}:model`,()=>{y({model:R.trim()||null})})}}),this.attachSlotInputAttributes(j.slot,N,`${d.label} Model`),this.handles.push(g);let q=he("Preset");u.append(q.wrap),this.handles.push(this.ctx.components.mountSelect(q.slot,{options:s,value:l.presetId??"",ariaLabel:`${d.label} Preset`,onChange:(R)=>y({presetId:R||null})}));let k=he("Guidance Injection Role");u.append(k.wrap),this.handles.push(this.ctx.components.mountSelect(k.slot,{options:o,value:l.injectionRole,ariaLabel:`${d.label} Guidance Injection Role`,onChange:(R)=>y({injectionRole:R})}));let G=ot(l.guidancePosition),Q=Nt(l.guidanceDepth),se=null,le=`gg-${n}-guidance-depth`,ne=he("In-History Depth (0–999)",le),ie=(R)=>{let Y=R==="in_history";ne.wrap.style.display=Y?"":"none",se?.setDisabled(!Y)},Pe=he("Guidance Position");u.append(Pe.wrap,ne.wrap),this.handles.push(this.ctx.components.mountSelect(Pe.slot,{options:Sn,value:G,ariaLabel:`${d.label} Guidance Position`,onChange:(R)=>{let Y=ot(R);y({guidancePosition:Y}),ie(Y)}})),se=this.mountBoundedIntegerField({slot:ne.slot,fieldId:le,ariaLabel:`${d.label} In-history depth`,debounceKey:`${n}:depth`,min:0,max:999,defaultValue:kt,placeholder:"0",initialValue:Q,disabled:G!=="in_history",onCommit:(R)=>{y({guidanceDepth:R})}}),ie(G);let Le=he("Guidance Template (supports {{input}} and Lumiverse macros like {{char}}, {{user}}; leave blank for raw input)");u.append(Le.wrap),this.handles.push(this.ctx.components.mountTextArea(Le.slot,{value:l.instructionTemplate,rows:2,placeholder:"{{input}}",ariaLabel:`${d.label} Guidance Template`,onChange:(R)=>{this.scheduleDebouncedSave(`${n}:template`,()=>{y({instructionTemplate:R})})}}))}mountBoundedIntegerField(e){let t=(l)=>{if(typeof l==="number"&&Number.isFinite(l))return Math.max(e.min,Math.min(e.max,Math.floor(l)));return Math.max(e.min,Math.min(e.max,Math.floor(e.defaultValue)))},n=t(e.initialValue),i=!1,r=!1,s=null,o=null,d=(l)=>{if(r)return;if(l===null){i=!0,this.cancelPendingSaveKey(e.debounceKey);return}i=!1;let h=t(l);n=h,this.scheduleDebouncedSave(e.debounceKey,()=>{e.onCommit(h)})};if(typeof this.ctx.components.mountNumericInput==="function")s=this.ctx.components.mountNumericInput(e.slot,{value:n,min:e.min,max:e.max,step:1,integer:!0,allowEmpty:!0,placeholder:e.placeholder,disabled:Boolean(e.disabled),ariaLabel:e.ariaLabel,onChange:d}),this.attachSlotInputAttributes(e.slot,e.fieldId,e.ariaLabel),e.slot.addEventListener("focusout",(l)=>{let h=l.relatedTarget;if(h&&e.slot.contains(h))return;if(i||s?.getValue()===null){i=!1;let c=t(e.defaultValue);if(c!==n)n=c,e.onCommit(c)}else this.flushPendingSaveKey(e.debounceKey);if(s&&s.getValue()!==n){r=!0;try{s.update({value:n})}finally{r=!1}}}),this.handles.push(s);else{let l=document.createElement("input");l.type="number",l.id=e.fieldId,l.className="gg-input-sm",l.min=String(e.min),l.max=String(e.max),l.step="1",l.placeholder=e.placeholder,l.value=String(n),l.disabled=Boolean(e.disabled),l.setAttribute("aria-label",e.ariaLabel),l.addEventListener("input",()=>{let h=l.value.trim(),c=h===""?null:Number(h);d(c!==null&&Number.isFinite(c)?c:null)}),l.addEventListener("blur",()=>{if(i||l.value.trim()===""){i=!1;let h=t(e.defaultValue);if(h!==n)n=h,e.onCommit(h)}else this.flushPendingSaveKey(e.debounceKey);l.value=String(n)}),o=l,e.slot.append(l)}return{setDisabled:(l)=>{if(s){r=!0;try{s.update({disabled:l})}finally{r=!1}}if(o)o.disabled=l}}}updateOrderStateTag(e,t){let n=this.orderStateTags.get(e);if(n)n.textContent=t?"Visible":"Hidden"}renderRecoverySection(e,t,n){let i=this.createCollapsibleCard(e,"input_recovery","Input Recovery",n.length>0?String(n.length):void 0,n.length===0),r=i.body,s=document.createElement("p");s.className="gg-muted",s.textContent="Automatically saves composer input cleared or replaced by guided actions so you can restore it in one click. When no saved inputs exist, clicking Input Recovery clears the current input.",r.append(s);let o=document.createElement("div");o.className="gg-row";let d=document.createElement("span");d.className="gg-field-label",d.textContent="Enable Input Recovery & toolbar button";let l=document.createElement("div");o.append(d,l),r.append(o),this.handles.push(this.ctx.components.mountSwitch(l,{checked:t.inputRecovery.enabled,size:"sm",ariaLabel:"Show Input Recovery button on input bar",onChange:(p)=>{let y=this.currentSettings??t,I={...y,inputRecovery:{...y.inputRecovery,enabled:p}};this.currentSettings=I,this.updateOrderStateTag("input_recovery",p),this.handlers.onSaveSettings(I,{rebuildDrawer:!1})}}));let h="gg-recovery-max-entries",c=he("Max saved drafts (1–50)",h);r.append(c.wrap),this.mountBoundedIntegerField({slot:c.slot,fieldId:h,ariaLabel:"Max saved drafts",debounceKey:"recovery:maxEntries",min:1,max:50,defaultValue:10,placeholder:"10",initialValue:t.inputRecovery.maxEntries,onCommit:(p)=>{let y=this.currentSettings??t,I={...y,inputRecovery:{...y.inputRecovery,maxEntries:p}};if(this.currentSettings=I,this.recoveryUi)this.recoveryUi.maxEntries=p,this.recoveryUi.countLabel.textContent=this.recoveryUi.recoveryCount>0?`Saved inputs (${this.recoveryUi.recoveryCount}/${p}):`:"No saved inputs yet.";this.handlers.onSaveSettings(I,{rebuildDrawer:!1})}});let g=document.createElement("div");g.className="gg-row";let b=document.createElement("span");b.className="gg-muted",b.textContent=n.length>0?`Saved inputs (${n.length}/${t.inputRecovery.maxEntries}):`:"No saved inputs yet.";let u=document.createElement("button");u.type="button",u.className="gg-btn-sm",u.dataset.ggFocusKey="clear-recovery",u.textContent="Clear History",u.disabled=this.recoveryBusy||n.length===0,u.addEventListener("click",()=>{this.handlers.onClearRecovery()}),g.append(b,u),r.append(g),this.recoveryUi={setBadge:i.setBadge,countLabel:b,clearBtn:u,body:r,listEl:null,entries:[],maxEntries:t.inputRecovery.maxEntries,recoveryCount:n.length},this.syncRecoveryList(n)}syncRecoveryList(e){let t=this.recoveryUi;if(!t)return;if(e.length===0){if(t.entries=[],t.listEl)t.listEl.remove(),t.listEl=null;return}if(t.listEl&&t.entries.length===e.length&&t.entries.every((r,s)=>{let o=e[s];return r.id===o.id&&r.text===o.text&&r.actionId===o.actionId}))return;t.entries=[...e];let n=t.listEl;if(!n)n=document.createElement("div"),n.className="gg-recovery-list",n.addEventListener("click",(r)=>{let o=r.target?.closest("button[data-gg-recovery-index]");if(!o||o.disabled)return;let d=Number(o.dataset.ggRecoveryIndex),l=Number.isInteger(d)?this.recoveryUi?.entries[d]:void 0;if(l)this.handlers.onRestoreEntry(l)}),t.listEl=n,t.body.append(n);let i=document.createDocumentFragment();e.forEach((r,s)=>{let o=document.createElement("div");o.className="gg-recovery-item";let d=document.createElement("div");d.className="gg-recovery-meta";let l=_e[r.actionId]?.label??r.actionId,h=document.createElement("span");h.className="gg-recovery-tag",h.textContent=l;let c=document.createElement("span");c.className="gg-recovery-snippet",c.textContent=Oe(r.text),c.title=r.text,d.append(h,c);let g=document.createElement("button");g.type="button",g.className="gg-btn-sm",g.dataset.ggRecoveryIndex=String(s),g.textContent="Restore",g.disabled=this.recoveryBusy,g.setAttribute("aria-label",`Restore ${l} draft: ${Oe(r.text,40)}`),o.append(d,g),i.append(o)}),n.replaceChildren(i)}attachSlotInputAttributes(e,t,n){let i=()=>{let s=e.querySelector("input");if(!s)return!1;if(!s.id)s.id=t;if(!s.getAttribute("aria-label"))s.setAttribute("aria-label",n);return!0};if(i()||typeof MutationObserver!=="function")return;let r=new MutationObserver(()=>{if(i())r.disconnect()});r.observe(e,{childList:!0,subtree:!0}),this.handles.push({destroy:()=>r.disconnect()})}scheduleDebouncedSave(e,t,n=250){let i=this.debounceTimers.get(e);if(i)clearTimeout(i.timer);let r=()=>{if(this.destroyed)return;t()},s=setTimeout(()=>{this.debounceTimers.delete(e),r(),this.flushPendingViewIfIdle()},n);this.debounceTimers.set(e,{timer:s,flush:r})}flushPendingSaves(){if(this.destroyed||this.debounceTimers.size===0)return;let e=Array.from(this.debounceTimers.entries());this.debounceTimers.clear();for(let[,t]of e)clearTimeout(t.timer),t.flush()}flushPendingSaveKey(e){if(this.destroyed)return;let t=this.debounceTimers.get(e);if(!t)return;this.debounceTimers.delete(e),clearTimeout(t.timer),t.flush()}cancelPendingSaveKey(e){let t=this.debounceTimers.get(e);if(!t)return;this.debounceTimers.delete(e),clearTimeout(t.timer)}cancelPendingSaves(){for(let e of this.debounceTimers.values())clearTimeout(e.timer);this.debounceTimers.clear()}clearComponentHandles(){for(let e of this.handles)e.destroy();this.handles=[]}destroy(){if(this.flushPendingSaves(),this.destroyed=!0,this.pendingView=null,this.pendingFocusRestore=null,this.pendingGeneralFocusRestore=null,this.pointerActiveInDrawer=!1,this.pointerFallbackTimer!==null)clearTimeout(this.pointerFallbackTimer),this.pointerFallbackTimer=null;if(this.pendingViewFlushTimer!==null)clearTimeout(this.pendingViewFlushTimer),this.pendingViewFlushTimer=null;if(this.pointerReleaseCleanup){let e=this.pointerReleaseCleanup;this.pointerReleaseCleanup=null,e()}for(let e of[...this.tabConnectionCleanups])e();this.tabConnectionCleanups.clear(),this.rootEl=null,this.headerEl=null,this.noticeEl=null,this.recoveryUi=null,this.orderStateTags.clear(),this.tab.root.removeEventListener("pointerdown",this.onPointerDownInDrawer),this.tab.root.removeEventListener("mousedown",this.onPointerDownInDrawer),this.tab.root.removeEventListener("focusout",this.onFocusOut),this.cancelPendingSaves(),this.clearComponentHandles(),this.tab.root.replaceChildren(),this.tab.destroy()}}function Ze(e){return Boolean(e&&typeof e==="object"&&e.nodeType===1)}function qt(e){let t=e.tagName;if(t==="INPUT"||t==="TEXTAREA"||t==="SELECT"||e.isContentEditable)return!0;if(e.classList.contains("gg-card-header"))return!1;let n=e.getAttribute("role");if(n==="combobox"||n==="listbox"||n==="option")return!0;if(e.getAttribute("aria-expanded")==="true")return!0;return Boolean(e.closest?.('[role="combobox"], [role="listbox"], [role="option"], [aria-expanded="true"]:not(.gg-card-header)'))}function An(e,t){if(!Ze(t)||!e.contains(t))return!1;return Boolean(t.closest('button, [role="button"], [role="switch"], [role="menuitem"], [role="option"], summary, a[href]'))}function Tn(e){if(typeof CSS<"u"&&typeof CSS.escape==="function")return CSS.escape(e);return e.replace(/\\/g,"\\\\").replace(/"/g,"\\\"")}function jt(e,t,n,i){let r=i?i.toLowerCase():"";try{let s=Tn(n);return e.querySelector(`${r}[${t}="${s}"]`)}catch{for(let s of e.querySelectorAll(`${r}[${t}]`))if(s.getAttribute(t)===n)return s;return null}}function Mn(e){return e.connections?.getActive?.()?.activeProfileId??null}function pt(e){return e?{kind:"llm",id:e}:{kind:"llm"}}function gt(e,t,n){let r=(e?t.find((s)=>s.id===e):(n?t.find((s)=>s.id===n):void 0)??t.find((s)=>s.isDefault)??t[0])?.model?.trim();return r?`Use connection model (${r})`:"Leave blank for connection model"}var _n=0;function he(e,t){let n=document.createElement("div");n.className="gg-field";let i=document.createElement("label");if(i.className="gg-field-label",i.id=`gg-field-label-${++_n}`,t)i.htmlFor=t;i.textContent=e;let r=document.createElement("div");return n.append(i,r),{wrap:n,slot:r,label:i}}function Pn(e){return[{value:"",label:"Use Active Connection",sublabel:"Inherits whichever connection profile is currently active"},...e.map((t)=>({value:t.id,label:t.name,sublabel:t.model?`${t.provider} · ${t.model}`:t.provider}))]}function Ln(e){return[{value:"",label:"Use Active Preset",sublabel:"Inherits the active chat or connection preset"},...e.map((t)=>({value:t.id,label:t.name}))]}var kn=new Set(["guided_response","guided_regenerate","guided_swipe","guided_continue"]),Yt=new Set(["guided_response","guided_regenerate"]),Hn=new Set(["guided_continue","guided_swipe"]);function Zt(e){return Boolean(e)&&typeof e==="object"&&!Array.isArray(e)}class mt{ctx;disposers=[];runStateById=new Map;currentRun=null;viewedSwipeId=void 0;swipeInitialized=!1;contentSeen=!1;mountedEl=null;mountedTarget=null;mountedPosition=null;mountedIsMessageContent=null;mountedMessageId=null;streamAfterMount=null;optimisticStreamEl=null;rafId=null;rafTimerId=null;rowObserver=null;observedRow=null;rafRetries=0;retryMode=null;destroyed=!1;constructor(e){this.ctx=e;if(typeof this.ctx.events?.on==="function"){let t=()=>{if(!this.destroyed)this.rafRetries=0,this.syncCurrent()};this.disposers.push(this.ctx.events.on("MESSAGE_SWIPED",(n)=>{this.onMessageEvent(n,"MESSAGE_SWIPED")}),this.ctx.events.on("MESSAGE_EDITED",(n)=>{this.onMessageEvent(n,"MESSAGE_EDITED")}),this.ctx.events.on("MESSAGE_SENT",(n)=>{this.onMessageEvent(n,"MESSAGE_SENT")}),this.ctx.events.on("CHAT_CHANGED",t),this.ctx.events.on("CHAT_SWITCHED",t))}}sync(e){if(this.destroyed)return;let t=this.currentRun;if(t)this.saveRunState(t.runId);if(t?.runId!==e?.runId){let n=e?this.runStateById.get(e.runId):void 0;if(n)this.contentSeen=n.contentSeen,this.viewedSwipeId=n.viewedSwipeId,this.swipeInitialized=n.swipeInitialized;else this.contentSeen=!1,this.viewedSwipeId=void 0,this.swipeInitialized=!1;this.resetRetry()}else if(t?.messageId!==e?.messageId)this.resetRetry();if(this.currentRun=e,e&&!this.swipeInitialized&&e.swipeId!==void 0)this.viewedSwipeId=e.backgroundSwipe?void 0:e.swipeId,this.swipeInitialized=!0;if(e)this.saveRunState(e.runId);this.syncCurrent()}destroy(){if(this.destroyed)return;this.destroyed=!0,this.resetRetry(),this.unmount(),this.streamAfterMount=null,this.currentRun=null,this.runStateById.clear();for(let e of this.disposers)try{e()}catch{}this.disposers.length=0}saveRunState(e){if(!e)return;if(this.runStateById.has(e))this.runStateById.delete(e);if(this.runStateById.set(e,{viewedSwipeId:this.viewedSwipeId,swipeInitialized:this.swipeInitialized,contentSeen:this.contentSeen}),this.runStateById.size>32){let t=this.runStateById.keys().next().value;if(t!==void 0)this.runStateById.delete(t)}}onMessageEvent(e,t){if(this.destroyed||!this.currentRun?.messageId)return;let n=Zt(e)?e:null,i=n&&Zt(n.message)?n.message:null,r=typeof i?.id==="string"?i.id:typeof n?.messageId==="string"?n.messageId:void 0;if(r!==void 0&&r!==this.currentRun.messageId)return;if(r===this.currentRun.messageId){let s=this.viewedSwipeId,o=this.swipeInitialized,d=this.contentSeen,l=typeof i?.swipe_id==="number"?i.swipe_id:typeof n?.swipeId==="number"?n.swipeId:void 0;if(l!==void 0)this.viewedSwipeId=l,this.swipeInitialized=!0;if(typeof i?.content==="string"&&i.content.length>0&&(this.currentRun.swipeId==null||this.viewedSwipeId===this.currentRun.swipeId||this.viewedSwipeId===void 0))this.contentSeen=!0;if(this.viewedSwipeId!==s||this.swipeInitialized!==o||this.contentSeen!==d)this.saveRunState(this.currentRun.runId);if(t==="MESSAGE_SWIPED")this.rafRetries=0}this.syncCurrent()}syncCurrent(){if(this.destroyed)return;let e=this.currentRun,t=this.resolveDisplayPlan(e);if(t.kind==="none"){this.resetRetry(),this.unmount();return}if(t.kind==="stream_after"){this.resetRetry(),this.unmountRow(),this.mountOptimisticStreamAfter();return}if(typeof this.ctx.dom?.findMessageElement!=="function"||typeof this.ctx.dom?.inject!=="function"){if(t.allowStreamAfterFallback)this.mountOptimisticStreamAfter();return}if(this.mountedEl&&this.mountedTarget&&this.mountedPosition&&this.mountedIsMessageContent===!0&&this.mountedMessageId===t.messageId&&this.mountedEl.isConnected&&this.mountedTarget.isConnected&&this.isMountedAt(this.mountedEl,this.mountedTarget,this.mountedPosition)){this.unmountOptimisticStreamAfter(),this.resetRetry();return}let n=this.resolveTarget(t.messageId,t.actionId);if(!n){if(this.unmountRow(),t.allowStreamAfterFallback)this.mountOptimisticStreamAfter();else this.unmountOptimisticStreamAfter();if(t.retryRowIfMissing)this.ensureRetryMode("row"),this.scheduleRetry();else this.resetRetry();return}let i=Boolean(e?.hasContentOutput||this.contentSeen);if(this.unmountOptimisticStreamAfter(),this.mountedEl&&this.mountedTarget===n.element&&this.mountedPosition===n.position&&this.mountedIsMessageContent===n.isMessageContent&&this.mountedMessageId===t.messageId&&this.isMountedAt(this.mountedEl,n.element,n.position)){if(!n.isMessageContent&&i)this.ensureRetryMode("content"),this.scheduleRetry(n.row);else this.resetRetry();return}this.unmountRow();let r=n.isMessageContent?'<div class="gg-streaming-indicator gg-streaming-indicator--after" role="status" aria-label="Generating response"><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span></div>':'<div class="gg-streaming-indicator" role="status" aria-label="Generating response"><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span></div>';if(this.mountedEl=this.ctx.dom.inject(n.element,r,n.position),this.mountedTarget=n.element,this.mountedPosition=n.position,this.mountedIsMessageContent=n.isMessageContent,this.mountedMessageId=t.messageId,!n.isMessageContent&&i)this.ensureRetryMode("content"),this.scheduleRetry(n.row);else this.resetRetry()}resolveDisplayPlan(e){if(!e||this.destroyed)return{kind:"none"};if(!kn.has(e.actionId))return{kind:"none"};let t=this.safeGetActiveChatId();if(!t||e.chatId!==t)return{kind:"none"};if(typeof e.messageId==="string"&&e.messageId.length>0){if(e.actionId==="guided_swipe"){if(typeof e.swipeId!=="number"||this.viewedSwipeId!==e.swipeId)return{kind:"none"}}else if(e.swipeId!=null&&this.viewedSwipeId!==e.swipeId)return{kind:"none"};return{kind:"row",messageId:e.messageId,actionId:e.actionId,allowStreamAfterFallback:Yt.has(e.actionId),retryRowIfMissing:!0}}if(e.actionId==="guided_swipe"&&e.backgroundSwipe)return{kind:"none"};if(Yt.has(e.actionId))return{kind:"stream_after"};if(Hn.has(e.actionId)){if(typeof this.ctx.messages?.getLatestMessageId==="function"){let i=this.safeGetLatestMessageId();if(!i)return{kind:"none"};return{kind:"row",messageId:i,actionId:e.actionId,allowStreamAfterFallback:!0,retryRowIfMissing:!1}}return{kind:"stream_after"}}return{kind:"none"}}safeGetLatestMessageId(){try{let e=this.ctx.messages?.getLatestMessageId?.();return typeof e==="string"&&e.length>0?e:null}catch{return null}}getStreamAfterMount(){if(this.destroyed)return null;if(this.streamAfterMount)return this.streamAfterMount;if(typeof this.ctx.ui?.mount!=="function")return null;try{return this.streamAfterMount=this.ctx.ui.mount("chat_stream_after"),this.streamAfterMount}catch{return null}}mountOptimisticStreamAfter(){if(this.destroyed)return;let e=this.getStreamAfterMount();if(!e)return;if(this.optimisticStreamEl&&this.optimisticStreamEl.parentNode===e)return;if(this.unmountOptimisticStreamAfter(),typeof document>"u")return;let t=document.createElement("div");t.innerHTML='<div class="gg-streaming-indicator gg-streaming-indicator--optimistic" data-gg-optimistic-indicator="true" role="status" aria-label="Generating response"><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span></div>';let n=t.firstElementChild;if(!n)return;e.append(n),this.optimisticStreamEl=n}unmountOptimisticStreamAfter(){let e=this.optimisticStreamEl;if(this.optimisticStreamEl=null,!e)return;try{e.remove()}catch{}}safeGetActiveChatId(){try{return this.ctx.getActiveChat?.().chatId??null}catch{return null}}isMountedAt(e,t,n){if(n==="afterend")return t.parentNode!==null&&t.nextElementSibling===e;if(n==="beforebegin")return t.parentNode!==null&&t.previousElementSibling===e;return t.contains(e)}resolveTarget(e,t){if(typeof this.ctx.dom?.findMessageElement!=="function")return null;let n=this.ctx.dom.findMessageElement(e);if(!n)return null;let i=n.querySelector('[data-component="MessageContent"]');if(i)return{row:n,element:i,position:"afterend",isMessageContent:!0};if(t==="guided_continue")return this.resolveContinueFallbackTarget(n);let r=n.querySelector('[data-spindle-mount="message_body_before"]');if(r)return{row:n,element:r,position:"beforeend",isMessageContent:!1};let s=n.querySelector('[data-spindle-mount="message_body_after"]');if(s)return{row:n,element:s,position:"beforeend",isMessageContent:!1};let o=n.querySelector('[data-component="BubbleMessage"] > div > div:last-child');if(o)return{row:n,element:o,position:"beforeend",isMessageContent:!1};if(typeof n.matches==="function"&&n.matches('[data-component="BubbleMessage"]')){let l=n.firstElementChild?.lastElementChild;return l?{row:n,element:l,position:"beforeend",isMessageContent:!1}:null}let d=n.querySelector('[data-component="MinimalMessage"] > div');if(d)return{row:n,element:d,position:"beforeend",isMessageContent:!1};if(typeof n.matches==="function"&&n.matches('[data-component="MinimalMessage"]')){let l=n.firstElementChild;return l?{row:n,element:l,position:"beforeend",isMessageContent:!1}:null}return null}resolveContinueFallbackTarget(e){let t=e.querySelector('[data-spindle-mount="message_body_after"]');if(t)return{row:e,element:t,position:"beforeend",isMessageContent:!1};let n=e.querySelector('[data-spindle-mount="message_body_before"]');if(n)return{row:e,element:n,position:"beforeend",isMessageContent:!1};let i=e.querySelector('[data-component="BubbleMessage"] [class*="content"]');if(i)return{row:e,element:i,position:"beforeend",isMessageContent:!1};if(typeof e.matches==="function"&&e.matches('[data-component="BubbleMessage"]')){let o=e.querySelector('[class*="content"]')??e.firstElementChild?.lastElementChild;if(o)return{row:e,element:o,position:"beforeend",isMessageContent:!1}}let r=e.querySelector('[data-component="BubbleMessage"] > div > div:last-child');if(r)return{row:e,element:r,position:"beforeend",isMessageContent:!1};let s=e.querySelector('[data-component="MinimalMessage"] > div');if(s)return{row:e,element:s,position:"beforeend",isMessageContent:!1};if(typeof e.matches==="function"&&e.matches('[data-component="MinimalMessage"]')&&e.firstElementChild)return{row:e,element:e.firstElementChild,position:"beforeend",isMessageContent:!1};return{row:e,element:e,position:"beforeend",isMessageContent:!1}}ensureRetryMode(e){if(this.retryMode!==e)this.cancelRetry(),this.rafRetries=0,this.retryMode=e}resetRetry(){this.cancelRetry(),this.rafRetries=0,this.retryMode=null}unmountRow(){let e=this.mountedEl;if(this.mountedEl=null,this.mountedTarget=null,this.mountedPosition=null,this.mountedIsMessageContent=null,this.mountedMessageId=null,this.disconnectRowObserver(),!e)return;try{if(typeof this.ctx.dom?.uninject==="function")this.ctx.dom.uninject(e);else e.remove()}catch{}}unmount(){this.unmountRow(),this.unmountOptimisticStreamAfter()}scheduleRetry(e){if(this.destroyed||this.rafId!==null||this.rafTimerId!==null)return;if(this.rowObserver!==null){if(e&&this.observedRow===e)return;this.disconnectRowObserver()}if(this.rafRetries<2){this.rafRetries+=1;let i=typeof globalThis.requestAnimationFrame==="function"?globalThis.requestAnimationFrame.bind(globalThis):void 0;if(i)this.rafId=i(()=>{if(this.rafId=null,!this.destroyed)this.syncCurrent()});else this.rafTimerId=setTimeout(()=>{if(this.rafTimerId=null,!this.destroyed)this.syncCurrent()},16);return}if(this.retryMode==="content"&&e&&typeof globalThis.MutationObserver==="function"){let i=new globalThis.MutationObserver((r)=>{if(this.destroyed||this.retryMode!=="content"){this.disconnectRowObserver();return}let s=!1;for(let o of r){for(let d=0;d<o.addedNodes.length;d+=1)if(o.addedNodes[d]?.nodeType===1){s=!0;break}if(s)break}if(s)this.syncCurrent()});i.observe(e,{childList:!0,subtree:!0}),this.rowObserver=i,this.observedRow=e;return}if(this.rafRetries>=10)return;let t=this.rafRetries-2;this.rafRetries+=1;let n=Math.min(500,32*2**t);this.rafTimerId=setTimeout(()=>{if(this.rafTimerId=null,!this.destroyed)this.syncCurrent()},n)}disconnectRowObserver(){if(this.rowObserver){try{this.rowObserver.disconnect()}catch{}this.rowObserver=null}this.observedRow=null}cancelRetry(){if(this.rafId!==null){if(typeof globalThis.cancelAnimationFrame==="function")globalThis.cancelAnimationFrame(this.rafId);this.rafId=null}if(this.rafTimerId!==null)clearTimeout(this.rafTimerId),this.rafTimerId=null;this.disconnectRowObserver()}}var Jt=`
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
  color: var(--lumiverse-danger-text, var(--lumiverse-danger, #ef4444));
  box-shadow: 0 0 0 1px rgba(248, 113, 113, 0.35);
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
  color: var(--lumiverse-danger-text, var(--lumiverse-text, var(--text-primary, currentColor)));
}

.gg-notice.is-warn {
  border-color: rgba(245, 158, 11, 0.48);
  background: rgba(245, 158, 11, 0.14);
  color: var(--lumiverse-warning-text, var(--lumiverse-text, var(--text-primary, currentColor)));
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
  .gg-chat-head,
  .gg-chat-head.is-running::after,
  .gg-chat-head-dismiss,
  .gg-card-chevron,
  .gg-dropup-item {
    animation: none !important;
    transition: none !important;
  }
}
`;var en="pending:",Dn=200,Nn=100,On=50,Fn=500,Bn=1e4,Gn=300000;class bt extends Error{constructor(e){super(`Timed out waiting for ${e}.`);this.name="RpcTimeoutError"}}function Un(e){if(e instanceof bt)return!0;let t=e instanceof Error?e.message:String(e);return/^Timed out waiting for /i.test(t)||/^Timeout waiting for /i.test(t)}function Ee(e){return typeof e==="string"&&e.startsWith(en)}function Je(e){return Boolean(e)&&typeof e==="object"&&!Array.isArray(e)}function pe(e,t){if(Object.is(e,t))return!0;if(typeof e!==typeof t||e===null||t===null)return!1;if(typeof e!=="object")return!1;if(Array.isArray(e)||Array.isArray(t)){if(!Array.isArray(e)||!Array.isArray(t)||e.length!==t.length)return!1;for(let o=0;o<e.length;o+=1)if(!pe(e[o],t[o]))return!1;return!0}let n=e,i=t,r=Object.keys(n),s=Object.keys(i);if(r.length!==s.length)return!1;for(let o of r){if(!Object.prototype.hasOwnProperty.call(i,o))return!1;if(!pe(n[o],i[o]))return!1}return!0}function vt(e){if(!Je(e))return null;if(typeof e.chatId==="string"&&e.chatId)return e.chatId;if(Je(e.chat)&&typeof e.chat.id==="string")return e.chat.id;return null}function Vn(e){let t=vt(e);if(t)return t;if(Je(e)&&typeof e.id==="string"&&e.id)return e.id;return null}function Qt(e,t){if(!Array.isArray(t)||t.length===0)return e;return{...e,connections:t.map((n)=>({id:n.id,name:n.name,provider:n.provider??"",model:n.model??"",isDefault:Boolean(n.is_default)}))}}async function Kn(e,t){if(e.connections.length>0||!t.connections?.list)return e;try{let n=t.connections.list();if(n&&typeof n.then==="function"){let i=await n;return Qt(e,i)}return Qt(e,n)}catch{return e}}function fi(e){let t=e,n=t.dom.addStyle(Jt),i=[],r=!1,s=0,o=0,d=0,l=0,h=0,c=0,g=!1,b=new Set,u=null,p=!1,y=!1,I=null,w=null,E=new Map,S=new Map,A=new Set,D=new Map,T=new Map,x=[0,20,50,100,200],C,O=null,L=0,N,j,q=0,k=null,G=null,Q=!1,se=!1,le=!1,ne=!0,ie=!1,Pe=null,Le=!1;function R(){try{let a=t.getActiveChat?.();return{chatId:typeof a?.chatId==="string"&&a.chatId?a.chatId:null,...a?.characterId!==void 0?{characterId:a.characterId}:{}}}catch{return{chatId:null}}}let Y=R().chatId;function Z(a){if(!a||Ee(a))return;if(A.has(a))A.delete(a);else if(A.size>=Nn){let m=A.values().next().value;if(m!==void 0)A.delete(m)}A.add(a)}function ke(){if(j!==void 0)clearInterval(j),j=void 0}function Fe(){if(r||E.size===0){ke();return}if(j!==void 0)return;j=setInterval(()=>{if(r||E.size===0){ke();return}if(typeof document<"u"&&document.visibilityState==="hidden")return;J({onlyIfChanged:!0})},Bn)}function yt(){if(r)return;if(E.size===0&&S.size===0)return;let a=Date.now();if(a-q<Fn)return;q=a,J({onlyIfChanged:!0})}function Ce(a,m){if(D.has(a))D.delete(a);else if(D.size>=Dn){let f=D.keys().next().value;if(f!==void 0)D.delete(f)}D.set(a,m)}try{k=t.ui.mount("chat_composer_above")}catch{k=null}function ee(a){if(!a)return null;return E.get(a)??(w?.chatId===a?w:null)}function ge(a){if(!a)return!1;return Boolean(ee(a))||b.has(a)}function He(){let a=R().chatId;if(a&&E.has(a)){w=E.get(a);return}let m=null;for(let f of E.values())if(!m||f.startedAt>=m.startedAt)m=f;w=m}function tn(a,m,f){let v={runId:`${en}${++o}`,actionId:a,chatId:m,startedAt:Date.now(),...f?.backgroundSwipe?{backgroundSwipe:!0}:{}};if(h+=1,q=0,Ce(m,h),E.set(m,v),Fe(),He(),u)u={...u,activeRun:w};let H=R().chatId;return Re.sync(ee(H)),oe(),v}function Be(a,m){let f=E.get(a);if(!f||f.runId!==m)return!1;if(h+=1,Ce(a,h),E.delete(a),Fe(),He(),u)u={...u,activeRun:w};if(!r){let v=R().chatId;Re.sync(ee(v)),oe()}return!0}function fe(){if(C!==void 0)clearTimeout(C),C=void 0;O=null,L=0}function nn(a){if(r)return;if(O!==a)fe(),O=a,L=0;if(C!==void 0)return;let m=x[L];if(m===void 0)return;L+=1,C=setTimeout(()=>{if(C=void 0,r)return;et(a,{fromRetry:!0})},m)}function Qe(a,m){if(T.has(a))T.delete(a);else if(T.size>=On){let f=T.keys().next().value;if(f!==void 0)T.delete(f)}T.set(a,m)}function et(a,m={}){if(r||!a)return;let f=T.get(a);if(f===void 0){if(O===a)fe();return}let v=me();if(R().chatId!==a){if(O===a)fe();return}if(!ve(v)||v.chatId!==a){if(!m.fromRetry)fe();nn(a);return}if(fe(),v.text.trim().length>0){T.delete(a);return}if(De(f,v))T.delete(a),Ne(v)}function me(){if(r)return null;try{return t.composer?.getState?.()??null}catch{return null}}function ve(a){return Boolean(a)&&a.mounted!==!1}function De(a,m){if(r)return!1;let f=m!==void 0?m:me();if(!ve(f))return!1;try{return t.composer.setText(a),!0}catch{return!1}}function Ne(a){if(r)return!1;let m=a!==void 0?a:me();if(!ve(m))return!1;try{return t.composer.focus(),!0}catch{return!1}}let be=new Map;function we(a,m,f=30000,v){if(r)return Promise.reject(Error("Extension unloaded."));let H=`gg-${++s}-${Date.now().toString(36)}`;return new Promise((_,F)=>{let U=setTimeout(()=>{be.delete(H),F(new bt(a))},f);be.set(H,{resolve:(B)=>_(B),reject:F,timer:U}),v?.(H),t.sendToBackend({type:"gg:rpc",requestId:H,action:a,input:m})})}function V(a,m="info",f=5000){if(r)return;if(X.setNotice(a,m),N)clearTimeout(N),N=void 0;if(k)if(!a)k.replaceChildren();else{let v=document.createElement("div");if(v.className=`gg-notice${m==="error"?" is-error":m==="warn"?" is-warn":""}`,m==="error"||m==="warn")v.setAttribute("role","alert"),v.setAttribute("aria-live","assertive");else v.setAttribute("role","status"),v.setAttribute("aria-live","polite");v.style.margin="4px 12px",v.textContent=a,k.replaceChildren(v)}if(a&&f>0)N=setTimeout(()=>{if(N=void 0,r)return;X.setNotice("","info"),k?.replaceChildren()},f)}function xe(){if(N)clearTimeout(N),N=void 0;if(r)return;X.setNotice("","info"),k?.replaceChildren()}function It(){if(r)return;let{chatId:a}=R();X.setRecoveryBusy(ge(a))}function tt(){if(I)I(),I=null}function oe(){if(r||!u)return;let{chatId:a}=R();wt.render({settings:u.settings,activeRun:ee(a),isBusy:ge(a),recovery:u.recovery,hasActiveChat:Boolean(a),chatId:a}),It()}function ye(){if(r)return;if(u)oe();else It()}async function J(a={}){if(r)return!1;if(!p&&X.isTabConnected())p=!0,tt(),X.render(u);let m=p&&X.isTabConnected(),f=a.includeCatalogs!==void 0?Boolean(a.includeCatalogs):p&&(!y||m);if(G&&(!f||Q)){if(le=!0,ne=ne&&Boolean(a.onlyIfChanged),ie=ie||f,a.fresh){if(await G,r)return!1;if(G)return G;return J({onlyIfChanged:a.onlyIfChanged,includeCatalogs:f,fresh:!1})}return G}let v;return v=(async()=>{let H=++d,_=l,F=h;try{let U=await we("get_bootstrap",{includeCatalogs:f});if(r)return!1;if(H!==d){if(G&&G!==v)return G;return se}let B=f?await Kn(U,t):U;if(r)return!1;if(H!==d){if(G&&G!==v)return G;return se}let de=u&&l!==_?u.settings:B.settings,K=new Map,z=B.activeRuns;if(Array.isArray(z)){for(let M of z)if(M&&typeof M.chatId==="string"&&M.chatId.length>0)K.set(M.chatId,M)}if(B.activeRun&&typeof B.activeRun.chatId==="string"&&B.activeRun.chatId.length>0)K.set(B.activeRun.chatId,B.activeRun);let W=new Map;for(let[M,P]of E.entries())if(!Ee(P.runId))W.set(M,P.runId);let ce=B.recentTerminalRuns,Ae=Array.isArray(ce)?ce:[];for(let[M,P]of K.entries())if(!Ee(P.runId)){let ae=S.get(M);if(ae)ae.observedRunId=P.runId}let St=new Map;for(let[M,P]of E.entries())if(Ee(P.runId)&&b.has(M))St.set(M,P);if(h===F){E.clear();for(let[M,P]of K.entries())E.set(M,P)}else if(c<=F){for(let M of[...E.keys()])if((D.get(M)??0)<=F){let P=K.get(M);if(P)E.set(M,P);else E.delete(M)}for(let[M,P]of K.entries())if(!E.has(M)&&(D.get(M)??0)<=F)E.set(M,P)}for(let[M,P]of[...S.entries()]){if((D.get(M)??0)>F)continue;let ae=K.get(M),Mt=W.get(M)??null,_t=Ae.find((Xe)=>P.observedRunId!==null?Xe.runId===P.observedRunId:Xe.chatId===M&&Xe.actionId===P.actionId&&Xe.finishedAt>=P.startedAt);if(_t!==void 0&&(!ae||ae.runId!==_t.runId)||P.observedRunId!==null&&(!ae||ae.runId!==P.observedRunId)||Mt!==null&&(!ae||ae.runId!==Mt))P.cancelAsReconciled()}for(let[M,P]of St.entries())if(!E.has(M)&&b.has(M)&&S.has(M))E.set(M,P);Fe(),He();let At=w,re=u,it=null;if(Ae.length>0)if(re===null)for(let M of Ae)Z(M.runId);else{let M=[...Ae].sort((P,ae)=>P.finishedAt-ae.finishedAt);for(let P of M){if(A.has(P.runId))continue;if(Z(P.runId),P.status==="error"&&typeof P.error==="string"&&P.error.length>0)it=P.error}}let Te={...B,settings:de,activeRun:At,...!f&&y&&re!==null?{connections:re.connections,presets:re.presets,catalogWarnings:re.catalogWarnings}:{}},ln=f&&!y;if(f)y=!0;let dn=p&&Boolean(a.onlyIfChanged)&&!ln&&re!==null&&pe(re.settings,Te.settings)&&pe(re.connections,Te.connections)&&pe(re.presets,Te.presets)&&pe(re.permissions,Te.permissions)&&pe(re.catalogWarnings??[],Te.catalogWarnings??[]);u=Te,w=At;let Tt=R().chatId;if(Re.sync(ee(Tt)),Ge.syncRuns(Array.from(E.values()).filter((M)=>!Ee(M.runId)),Tt),p){if(!dn)X.render(u);else if(!pe(re.recovery,Te.recovery))X.updateRecovery(u.recovery,u.settings)}if(oe(),it)V(it,"error",7000);return se=!0,!0}catch(U){if(r)return!1;se=!1;let B=U instanceof Error?U.message:String(U);return V(B,"error"),!1}finally{if(G===v){if(G=null,Q=!1,le&&!r){let U=ne,B=ie;le=!1,ne=!0,ie=!1,J({onlyIfChanged:U,includeCatalogs:B})}}}})(),G=v,Q=f,v}async function Et(a){let{rpcAction:m,actionId:f,chatId:v,payload:H,backgroundSwipe:_,onRollback:F}=a,U=tn(f,v,{backgroundSwipe:_}),B=!1,de="",K={requestId:"",actionId:f,chatId:v,startedAt:Date.now(),observedRunId:null,cancelAsReconciled:()=>{if(B)return;B=!0;let z=be.get(de);if(z)be.delete(de),clearTimeout(z.timer),z.resolve(void 0);if(S.get(v)===K)S.delete(v);b.delete(v),Be(v,U.runId),ye()}};try{let z=await we(m,H,Gn,(Ae)=>{de=Ae,K.requestId=Ae,S.set(v,K)});if(S.get(v)===K)S.delete(v);if(r||B)return;let W=z&&typeof z==="object"&&typeof z.runId==="string"?z.runId:K.observedRunId;if(W)Z(W);Be(v,U.runId);let ce=E.get(v);if(ce&&!Ee(ce.runId)&&(!W||ce.runId===W))J({onlyIfChanged:!0})}catch(z){if(S.get(v)===K)S.delete(v);if(Be(v,U.runId),r||B)return;let W=z instanceof Error?z.message:String(z);if(Un(z)){let ce=await J({onlyIfChanged:!0,fresh:!0});if(r)return;if(!ce)F?.(),V(W,"error",7000);return}if(K.observedRunId)Z(K.observedRunId);if(F?.(),V(W,"error",7000),ee(v))J({onlyIfChanged:!0})}finally{if(S.get(v)===K)S.delete(v);Be(v,U.runId)}}async function rn(a,m){if(r||g)return;let f=R().chatId;if(f&&(ee(f)||b.has(f)))return;g=!0;let v=f;if(v)b.add(v),ye();try{if(!u)await J();if(g=!1,r||!u)return;let{chatId:H}=R();if(!H){V("Open a chat before triggering a guided action.","warn");return}if(v!==H){if(v)b.delete(v);if(b.has(H))return;v=H,b.add(v),ye()}if(ee(H))return;let _=me();if(!ve(_)){V("Composer is unavailable right now. Open the message input bar and try again.","warn");return}if(_.chatId!==null&&_.chatId!==H){V("Active chat changed; please try again.","warn");return}let F=_.text,U=u.settings.actions[a];if(a==="guided_response"&&!F.trim()){V("Type guidance in the input box before clicking Guided Response.","warn"),Ne();return}xe(),T.delete(H);let B=Boolean(F.trim())&&(U.clearInputOnRun||a==="guided_impersonate");if(B&&!De("")){V("Composer is unavailable right now.","warn");return}let de=t.connections?.getActive?.()?.activeProfileId??null,K=a==="guided_swipe"&&Boolean(m?.backgroundSwipe),z={actionId:a,chatId:H,activeConnectionId:de,inputText:F,...K?{backgroundSwipe:!0}:{}};await Et({rpcAction:"run_action",actionId:a,chatId:H,payload:z,backgroundSwipe:K,onRollback:()=>{if(B&&!ee(H)){let W=me(),ce=R().chatId;if(ve(W)&&W.chatId===H&&ce===H&&!W.text)De(F)}}})}finally{if(g=!1,v)b.delete(v);ye()}}function nt(a){let m=R().chatId;if(r||!u)return;if(ge(m)){V("Wait for the active guided generation to finish before restoring input.","warn");return}let f=me();if(!ve(f)){V("Composer is unavailable right now — cannot restore input.","warn");return}if(f.chatId!==null&&f.chatId!==m){V("Active chat changed; please try again.","warn");return}if(!De(a.text)){V("Composer is unavailable right now — cannot restore input.","warn");return}Ne(),xe()}function sn(){let a=R().chatId;if(r||!u||ge(a))return;if(!u.settings.inputRecovery.enabled)return;let m=me();if(!ve(m)){V("Composer is unavailable right now — cannot clear input.","warn");return}if(m.chatId!==null&&m.chatId!==a){V("Active chat changed; please try again.","warn");return}if(!m.text){Ne(),xe();return}if(!De("")){V("Composer is unavailable right now — cannot clear input.","warn");return}Ne(),xe()}async function on(){if(r||g)return;let{chatId:a}=R();if(!a){V("Open a chat before removing the last continue.","warn");return}if(ge(a))return;b.add(a),ye(),T.delete(a);try{xe(),await we("remove_last_continue",{chatId:a})}catch(m){if(r)return;let f=m instanceof Error?m.message:String(m);V(f,"warn",7000)}finally{b.delete(a),ye()}}async function an(){if(r||g)return;let{chatId:a}=R();if(!a){V("Open a chat before regenerating the last continue.","warn");return}if(ge(a))return;b.add(a),ye(),T.delete(a);try{xe();let m=t.connections?.getActive?.()?.activeProfileId??null;await Et({rpcAction:"regenerate_last_continue",actionId:"guided_continue",chatId:a,payload:{chatId:a,activeConnectionId:m}})}finally{b.delete(a),ye()}}async function Ct(){let a=R().chatId;if(r)return;if(ge(a)){V("Wait for the active guided generation to finish before clearing input recovery history.","warn");return}try{let m=await we("clear_recovery");if(r)return;if(u){if(u={...u,recovery:m},oe(),p)X.updateRecovery(u.recovery,u.settings)}}catch(m){if(r)return;V(m instanceof Error?m.message:String(m),"error")}}let Re=new mt(t),Ge=new st(t),Se=new ht(t),wt=new ut(t,{onTriggerAction:(a,m)=>{rn(a,m)},onAbortAction:(a)=>{if(r)return;if(Ee(a)){let m=R().chatId,v=((m?E.get(m):void 0)??Array.from(E.values()).find((H)=>H.runId===a))?.chatId??m;if(v)Be(v,a),we("abort_action",{chatId:v}).catch(()=>{return});return}we("abort_action",{runId:a}).then((m)=>{if(r)return;if(!m?.aborted)J({onlyIfChanged:!0})},()=>{if(r)return;J({onlyIfChanged:!0})})},onRestoreLatest:()=>{let a=R().chatId;if(r||!u||ge(a))return;let m=Gt(u.recovery);if(m)nt(m);else sn()},onRestoreEntry:(a)=>{nt(a)},onClearRecovery:()=>{Ct()},onRemoveLastContinue:()=>{on()},onRegenerateLastContinue:()=>{an()}}),X=new ft(t,{onRefresh:()=>{if(r)return;xe(),J({includeCatalogs:!0})},onSaveSettings:async(a,m)=>{if(r||!u)return;let f=++l;if(u={...u,settings:a},oe(),m?.rebuildDrawer)X.render(u,{force:!0});try{let v=await we("save_settings",a);if(r||!u||f!==l)return;let H=pe(v,u.settings);if(u={...u,settings:v},!H){if(oe(),m?.rebuildDrawer)X.render(u)}}catch(v){if(r)return;if(V(`Failed saving settings: ${v instanceof Error?v.message:String(v)}`,"error"),f===l)J()}},onRestoreEntry:(a)=>nt(a),onClearRecovery:()=>Ct()});p=X.isTabConnected();function xt(){if(r)return;if(tt(),!p)p=!0,X.render(u);J({onlyIfChanged:y,includeCatalogs:!0})}if(!p)I=X.observeTabConnection(()=>{xt()}),i.push(()=>{tt()});function We(a){if(r)return;let m=R().chatId,f=a!==void 0?a:m,v=`${m??""}\x00${f??""}`;if(v===Pe)return;if(Pe=v,Y=m,!Le)Le=!0,queueMicrotask(()=>{Le=!1,Pe=null});fe(),He(),Re.sync(ee(m)),Ge.onChatChanged(m),oe(),et(m),Se.onChatChanged(f)}if(i.push(X.onActivate(()=>{xt()})),i.push(t.onBackendMessage((a)=>{if(r)return;let m=Je(a)?a:{};if(m.type==="gg:reply"&&typeof m.requestId==="string"){let v=be.get(m.requestId);if(!v)return;if(be.delete(m.requestId),clearTimeout(v.timer),typeof m.error==="string"&&m.error)v.reject(Error(m.error));else v.resolve(m.result);return}let f=m;switch(f.type){case"gg:status":{h+=1;let v=R().chatId,H=ee(v),_=typeof f.chatId==="string"&&f.chatId.length>0?f.chatId:void 0,F=Boolean(f.done)||Boolean(f.aborted)||Boolean(f.error),U=_===void 0&&F&&Boolean(f.error),B=_?E.get(_):void 0,de=f.run?E.get(f.run.chatId):void 0;if(f.run){if(_&&f.run.chatId!==_&&F){if(Z(B?.runId),Z(S.get(_)?.observedRunId),E.delete(_),Ce(_,h),B!==void 0&&B.actionId!=="guided_impersonate"||f.aborted||f.error)T.delete(_)}if(!F||U||_!==void 0&&f.run.chatId!==_){if(de?.runId!==f.run.runId)T.delete(f.run.chatId),q=0;if(!Ee(f.run.runId)){let W=S.get(f.run.chatId);if(W)W.observedRunId=f.run.runId}E.set(f.run.chatId,f.run),Ce(f.run.chatId,h)}else if(Z(f.run.runId),Z(de?.runId),E.delete(f.run.chatId),Ce(f.run.chatId,h),f.run.actionId!=="guided_impersonate"||f.aborted||f.error)T.delete(f.run.chatId)}else if(_){if(Z(B?.runId),Z(S.get(_)?.observedRunId),E.delete(_),Ce(_,h),B!==void 0&&B.actionId!=="guided_impersonate"||f.aborted||f.error)T.delete(_)}else if(!U){if(F){for(let W of E.values())Z(W.runId);for(let W of S.values())Z(W.observedRunId)}if(E.clear(),c=h,F)T.clear()}if(Fe(),He(),u)u={...u,activeRun:w};let K=ee(v),z=H!==K||v!==null&&(_===v||f.run?.chatId===v)||!_&&!f.run&&!U;if(z)Re.sync(K);if(Ge.handleStatusEvent(f,v),z)oe();if(f.error)V(f.error,"error",7000);return}case"gg:impersonate-chunk":{if(typeof f.text==="string"){let v=f.chatId,_=(typeof v==="string"?v:null)??(E.size===1?Array.from(E.values())[0].chatId:w?.chatId??null),F=R().chatId;if(_!==null&&_!==F){if(f.done&&!f.aborted&&f.text.length>0)Qe(_,f.text);return}let U=me();if(!ve(U)||!F||U.chatId!==F){if(f.done&&!f.aborted&&f.text.length>0&&_){if(Qe(_,f.text),_===F)et(F)}return}if(De(f.text,U)){if(T.delete(F),f.done)Ne(U)}else if(f.done&&!f.aborted&&f.text.length>0)Qe(F,f.text)}return}case"gg:recovery-updated":{if(u&&Array.isArray(f.recovery)){if(u={...u,recovery:f.recovery},oe(),p)X.updateRecovery(u.recovery,u.settings)}return}case"gg:changed":{J({onlyIfChanged:!0});return}case"gg:generation_metrics":{if(typeof f.chatId==="string"&&typeof f.messageId==="string"&&typeof f.swipeId==="number")Se.handleMetricsEvent(f);return}}})),i.push(t.events.on("CHAT_SWITCHED",(a)=>{We(vt(a)??R().chatId)})),i.push(t.events.on("CHAT_CHANGED",(a)=>{We(vt(a)??R().chatId)})),i.push(t.events.on("CHAT_DELETED",(a)=>{if(r)return;let m=Vn(a);if(!m)return;if(h+=1,Ce(m,h),E.delete(m),T.delete(m),O===m)fe();b.delete(m),Fe(),He();let f=R().chatId;Re.sync(ee(f)),Ge.onChatDeleted(m),Se.onChatDeleted(m),oe()})),i.push(t.events.on("MESSAGE_SWIPED",(a)=>{if(!r)Se.onMessageEvent(a)})),i.push(t.events.on("MESSAGE_EDITED",(a)=>{if(!r)Se.onMessageEvent(a)})),i.push(t.events.on("MESSAGE_DELETED",(a)=>{if(!r)Se.onMessageDeleted(a)})),t.connections?.subscribe)i.push(t.connections.subscribe(()=>{if(!r&&p)if(X.isTabConnected()||!y)J({onlyIfChanged:!0,includeCatalogs:!0});else y=!1}));let Rt=!1;try{if(t.state)i.push(t.state.subscribe("chat.active",()=>{if(R().chatId===Y)return;We()})),Rt=!0}catch{}if(!Rt){let a=R().chatId,m=setInterval(()=>{if(r)return;let f=R().chatId;if(f!==a)a=f,We(f)},600);i.push(()=>clearInterval(m))}if(typeof document<"u"){let a=()=>{if(document.visibilityState==="visible")yt()};document.addEventListener("visibilitychange",a),i.push(()=>{document.removeEventListener("visibilitychange",a)})}let Ie=typeof window<"u"?window:typeof document<"u"?document.defaultView:null;if(Ie&&typeof Ie.addEventListener==="function"){let a=()=>{yt()};Ie.addEventListener("focus",a),Ie.addEventListener("pageshow",a),Ie.addEventListener("online",a),i.push(()=>{Ie.removeEventListener("focus",a),Ie.removeEventListener("pageshow",a),Ie.removeEventListener("online",a)})}return t.ready(),J(),()=>{try{X.flushPendingSaves()}catch{}if(r=!0,ke(),G=null,Q=!1,le=!1,fe(),N)clearTimeout(N),N=void 0;for(let a of i)try{a()}catch{}i.length=0;for(let a of be.values())clearTimeout(a.timer),a.reject(Error("Guided Generations unloaded."));be.clear(),S.clear(),A.clear(),b.clear(),E.clear(),D.clear(),T.clear();try{Se.destroy()}catch{}try{Ge.destroy()}catch{}try{Re.destroy()}catch{}try{wt.destroy()}catch{}try{X.destroy()}catch{}try{k?.replaceChildren()}catch{}try{n()}catch{}}}export{fi as setup};
